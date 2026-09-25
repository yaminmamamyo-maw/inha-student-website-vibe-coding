import { makeBoardSource } from './k2web.ts';

// Source: 데이터사이언스학과 공지사항 (datascience.inha.ac.kr, site "datascience", board 746), in AI융합대학. Same K2Web markup as
// the main site; see docs/notice-sources.md.

export const SOURCE = 'inha-datascience-notice';

export const board = makeBoardSource({ source: SOURCE, origin: 'https://datascience.inha.ac.kr', site: 'datascience', board: 746 });
export const { parseNoticeUrl, fetchNotice, listNotices, parseListHtml, parseNoticeHtml } = board;
