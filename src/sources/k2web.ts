import * as cheerio from 'cheerio';
import { EmptyContentError, InvalidResponseError, NetworkError } from '../errors.ts';
import type { RawNotice } from '../types.ts';

// Shared parser/fetcher for Inha boards built on the K2Web CMS (the main site, college and
// department sites). Every board has the same markup:
//   list:    {origin}/bbs/{site}/{board}/artclList.do?page=N
//   article: {origin}/bbs/{site}/{board}/{articleId}/artclView.do
// One module per board in src/sources/ calls makeBoardSource() with its own config.

export const USER_AGENT = 'inha-notice-poc/0.1 (student project; contact: repo owner)';
const TIMEOUT_MS = 15_000;
const MIN_CONTENT_CHARS = 30;

export interface BoardConfig {
  /** Source key stored in notices.source, e.g. "inha-cse-notice". */
  source: string;
  /** https://host, no trailing slash. */
  origin: string;
  /** K2Web site code in the path (/bbs/{site}/…), e.g. "kr", "cse". */
  site: string;
  /** Board number in the path. */
  board: number;
}

/** One row of the board's list page. Only the ID/URL is trusted; details come from the article page. */
export interface ListedNotice {
  sourceNoticeId: string;
  url: string;
  title: string;
  /** 작성일 shown in the list, YYYY-MM-DD. */
  listedDate: string | null;
  /**
   * Pinned "일반공지" rows repeat on every page and can be old. A recent pinned post is often also
   * listed in the normal flow; listNotices() then reports it as regular (see uniqueListed).
   */
  pinned: boolean;
}

