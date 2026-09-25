import { makeBoardSource } from './k2web.ts';

// Source: 컴퓨터공학과 공지사항 (cse.inha.ac.kr, site "cse", board 242). Same K2Web markup as
// the main site; see docs/notice-sources.md.

export const SOURCE = 'inha-cse-notice';

export const board = makeBoardSource({ source: SOURCE, origin: 'https://cse.inha.ac.kr', site: 'cse', board: 242 });
export const { parseNoticeUrl, fetchNotice, listNotices, parseListHtml, parseNoticeHtml } = board;
