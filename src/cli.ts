import './env.ts';
import { existsSync, readFileSync } from 'node:fs';
import { createProvider, type AiProvider } from './ai/index.ts';
import { analyzeNotice, PROMPT_VERSION } from './analyze.ts';
import { contentHash, counts, currentGroupAnalysis, DB_PATH, getNotice, insertAnalysis, listNoticesWithLatestAnalysis, openDb, upsertNotice } from './db.ts';
import { InvalidAiJsonError, PocError } from './errors.ts';
import { getNoticeDetail } from './api/notices.ts';
import { ingestAll, todayKst, type IngestStats } from './ingest.ts';
import { notificationCandidates } from './match.ts';
import { buildNotification } from './notifications.ts';
import { parseProfile, type Profile } from './profile.ts';
import { selectSources, sourceForUrl } from './sources/index.ts';

const USAGE = `Usage:
  npm run crawl -- <notice-url>              fetch + parse only (no DB, no AI)
  npm run poc   -- <notice-url> [--reanalyze] fetch -> DB -> AI -> DB -> print
  npm run show  [-- <notice-id>]             print stored notices + latest analysis
  npm run ingest [-- --source main|aicc|cse|ai|ds|dt|sme[,...]] [--pages N] [--limit N] [--full] [--no-ai] [--upgrade-prompt]
                                             crawl board lists (all sources by default) -> fetch only new posts
                                             (+ known ones posted in the last 7 days or with a date not passed yet;
                                             --full re-fetches all) -> new/updated/duplicate detection -> DB -> AI
                                             only where needed. --limit counts regular posts; pinned ones are extra`;

async function main(argv: string[]) {
  const [command, ...rest] = argv;
  const url = rest.find((a) => !a.startsWith('--'));

  switch (command) {
    case 'crawl': {
      if (!url) throw new UsageError();
      const n = await sourceForUrl(url).board.fetchNotice(url);
      printJson('RawNotice', { ...n, rawHtml: `<${n.rawHtml.length} chars>` });
      return;
    }
    case 'poc': {
      if (!url) throw new UsageError();
      return runPipeline(url, rest.includes('--reanalyze'));
    }
    case 'show': {
      const db = openDb();
      const rows = listNoticesWithLatestAnalysis(db).filter((r) => !url || String(r.id) === url);
      if (rows.length === 0) console.log(`No notices stored in ${DB_PATH}.`);
      for (const r of rows) printJson(`notices.id=${r.id}`, decodeJsonColumns(r));
      return;
    }
    case 'ingest':
      return runIngest(rest);
    default:
      throw new UsageError();
  }
}

async function runIngest(args: string[]) {
  const value = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const flag = (name: string) => (value(name) === undefined ? undefined : Number(value(name)));
  const sources = selectSources(value('--source'));
  const pages = flag('--pages') ?? 1;
  const db = openDb();
  console.log(`[DB] before: ${JSON.stringify(counts(db))}`);

  let provider: AiProvider | null = null;
  if (!args.includes('--no-ai')) {
    try {
      provider = createProvider();
      console.log(`[AI] provider ${provider.name}, model ${provider.model}`);
    } catch (err) {
      console.log(`[AI] disabled for this run: ${(err as Error).message}`);
    }
  }

  // Personalization foundation: match each newly analyzed notice against saved profiles
  // (data/profiles.json, optional). Only logs for now — no notifications are sent.
  const profiles = loadProfiles();
  if (profiles.length) console.log(`[MATCH] ${profiles.length} profile(s) loaded; new analyses will be matched`);
  const today = todayKst();

  // One board after another; a failing board never stops the others (see ingestAll).
  const sourceRuns = sources.map((s) => ({
    id: s.id,
    listNotices: () => s.board.listNotices({ pages }),
    fetchNotice: s.board.fetchNotice,
    limit: flag('--limit') ?? s.defaultLimit,
    httpRequests: () => s.board.requests,
  }));
  const runs = await ingestAll(sourceRuns, {
    db,
    analyze: provider ? (n) => analyzeNotice(n, provider) : null,
    upgradePrompt: args.includes('--upgrade-prompt'),
    full: args.includes('--full'),
    today,
    aiName: provider?.name,
    aiDelayMs: Number(process.env.INGEST_AI_DELAY_MS ?? 4000),
    onAnalyzed: profiles.length
      ? (noticeId) => {
          const notice = getNoticeDetail(db, noticeId);
          if (!notice) return;
          for (const c of notificationCandidates(notice, profiles, today)) {
            console.log(`[MATCH] Notice ${notice.sourceNoticeId} → ${c.profileId}: ${c.result.matchLevel} (${c.result.matchReasons.join(', ')})`);
            // bilingual message, ready for a future sender to pick by the user's language (nothing is sent)
            const m = buildNotification(notice, c.result);
            console.log(`[NOTIFY] ko: ${m.titleKo} · ${m.bodyKo} | en: ${m.titleEn} · ${m.bodyEn}`);
          }
        }
      : undefined,
  });

  let failed = false;
  for (const run of runs) {
    if (!run.stats) {
      console.log(`[DONE] ${run.source}: listing failed: ${run.listFailed}`);
      failed = true;
      continue;
    }
    const { errors, http, ...summary }: IngestStats = run.stats;
    const httpLine = http ? ` http=${http.list + http.article} (list ${http.list}, article ${http.article})` : '';
    console.log(`[DONE] ${run.source}:${httpLine} ${JSON.stringify(summary)}`);
    for (const e of errors) console.log(`  - ${e.noticeId} (${e.stage}): ${e.message}`);
    if (run.stats.crawlFailed || run.stats.analysisFailed) failed = true;
  }
  if (provider) console.log(`[AI] ${provider.name} requests this run: ${provider.requestCount ?? 'n/a'}`);
  console.log(`[DB] after: ${JSON.stringify(counts(db))}`);
  if (failed) process.exitCode = 2;
}

