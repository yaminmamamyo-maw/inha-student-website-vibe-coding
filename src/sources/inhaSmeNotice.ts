import { makeBoardSource } from './k2web.ts';

// Source: 스마트모빌리티공학과 공지사항 (sme.inha.ac.kr, site "sme", board 703), in AI융합대학. Same K2Web markup as
// the main site; see docs/notice-sources.md.

export const SOURCE = 'inha-sme-notice';

export const board = makeBoardSource({ source: SOURCE, origin: 'https://sme.inha.ac.kr', site: 'sme', board: 703 });
export const { parseNoticeUrl, fetchNotice, listNotices, parseListHtml, parseNoticeHtml } = board;
