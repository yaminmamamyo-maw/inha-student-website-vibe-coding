import { makeBoardSource } from './k2web.ts';

// Source: AI융합대학 공지사항 (aicc.inha.ac.kr, site "act", board 716). The college that
// 컴퓨터공학과 belongs to. Same K2Web markup as the main site; see docs/notice-sources.md.

export const SOURCE = 'inha-aicc-notice';

export const board = makeBoardSource({ source: SOURCE, origin: 'https://aicc.inha.ac.kr', site: 'act', board: 716 });
export const { parseNoticeUrl, fetchNotice, listNotices, parseListHtml, parseNoticeHtml } = board;
