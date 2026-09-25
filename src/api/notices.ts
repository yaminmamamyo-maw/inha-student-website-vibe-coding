import type { DatabaseSync } from 'node:sqlite';
import { sourceMeta, sourceOrder } from '../sourceMeta.ts';
import type { AnalysisStatus, NoticeAnalysis, NoticeDetail, NoticeListItem, NoticeSourceRef } from './types.ts';

// Read-only queries behind the HTTP API. Each notice is joined with its LATEST
// analysis; `analysisStatus` says whether that analysis matches the current text.
// A notice cross-posted on several boards (notices.dup_of, see src/dedup.ts) is returned
// once, as its canonical copy, with every board listed in `sources`.

const SELECT = `
  SELECT n.*, a.id AS a_id, a.provider, a.model, a.prompt_version, a.category, a.application_start,
         a.application_end, a.deadline, a.event_date, a.en_json, a.target, a.summary_json, a.easy_explanation,
         a.evidence_json, a.uncertain_fields_json, a.validation_warnings_json, a.created_at AS analyzed_at,
         a.content_hash AS analyzed_hash
    FROM notices n
    LEFT JOIN notice_analysis a ON a.id = (SELECT max(id) FROM notice_analysis WHERE notice_id = n.id)`;

type Row = Record<string, any>;

function toAnalysis(r: Row): NoticeAnalysis | null {
  if (r.a_id == null) return null;
  const evidence = JSON.parse(r.evidence_json);
  return {
    category: r.category,
    applicationStart: r.application_start,
    applicationEnd: r.application_end,
    deadline: r.deadline,
    eventDate: r.event_date ?? null, // NULL for prompt-v1 analyses
    target: r.target,
    summary: JSON.parse(r.summary_json),
    easyExplanation: r.easy_explanation,
    evidence: { eventDate: null, ...evidence },
    uncertain: JSON.parse(r.uncertain_fields_json),
    en: r.en_json ? JSON.parse(r.en_json) : null,
    provider: r.provider,
    model: r.model,
    promptVersion: r.prompt_version,
    validationWarnings: JSON.parse(r.validation_warnings_json),
    analyzedAt: r.analyzed_at,
  };
}

const statusOf = (r: Row): AnalysisStatus => (r.a_id == null ? 'pending' : r.analyzed_hash === r.content_hash ? 'ready' : 'stale');

function toSourceRef(r: Row): NoticeSourceRef {
  return { source: r.source, kind: sourceMeta(r.source).kind, url: r.source_url, sourceNoticeId: r.source_notice_id, publishedAt: r.published_at };
}

/**
 * `group` = the canonical row first, then its duplicates. The group has ONE analysis (ingest
 * analyzes only one copy): the canonical's if current, else another copy's current one, else
 * the canonical's stale one, else any stale one.
 */
function toListItem(group: Row[]): NoticeListItem {
  const r = group[0];
  const withAnalysis =
    (statusOf(r) === 'ready' && r) ||
    group.find((m) => statusOf(m) === 'ready') ||
    (r.a_id != null && r) ||
    group.find((m) => m.a_id != null) ||
    r;
  const sources = [...group].sort((a, b) => sourceOrder(a.source) - sourceOrder(b.source) || a.id - b.id).map(toSourceRef);
  return {
    id: r.id,
    sourceNoticeId: r.source_notice_id,
    title: r.title,
    sourceUrl: r.source_url,
    sources,
    publishedAt: r.published_at,
    boardCategory: r.board_category,
    crawledAt: r.crawled_at,
    contentUpdatedAt: r.content_updated_at ?? null,
    analysisStatus: statusOf(withAnalysis),
    analysis: toAnalysis(withAnalysis),
  };
}

/** Rows grouped by canonical id, canonical row first, in the order of the canonical rows. */
function groupRows(rows: Row[]): Row[][] {
  const groups = new Map<number, Row[]>();
  for (const r of rows) if (r.dup_of == null) groups.set(r.id, [r]);
  for (const r of rows) {
    if (r.dup_of == null) continue;
    const group = groups.get(r.dup_of);
    if (group) group.push(r);
    else groups.set(r.id, [r]); // canonical row missing (should not happen): show the copy on its own
  }
  return [...groups.values()];
}

/** Newest first by publication date; one entry per notice, however many boards posted it. */
export function listNotices(db: DatabaseSync): NoticeListItem[] {
  const rows = db.prepare(`${SELECT} ORDER BY n.published_at DESC, n.id DESC`).all() as Row[];
  return groupRows(rows).map(toListItem);
}

/** Any copy's id works; the detail is always the canonical copy's (so old links keep working). */
export function getNoticeDetail(db: DatabaseSync, id: number): NoticeDetail | null {
  const me = db.prepare('SELECT id, dup_of FROM notices WHERE id = ?').get(id) as { id: number; dup_of: number | null } | undefined;
  if (!me) return null;
  const root = me.dup_of ?? me.id;
  const rows = db.prepare(`${SELECT} WHERE n.id = ? OR n.dup_of = ? ORDER BY n.dup_of IS NOT NULL, n.id`).all(root, root) as Row[];
  const r = rows[0];
  return {
    ...toListItem(rows),
    author: r.author,
    attachments: JSON.parse(r.attachments_json),
    originalContent: r.original_content,
  };
}

/** Ids of every stored copy, canonical or not (for the static export of detail files). */
export function allNoticeIds(db: DatabaseSync): number[] {
  return (db.prepare('SELECT id FROM notices ORDER BY id').all() as { id: number }[]).map((r) => r.id);
}
