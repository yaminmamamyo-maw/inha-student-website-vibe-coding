// Pure keyword search over the notice list. No AI, no network — filters an already-fetched list.
import type { NoticeListItem } from '@shared/api/types.ts';
import { categoryName, type Lang, noticeTitle } from './i18n.ts';

const normalize = (s: string) => s.replace(/\s+/g, '').toLowerCase();

export function searchTerms(query: string): string[] {
  return query.trim().split(/\s+/).filter(Boolean).map(normalize);
}

/**
 * Title, AI summary bullets, target and category name in the given UI language (Korean falls back
 * when English analysis is missing), kept as separate fields — never concatenated into one string —
 * so a query term can't match by spanning the boundary between two of them (e.g. a title ending in
 * "...장" plus a target starting with "학...").
 */
export function searchableFields(n: NoticeListItem, lang: Lang): string[] {
  const a = n.analysis;
  if (!a) return [n.title];
  const en = lang === 'en' ? a.en : null;
  const summary = en ? en.summary : a.summary;
  const target = en ? en.target : a.target;
  return [noticeTitle(n, lang), ...summary, target, categoryName(a.category, lang)];
}

/**
 * Case/whitespace-insensitive occurrences of any term in `text`, as original-text character spans
 * (so highlighting can preserve the real spacing/case), merged where they overlap or touch.
 */
function matchSpans(text: string, terms: string[]): Array<[number, number]> {
  if (!text || terms.length === 0) return [];
  const normChars: string[] = [];
  const origIndex: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (/\s/.test(c)) continue;
    normChars.push(c.toLowerCase());
    origIndex.push(i);
  }
  const normText = normChars.join('');
  const spans: Array<[number, number]> = [];
  for (const term of terms) {
    if (!term) continue;
    let from = 0;
    while (from <= normText.length - term.length) {
      const idx = normText.indexOf(term, from);
      if (idx === -1) break;
      spans.push([origIndex[idx], origIndex[idx + term.length - 1] + 1]);
      from = idx + 1;
    }
  }
  if (spans.length === 0) return [];
  spans.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: Array<[number, number]> = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
    else merged.push(span);
  }
  return merged;
}

/** Whitespace/case-insensitive substring match; multiple space-separated words are AND'd ("장학" matches "장학금"), each term matched within a single field. */
export function matchesSearch(n: NoticeListItem, query: string, lang: Lang): boolean {
  const terms = searchTerms(query);
  if (terms.length === 0) return true;
  const fields = searchableFields(n, lang);
  return terms.every((term) => fields.some((field) => matchSpans(field, [term]).length > 0));
}

export interface HighlightPart {
  text: string;
  match: boolean;
}

/** Splits `text` into alternating plain/matched parts for rendering (e.g. `<mark>`), preserving the original spacing and case. */
export function highlightTerms(text: string, terms: string[]): HighlightPart[] {
  const spans = matchSpans(text, terms);
  if (spans.length === 0) return [{ text, match: false }];
  const parts: HighlightPart[] = [];
  let pos = 0;
  for (const [s, e] of spans) {
    if (s > pos) parts.push({ text: text.slice(pos, s), match: false });
    parts.push({ text: text.slice(s, e), match: true });
    pos = e;
  }
  if (pos < text.length) parts.push({ text: text.slice(pos), match: false });
  return parts;
}

/** A short excerpt of `text` centered on its first match, with ellipses where it was trimmed. Returns `text` unchanged if there's no match or it already fits within `radius` on each side. */
export function excerptAroundMatch(text: string, terms: string[], radius = 24): string {
  const spans = matchSpans(text, terms);
  if (spans.length === 0) return text;
  const [s, e] = spans[0];
  const start = Math.max(0, s - radius);
  const end = Math.min(text.length, e + radius);
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
}

export interface SearchMatch {
  field: 'title' | 'summary' | 'target';
  /** Full title for `field: 'title'`; a short excerpt (see excerptAroundMatch) for summary/target. */
  text: string;
}

/**
 * Where to show a highlighted match on a notice card: the title if it matched, else the first
 * matching AI-summary bullet or the target (eligibility) text as a short excerpt, else `null` (e.g.
 * only the category name matched — already shown as a chip, so there's nothing extra to preview).
 */
export function bestSearchMatch(n: NoticeListItem, query: string, lang: Lang): SearchMatch | null {
  const terms = searchTerms(query);
  if (terms.length === 0) return null;

  const title = noticeTitle(n, lang);
  if (matchSpans(title, terms).length > 0) return { field: 'title', text: title };

  const a = n.analysis;
  if (!a) return null;
  const en = lang === 'en' ? a.en : null;
  const summary = en ? en.summary : a.summary;
  const target = en ? en.target : a.target;

  const bullet = summary.find((s) => matchSpans(s, terms).length > 0);
  if (bullet) return { field: 'summary', text: excerptAroundMatch(bullet, terms) };
  if (matchSpans(target, terms).length > 0) return { field: 'target', text: excerptAroundMatch(target, terms) };
  return null;
}
