import { makeBoardSource } from './k2web.ts';

// Source: 디자인테크놀로지학과 공지사항 (designtech.inha.ac.kr, site "designtech", board 742), in AI융합대학. Same K2Web markup as
// the main site; see docs/notice-sources.md.

export const SOURCE = 'inha-designtech-notice';

export const board = makeBoardSource({ source: SOURCE, origin: 'https://designtech.inha.ac.kr', site: 'designtech', board: 742 });
export const { parseNoticeUrl, fetchNotice, listNotices, parseListHtml, parseNoticeHtml } = board;