async function runPipeline(url: string, reanalyze: boolean) {
  const db = openDb();

  step(1, 'Crawl');
  const notice = await sourceForUrl(url).board.fetchNotice(url);
  console.log(`  source URL : ${notice.sourceUrl}`);
  console.log(`  title      : ${notice.title}`);
  console.log(`  published  : ${notice.publishedAt ?? '(none)'}   board category: ${notice.boardCategory ?? '(none)'}`);
  console.log(`  content    : ${notice.originalContent.length} chars, ${notice.originalContent.split('\n').length} lines`);
  console.log(`  not parsed : ${notice.attachments.map((a) => `${a.kind}:${a.name}`).join(', ') || '(none)'}`);

  step(2, 'Store original notice');
  const { id: noticeId, status, changed } = upsertNotice(db, notice);
  if (status === 'new') console.log(`  inserted notices.id=${noticeId} into ${DB_PATH}`);
  else if (status === 'updated') console.log(`  UPDATED notices.id=${noticeId}: ${changed.join(', ')} changed on the site; stored row refreshed`);
  else console.log(`  DUPLICATE: notices.id=${noticeId} already stored and unchanged. No new row inserted; crawled_at updated.`);
  if (currentGroupAnalysis(db, noticeId) !== null && !reanalyze) {
    console.log('  Analysis for the current content already exists; skipping the AI call (pass --reanalyze to force).');
    printStored(db, noticeId);
    return;
  }

  step(3, 'Analyze with AI');
  let result;
  try {
    result = await analyzeNotice(notice);
  } catch (err) {
    if (err instanceof InvalidAiJsonError && err.rawResponse) {
      console.error(`  raw model output:\n${err.rawResponse}`);
    }
    console.error(`  The original notice is still stored as notices.id=${noticeId}; only the analysis failed.`);
    throw err;
  }
  console.log(`  provider: ${result.provider}   model: ${result.model}`);
  printJson('AI result', result.analysis);
  if (result.validationWarnings.length) {
    console.log(`  VALIDATION WARNINGS:\n    - ${result.validationWarnings.join('\n    - ')}`);
  } else {
    console.log('  validation: all dates well-formed and backed by verbatim quotes from the notice');
  }

  step(4, 'Store analysis');
  const analysisId = insertAnalysis(db, noticeId, result, PROMPT_VERSION, contentHash(notice));
  console.log(`  inserted notice_analysis.id=${analysisId} (notice_id=${noticeId})`);

  printStored(db, noticeId);
}

function printStored(db: ReturnType<typeof openDb>, noticeId: number) {
  step(5, 'Read back from database');
  const n = getNotice(db, noticeId)!;
  printJson('notices row', { ...n, raw_html: `<${String(n.raw_html).length} chars>`, original_content: `<${String(n.original_content).length} chars>` });
  const row = listNoticesWithLatestAnalysis(db).find((r) => r.id === noticeId);
  printJson('notice joined with latest analysis (id = notices.id, analysis_id = notice_analysis.id)', decodeJsonColumns(row ?? {}));
}

function decodeJsonColumns(row: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(row).map(([k, v]) => [k.replace(/_json$/, ''), k.endsWith('_json') && typeof v === 'string' ? JSON.parse(v) : v]),
  );
}

const step = (n: number, label: string) => console.log(`\n[${n}] ${label}`);
const printJson = (label: string, v: unknown) => console.log(`  ${label}:\n${JSON.stringify(v, null, 2).replace(/^/gm, '    ')}`);

/** Optional demo profiles for match logging: data/profiles.json = [{ "id": "...", "profile": {...} }]. */
function loadProfiles(): { id: string; profile: Profile }[] {
  const file = process.env.PROFILES_FILE ?? 'data/profiles.json';
  if (!existsSync(file)) return [];
  const raw = JSON.parse(readFileSync(file, 'utf8')) as { id?: string; profile?: unknown }[];
  return raw.flatMap((r, i) => {
    const profile = parseProfile(r.profile);
    return profile ? [{ id: r.id ?? `profile-${i + 1}`, profile }] : [];
  });
}

class UsageError extends Error {}

main(process.argv.slice(2)).catch((err) => {
  if (err instanceof UsageError) {
    console.error(USAGE);
  } else if (err instanceof PocError) {
    console.error(`\nFAILED — ${err.name}: ${err.message}`);
    if (err.cause) console.error(`  cause: ${(err.cause as Error).message ?? err.cause}`);
  } else {
    console.error('\nFAILED — unexpected error:', err);
  }
  process.exitCode = 1;
});