export interface BoardSource {
  config: BoardConfig;
  /** HTTP requests this board has made so far (list pages, articles); read by the ingest CLI. */
  readonly requests: { list: number; article: number };
  parseNoticeUrl(url: string): { sourceNoticeId: string; canonicalUrl: string };
  fetchNotice(url: string): Promise<RawNotice>;
  /** Reads list pages 1..pages and returns unique notices in page order (see uniqueListed). */
  listNotices(opts?: { pages?: number }): Promise<ListedNotice[]>;
  parseListHtml(html: string): ListedNotice[];
  parseNoticeHtml(html: string, ids: { sourceNoticeId: string; canonicalUrl: string }): RawNotice;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function makeBoardSource(config: BoardConfig): BoardSource {
  const { source, origin, site, board } = config;
  const base = `/bbs/${site}/${board}`;
  const urlPattern = new RegExp(`^${escapeRe(origin)}${escapeRe(base)}/(\\d+)/artclView\\.do$`);
  const hrefPattern = new RegExp(`${escapeRe(base)}/(\\d+)/artclView\\.do`);
  const articleUrl = (id: string) => `${origin}${base}/${id}/artclView.do`;
  const requests = { list: 0, article: 0 };

  function parseNoticeUrl(url: string) {
    const clean = url.trim().replace(/^http:/, 'https:').split(/[?#]/)[0];
    const m = clean.match(urlPattern);
    if (!m) throw new InvalidResponseError(`Not an ${source} article URL: ${url}`);
    return { sourceNoticeId: m[1], canonicalUrl: clean };
  }

  function parseListHtml(html: string): ListedNotice[] {
    const $ = cheerio.load(html);
    const rows: ListedNotice[] = [];
    $('table.artclTable tbody tr').each((_, tr) => {
      const link = $(tr).find('a.artclLinkView');
      const m = link.attr('href')?.match(hrefPattern);
      if (!m) return;
      // College/department boards wrap the title in <strong> next to a "새글" badge;
      // the main board has it as the link's own text.
      const strong = link.find('strong');
      const title = normalizeInline(strong.length ? strong.text() : link.clone().children().remove().end().text());
      rows.push({
        sourceNoticeId: m[1],
        url: articleUrl(m[1]),
        title,
        listedDate: parseKoreanDate($(tr).find('._artclTdRdate').text()),
        pinned: $(tr).hasClass('headline'),
      });
    });
    return rows;
  }

  async function listNotices({ pages = 1 }: { pages?: number } = {}): Promise<ListedNotice[]> {
    const all: ListedNotice[] = [];
    for (let page = 1; page <= pages; page++) {
      requests.list++;
      const html = await fetchHtml(`${origin}${base}/artclList.do?page=${page}`);
      const rows = parseListHtml(html);
      if (rows.length === 0) throw new InvalidResponseError(`List page ${page} has no notice rows (layout changed or site error page)`);
      all.push(...rows);
    }
    return uniqueListed(all);
  }

  function parseNoticeHtml(html: string, { sourceNoticeId, canonicalUrl }: { sourceNoticeId: string; canonicalUrl: string }): RawNotice {
    const $ = cheerio.load(html);

    const title = normalizeInline($('.artclViewTitle').first().text());
    const body = $('.artclView').first();
    if (!title || body.length === 0) {
      throw new InvalidResponseError(
        `Page structure not recognized (title=${Boolean(title)}, body=${body.length > 0}). ` +
          `The notice may have been deleted or the site layout changed.`,
      );
    }

    // Header metadata is a list of <dl><dt>label</dt><dd>value</dd></dl>.
    const meta = new Map<string, string>();
    $('.artclViewHead dl').each((_, dl) => {
      meta.set(normalizeInline($(dl).find('dt').text()), normalizeInline($(dl).find('dd').text()));
    });

    const attachments: RawNotice['attachments'] = [];
    body.find('img[src]').each((_, img) => {
      const src = new URL($(img).attr('src')!, origin).href;
      attachments.push({ kind: 'image', name: decodeURIComponent(src.split('/').pop() ?? src), url: src });
    });
    $('a[href*="/download.do"]').each((_, a) => {
      attachments.push({ kind: 'file', name: normalizeInline($(a).text()), url: new URL($(a).attr('href')!, origin).href });
    });

    const rawHtml = body.html() ?? '';
    const originalContent = htmlToText(rawHtml);
    if (originalContent.length < MIN_CONTENT_CHARS) {
      throw new EmptyContentError(
        `Notice body has only ${originalContent.length} chars of text` +
          (attachments.length ? ` (content is probably in ${attachments.length} image/file attachment(s))` : ''),
      );
    }

    return {
      source,
      sourceNoticeId,
      sourceUrl: canonicalUrl,
      title,
      originalContent,
      rawHtml,
      publishedAt: parseKoreanDate(meta.get('작성일')),
      boardCategory: meta.get('분류') || null,
      author: meta.get('작성자') || null,
      attachments,
      crawledAt: new Date().toISOString(),
    };
  }

  async function fetchNotice(url: string): Promise<RawNotice> {
    const ids = parseNoticeUrl(url);
    requests.article++;
    return parseNoticeHtml(await fetchHtml(ids.canonicalUrl), ids);
  }

  return { config, requests, parseNoticeUrl, fetchNotice, listNotices, parseListHtml, parseNoticeHtml };
}

/**
 * Unique notices in list order. A post that is both pinned and in the normal flow (K2Web repeats
 * recent pinned posts there) counts as a regular row, so it is subject to the ingest --limit.
 */
export function uniqueListed(rows: ListedNotice[]): ListedNotice[] {
  const seen = new Map<string, ListedNotice>();
  for (const row of rows) {
    const prev = seen.get(row.sourceNoticeId);
    if (!prev) seen.set(row.sourceNoticeId, { ...row });
    else if (prev.pinned && !row.pinned) prev.pinned = false;
  }
  return [...seen.values()];
}

export async function fetchHtml(url: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'ko' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new NetworkError(`Request to ${url} failed: ${(err as Error).message}`, { cause: err });
  }
  if (!res.ok) throw new InvalidResponseError(`HTTP ${res.status} ${res.statusText} from ${url}`);
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('text/html')) {
    throw new InvalidResponseError(`Expected HTML, got "${contentType}" from ${url}`);
  }
  return res.text();
}

/** Block-level tags become line breaks; inline tags are removed; whitespace collapsed per line. */
function htmlToText(html: string): string {
  const $ = cheerio.load(`<div id="root">${html.replace(/<br\s*\/?>/gi, '\n')}</div>`);
  $('script, style').remove();
  $('p, div, li, tr, h1, h2, h3, h4, h5, h6').each((_, el) => {
    $(el).append('\n');
  });
  return $('#root')
    .text()
    .replace(/ /g, ' ')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

function normalizeInline(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** "2026.09.22." -> "2026-09-22" */
function parseKoreanDate(s: string | undefined): string | null {
  const m = s?.match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null;
}
