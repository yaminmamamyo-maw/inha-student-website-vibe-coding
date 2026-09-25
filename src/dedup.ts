// Cross-source duplicate detection: the same notice is often posted on the main, college and
// department boards, with a board prefix ("[학부]", "[인재개발팀]") and a 작성일 a day apart.
// Deterministic, no AI: same normalized title + 작성일 within DEDUP_WINDOW_DAYS + different source.
// Dependency-free (shared by db.ts and tests).

export const DEDUP_WINDOW_DAYS = 3;
/** Shorter keys ("공지", "안내") are too generic to merge on. */
const MIN_KEY_CHARS = 6;

const LEADING_TAG = /^\s*(?:\[[^\]]*\]|\([^)]*\)|【[^】]*】|<[^>]*>|★+|☆+)\s*/;

/**
 * Title → dedup key, or null when the title is too short to merge safely.
 * Leading tags are dropped, but a "대학원" tag is kept as a marker so a graduate-school notice
 * never merges with the undergraduate one of the same name ("[대학원] X" ≠ "[학부] X" = "X").
 */
export function normalizeTitle(title: string): string | null {
  let rest = title.normalize('NFKC');
  let grad = false;
  for (let m = rest.match(LEADING_TAG); m && m[0].length > 0; m = rest.match(LEADING_TAG)) {
    if (/대학원/.test(m[0]) && !/학부/.test(m[0])) grad = true;
    rest = rest.slice(m[0].length);
  }
  const core = rest
    .replace(/[★☆]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
  if (core.length < MIN_KEY_CHARS) return null;
  return grad ? `grad:${core}` : core;
}

/** |a - b| in days for YYYY-MM-DD strings; null if either is missing. */
export function daysApart(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
}

/** The rule db.ts applies (in SQL) when grouping a newly stored notice. */
export function isSameNotice(
  a: { source: string; title: string; publishedAt: string | null },
  b: { source: string; title: string; publishedAt: string | null },
): boolean {
  if (a.source === b.source) return false;
  const ka = normalizeTitle(a.title);
  if (!ka || ka !== normalizeTitle(b.title)) return false;
  const d = daysApart(a.publishedAt, b.publishedAt);
  return d !== null && d <= DEDUP_WINDOW_DAYS;
}
