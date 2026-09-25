import type { DatabaseSync } from 'node:sqlite';
import { PROMPT_VERSION, type AnalysisResult } from './analyze.ts';
import { contentHash, currentGroupAnalysis, getNotice, insertAnalysis, storedNoticeState, storedRawNotice, upsertNotice, type UpsertStatus } from './db.ts';
import { daysApart } from './dedup.ts';
import { AiApiError } from './errors.ts';
import type { ListedNotice } from './sources/k2web.ts';
import type { RawNotice } from './types.ts';

// Ingestion: list -> fetch new (and still-relevant) posts -> upsert -> analyze only if no analysis
// exists for the notice's current content. One notice failing never stops the run.
//
// Incremental: a post already in the DB is not re-fetched unless edits to it still matter
// (fetchReason): posted within RECENT_DAYS, or its extracted deadline/event date hasn't passed.
// `full` re-fetches every listed post (the old behavior).

/** Known posts whose 작성일 is at most this many days ago are re-fetched to catch edits. */
export const RECENT_DAYS = 7;

export type FetchReason = 'new' | 'full' | 'recent' | 'upcoming';

/**
 * The listed posts to process: the first `limit` regular rows plus every pinned row. Pinned
 * rows (often old, repeated on every page) never take up the limit; known pinned posts are
 * then only re-fetched under the usual fetchReason rules.
 */
export function selectListed(listed: ListedNotice[], limit?: number): ListedNotice[] {
  let regular = 0;
  return listed.filter((n) => n.pinned || limit === undefined || regular++ < limit);
}

/**
 * Why a listed post's article page must be requested, or null to reuse the stored copy.
 * `stored` = storedNoticeState() (null = not in the DB). Dates are YYYY-MM-DD; `today` in KST.
 */
export function fetchReason(
  item: Pick<ListedNotice, 'listedDate'>,
  stored: { publishedAt: string | null; dates: string[] } | null,
  today: string,
  full = false,
): FetchReason | null {
  if (!stored) return 'new';
  if (full) return 'full';
  const age = daysApart(stored.publishedAt ?? item.listedDate, today);
  if (age !== null && age <= RECENT_DAYS) return 'recent';
  if (stored.dates.some((d) => d.slice(0, 10) >= today)) return 'upcoming';
  return null;
}

/** Today's date in Korea (the boards' timezone), YYYY-MM-DD. */
export const todayKst = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());

export interface HttpCount {
  list: number;
  article: number;
}

export interface IngestDeps {
  db: DatabaseSync;
  listNotices: () => Promise<ListedNotice[]>;
  fetchNotice: (url: string) => Promise<RawNotice>;
  /** null = AI disabled for this run (e.g. no API key); notices are still stored. */
  analyze: ((n: RawNotice) => Promise<AnalysisResult>) | null;
  log?: (line: string) => void;
  /** Pause between article requests to the Inha site. */
  crawlDelayMs?: number;
  /** Pause between AI calls (free-tier requests-per-minute). */
  aiDelayMs?: number;
  /** Process at most this many regular (non-pinned) listed notices; pinned ones are extra (selectListed). */
  limit?: number;
  /** Re-fetch every listed post, not only new/recent/upcoming ones. */
  full?: boolean;
  /** YYYY-MM-DD in KST; defaults to todayKst(). Injected by tests. */
  today?: string;
  /** Provider name for logs ("no gemini request"); defaults to "AI". */
  aiName?: string;
  /** The board's HTTP request counter, read before and after the run for stats.http. */
  httpRequests?: () => HttpCount;
  /** Also re-analyze notices whose current analysis came from an older prompt version. Costs AI requests. */
  upgradePrompt?: boolean;
  /**
   * Called after a new/changed notice's analysis is saved, with its notices.id. Hook for
   * profile matching → (future) notifications. Must not throw; errors are logged and ignored.
   */
  onAnalyzed?: (noticeId: number) => void;
  /** AI already stopped earlier (e.g. by a previous source in ingestAll): defer instead of calling it. */
  aiStoppedReason?: string | null;
}

export interface IngestStats {
  /** Selected listed posts (regular within the limit + pinned). */
  found: number;
  /** Of found: pinned rows (outside the limit). */
  pinned: number;
  /** Article pages requested. */
  fetched: number;
  /** Already stored and not worth re-checking: not re-fetched (see fetchReason). */
  known: number;
  new: number;
  updated: number;
  unchanged: number;
  crawlFailed: number;
  analyzed: number;
  analysisFailed: number;
  /** Needed analysis but AI was disabled or stopped; picked up next run. */
  analysisDeferred: number;
  /** Notices that already had a current analysis → no AI call. */
  analysisSkipped: number;
  /** Of analysisSkipped: the analysis came from the same notice on another board (cross-source duplicate). */
  duplicates: number;
  aiStoppedReason: string | null;
  /** HTTP requests this board made during the run (when the source reports them). */
  http: HttpCount | null;
  errors: { noticeId: string; stage: 'crawl' | 'analysis'; message: string }[];
}

