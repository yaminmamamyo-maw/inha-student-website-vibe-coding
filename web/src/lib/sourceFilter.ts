import type { NoticeListItem } from '@shared/api/types.ts';
import type { Profile } from '@shared/profile.ts';
import { NOTICE_SOURCES, SOURCE_KINDS, type SourceMeta } from '@shared/sourceMeta.ts';

// Source ("출처") filter on the notice list: one option per board in NOTICE_SOURCES (so a new
// board appears without code changes), plus "내 학과" / "내 단과대" shortcuts from the profile.
// Pure logic (no React, no i18n) so it is unit-tested in test/sourceFilter.test.ts.
//
// URL: ?source=<board id> | my-major | my-college. Older ?source=main|college|department links
// are still understood (see resolveSource / canonicalSourceParam).

export const ALL_SOURCES = 'all';
export const MY_MAJOR = 'my-major';
export const MY_COLLEGE = 'my-college';

/** The profile's own department and college boards, or null when that board isn't collected. */
export function myBoards(profile: Profile | null): { major: SourceMeta | null; college: SourceMeta | null } {
  if (!profile) return { major: null, college: null };
  return {
    major: NOTICE_SOURCES.find((s) => s.kind === 'department' && s.major === profile.major) ?? null,
    college: NOTICE_SOURCES.find((s) => s.kind === 'college' && s.college === profile.college) ?? null,
  };
}

/**
 * What a ?source= value selects.
 * - all: no filter
 * - boards: notices posted on any of these boards
 * - uncollected: the profile's own board isn't crawled yet → show nothing (never other departments)
 */
export type SourceSelection =
  | { type: 'all' }
  | { type: 'boards'; ids: string[] }
  | { type: 'uncollected'; scope: 'major' | 'college'; unit: string };

export function resolveSource(raw: string | null, profile: Profile | null): SourceSelection {
  if (!raw || raw === ALL_SOURCES) return { type: 'all' };
  if (raw === MY_MAJOR || raw === MY_COLLEGE) {
    if (!profile) return { type: 'all' }; // shared "my" link opened without a profile
    const scope = raw === MY_MAJOR ? 'major' : 'college';
    const board = myBoards(profile)[scope];
    return board ? { type: 'boards', ids: [board.id] } : { type: 'uncollected', scope, unit: scope === 'major' ? profile.major : profile.college };
  }
  if (NOTICE_SOURCES.some((s) => s.id === raw)) return { type: 'boards', ids: [raw] };
  // legacy ?source=main|college|department: every board of that kind
  if ((SOURCE_KINDS as readonly string[]).includes(raw)) return { type: 'boards', ids: NOTICE_SOURCES.filter((s) => s.kind === raw).map((s) => s.id) };
  return { type: 'all' }; // unknown value (e.g. a board that was removed)
}

/**
 * The URL value an old/unknown link should be rewritten to, or null if it is already canonical.
 * A legacy kind with exactly one board becomes that board's id; unknown values are dropped (all).
 */
export function canonicalSourceParam(raw: string | null): string | null {
  if (!raw || raw === ALL_SOURCES || raw === MY_MAJOR || raw === MY_COLLEGE || NOTICE_SOURCES.some((s) => s.id === raw)) return null;
  if ((SOURCE_KINDS as readonly string[]).includes(raw)) {
    const boards = NOTICE_SOURCES.filter((s) => s.kind === raw);
    return boards.length === 1 ? boards[0].id : null; // several boards: keep the kind (it still filters)
  }
  return ALL_SOURCES;
}

export function matchesSource(n: NoticeListItem, sel: SourceSelection): boolean {
  if (sel.type === 'all') return true;
  if (sel.type === 'uncollected') return false;
  return n.sources.some((s) => sel.ids.includes(s.source));
}

export type SourceOption =
  | { value: typeof ALL_SOURCES; kind: 'all'; count: number }
  | { value: typeof MY_MAJOR | typeof MY_COLLEGE; kind: 'shortcut'; scope: 'major' | 'college'; board: SourceMeta | null; count: number }
  | { value: string; kind: 'board'; board: SourceMeta; count: number };

/**
 * Buttons in order: 전체 출처, [내 학과 — only if that board is collected], [내 단과대 — with a
 * profile], then every board in NOTICE_SOURCES order. A cross-posted notice counts for each board.
 */
export function sourceOptions(notices: NoticeListItem[], profile: Profile | null): SourceOption[] {
  const count = (ids: string[]) => notices.filter((n) => n.sources.some((s) => ids.includes(s.source))).length;
  const mine = myBoards(profile);
  const out: SourceOption[] = [{ value: ALL_SOURCES, kind: 'all', count: notices.length }];
  if (mine.major) out.push({ value: MY_MAJOR, kind: 'shortcut', scope: 'major', board: mine.major, count: count([mine.major.id]) });
  if (profile) out.push({ value: MY_COLLEGE, kind: 'shortcut', scope: 'college', board: mine.college, count: mine.college ? count([mine.college.id]) : 0 });
  for (const board of NOTICE_SOURCES) out.push({ value: board.id, kind: 'board', board, count: count([board.id]) });
  return out;
}

/** Display name of a board: its department or college name (Korean), or null for the main board. */
export const boardUnit = (board: Pick<SourceMeta, 'major' | 'college'>) => board.major ?? board.college;
