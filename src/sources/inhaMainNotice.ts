import { makeBoardSource } from './k2web.ts';

// Source: 인하대학교 대표 홈페이지 공지사항 (www.inha.ac.kr, board 8).
// Article pages have stable URLs: https://www.inha.ac.kr/bbs/kr/8/{id}/artclView.do
// Parsing/fetching is shared by all K2Web boards (./k2web.ts); see docs/notice-sources.md.

export const SOURCE = 'inha-main-notice';

export const board = makeBoardSource({ source: SOURCE, origin: 'https://www.inha.ac.kr', site: 'kr', board: 8 });
export const { parseNoticeUrl, fetchNotice, listNotices, parseListHtml, parseNoticeHtml } = board;
export type { ListedNotice } from './k2web.ts';
