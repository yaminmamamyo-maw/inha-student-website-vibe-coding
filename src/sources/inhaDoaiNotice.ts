import { makeBoardSource } from './k2web.ts';

// Source: 인공지능공학과 공지사항 (doai.inha.ac.kr, site "doai", board 731). Same K2Web markup as
// the main site; see docs/notice-sources.md.

export const SOURCE = 'inha-doai-notice';

export const board = makeBoardSource({ source: SOURCE, origin: 'https://doai.inha.ac.kr', site: 'doai', board: 731 });
export const { parseNoticeUrl, fetchNotice, listNotices, parseListHtml, parseNoticeHtml } = board;