// After this many consecutive overload failures (each already retried + fallen back),
// stop calling the AI for the rest of the run instead of hammering it.
const MAX_CONSECUTIVE_OVERLOADS = 3;

export async function ingest(deps: IngestDeps): Promise<IngestStats> {
  const { db, log = console.log, crawlDelayMs = 300, aiDelayMs = 0, today = todayKst() } = deps;
  const ai = deps.aiName ?? 'AI';
  const stats: IngestStats = {
    found: 0, pinned: 0, fetched: 0, known: 0, new: 0, updated: 0, unchanged: 0, crawlFailed: 0,
    analyzed: 0, analysisFailed: 0, analysisDeferred: 0, analysisSkipped: 0, duplicates: 0,
    aiStoppedReason: deps.analyze ? (deps.aiStoppedReason ?? null) : 'AI disabled for this run', http: null, errors: [],
  };
  const httpBefore = deps.httpRequests ? { ...deps.httpRequests() } : null;

  // Listing failure (site down, layout change) aborts the run: there is nothing to iterate.
  const listed = selectListed(await deps.listNotices(), deps.limit);
  stats.found = listed.length;
  stats.pinned = listed.filter((n) => n.pinned).length;
  log(`[CRAWL] Found ${listed.length} notices` + (stats.pinned ? ` (${stats.pinned} pinned, not counted in the limit)` : ''));

  let consecutiveOverloads = 0;
  let aiCalls = 0;
  for (const item of listed) {
    const id = item.sourceNoticeId;

    // Existence, change and duplicate checks are plain DB/hash comparisons; no AI involved.
    const stored = storedNoticeState(db, item.url);
    const reason = fetchReason(item, stored, today, deps.full);
    let notice: RawNotice;
    let rowId: number;
    let status: UpsertStatus | 'known';
    let changed: string[] = [];
    if (reason === null) {
      // Known post, older than RECENT_DAYS and no upcoming date: reuse the stored copy, no HTTP request.
      stats.known++;
      notice = storedRawNotice(db, stored!.id)!;
      rowId = stored!.id;
      status = 'known';
    } else {
      if (stats.fetched > 0 && crawlDelayMs) await sleep(crawlDelayMs);
      stats.fetched++;
      if (reason === 'recent') log(`[RECHECK] Notice ${id} posted within ${RECENT_DAYS} days; re-fetching to catch edits`);
      if (reason === 'upcoming') log(`[RECHECK] Notice ${id} has a deadline/event date not passed yet; re-fetching to catch edits`);
      try {
        notice = await deps.fetchNotice(item.url);
      } catch (err) {
        stats.crawlFailed++;
        stats.errors.push({ noticeId: id, stage: 'crawl', message: describe(err) });
        log(`[ERROR] Notice ${id} crawl failed: ${describe(err)}`);
        continue;
      }
      ({ id: rowId, status, changed } = upsertNotice(db, notice));
      stats[status]++;
      if (status === 'new') log(`[NEW] Notice ${id} ${notice.title}`);
      if (status === 'updated') log(`[UPDATE] Notice ${id} changed (${changed.join(', ')})`);
    }

    // The AI is only reached below when no analysis exists for the current content.
    // A notice cross-posted on several boards is one group with one analysis: any copy's current
    // analysis counts (rule in src/dedup.ts, grouping in db.ts assignGroup).
    const current = currentGroupAnalysis(db, rowId);
    const upgrade = current !== null && deps.upgradePrompt && currentGroupAnalysis(db, rowId, PROMPT_VERSION) === null;
    if (current !== null && !upgrade && status === 'known') {
      stats.analysisSkipped++;
      if (current !== rowId) stats.duplicates++;
      log(`[KNOWN] Notice ${id} already stored and analyzed; not re-fetched (older than ${RECENT_DAYS} days, no upcoming date), no ${ai} request`);
      continue;
    }
    if (current !== null && current !== rowId && !upgrade) {
      stats.analysisSkipped++;
      stats.duplicates++;
      const other = getNotice(db, current)!;
      log(`[DUP] Notice ${id} is the same notice as #${current} (${other.source} ${other.source_notice_id}); reusing its analysis, no ${ai} request`);
      continue;
    }
    if (current !== null && !upgrade) {
      stats.analysisSkipped++;
      if (status === 'unchanged') log(`[SKIP] Unchanged notice ${id} (existing analysis is current; no ${ai} request)`);
      else log(`[SKIP] Existing analysis for ${id} still valid (${changed.join(', ')} change only; no ${ai} request)`);
      continue;
    }
    if (upgrade) log(`[UPGRADE] Notice ${id} analysis is from an older prompt; re-analyzing with ${PROMPT_VERSION}`);
    else if (status === 'unchanged' || status === 'known') {
      log(`[PENDING] Notice ${id} ${status === 'known' ? 'stored (not re-fetched)' : 'unchanged'} but has no analysis yet (earlier failure or deferral)`);
    }

    if (!deps.analyze || stats.aiStoppedReason) {
      stats.analysisDeferred++;
      log(`[DEFER] Notice ${id} analysis deferred to next run: ${stats.aiStoppedReason}`);
      continue;
    }

    if (aiCalls++ > 0 && aiDelayMs) await sleep(aiDelayMs);
    log(`[AI] Analyzing ${id}`);
    try {
      const result = await deps.analyze(notice);
      insertAnalysis(db, rowId, result, PROMPT_VERSION, contentHash(notice));
      stats.analyzed++;
      consecutiveOverloads = 0;
      const a = result.analysis;
      log(
        `[AI] Saved analysis for ${id} (${result.model}): ${a.category}, ` +
          `apply ${a.applicationStart ?? '?'} ~ ${a.applicationEnd ?? '?'}, deadline ${a.deadline ?? 'none'}, event ${a.eventDate ?? 'none'}`,
      );
      for (const w of result.validationWarnings) log(`[WARN] Notice ${id}: ${w}`);
      try {
        deps.onAnalyzed?.(rowId);
      } catch (hookErr) {
        log(`[WARN] Notice ${id}: onAnalyzed hook failed: ${describe(hookErr)}`);
      }
    } catch (err) {
      if (err instanceof AiApiError && err.noRequestSent) {
        stats.aiStoppedReason = `AI unavailable: ${err.message}`;
        stats.analysisDeferred++;
        log(`[DEFER] Notice ${id} analysis deferred to next run: ${err.message}`);
        log(`[AI] Stopping AI calls for this run: ${stats.aiStoppedReason}`);
        continue;
      }
      stats.analysisFailed++;
      stats.errors.push({ noticeId: id, stage: 'analysis', message: describe(err) });
      log(`[ERROR] Notice ${id} analysis failed (original notice kept): ${describe(err)}`);
      if (err instanceof AiApiError) {
        if (err.status === 429) {
          stats.aiStoppedReason = 'AI rate/quota limit reached (429)';
        } else if (err.status === 400 || err.status === 401 || err.status === 403 || err.status === 404) {
          stats.aiStoppedReason = `AI request rejected (${err.status}); check API key/model`;
        } else if (++consecutiveOverloads >= MAX_CONSECUTIVE_OVERLOADS) {
          stats.aiStoppedReason = `${consecutiveOverloads} consecutive AI failures (provider overloaded)`;
        }
        if (stats.aiStoppedReason) log(`[AI] Stopping AI calls for this run: ${stats.aiStoppedReason}`);
      }
    }
  }

  if (httpBefore && deps.httpRequests) {
    const now = deps.httpRequests();
    stats.http = { list: now.list - httpBefore.list, article: now.article - httpBefore.article };
  }
  return stats;
}

export interface IngestSource {
  id: string;
  listNotices: () => Promise<ListedNotice[]>;
  fetchNotice: (url: string) => Promise<RawNotice>;
  /** Max regular listed notices for this source (overrides deps.limit when set by the caller). */
  limit?: number;
  /** The board's HTTP request counter (BoardSource.requests), for stats.http. */
  httpRequests?: () => HttpCount;
}

export interface SourceRun {
  source: string;
  /** Listing failed (site down, layout change): nothing was processed for this source. */
  listFailed: string | null;
  stats: IngestStats | null;
}

/**
 * Runs ingest() for each source in order. One source failing (even its listing) never stops
 * the others. Once the AI stops (quota, bad key, overload), later sources defer too.
 */
export async function ingestAll(
  sources: IngestSource[],
  deps: Omit<IngestDeps, 'listNotices' | 'fetchNotice' | 'limit' | 'httpRequests'>,
): Promise<SourceRun[]> {
  const { log = console.log } = deps;
  const runs: SourceRun[] = [];
  let aiStoppedReason = deps.aiStoppedReason ?? null;
  for (const s of sources) {
    log(`[SOURCE] ${s.id}`);
    try {
      const stats = await ingest({
        ...deps, listNotices: s.listNotices, fetchNotice: s.fetchNotice, limit: s.limit, httpRequests: s.httpRequests, aiStoppedReason,
      });
      if (deps.analyze) aiStoppedReason = stats.aiStoppedReason;
      runs.push({ source: s.id, listFailed: null, stats });
    } catch (err) {
      log(`[ERROR] Source ${s.id} listing failed, skipping it this run: ${describe(err)}`);
      runs.push({ source: s.id, listFailed: describe(err), stats: null });
    }
  }
  return runs;
}

const describe = (err: unknown) => `${(err as Error).name}: ${(err as Error).message}`.replace(/\s+/g, ' ').slice(0, 300);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
