// Response shapes of the read-only HTTP API (src/server.ts), shared with the web frontend.
// Type-only imports: nothing here pulls AI or DB code into the browser bundle.
import type { Analysis, AnalysisEn } from '../analyze.ts';
import type { SourceKind } from '../sourceMeta.ts';
import type { RawNotice } from '../types.ts';

/**
 * ready   = analysis made from the notice's current text
 * stale   = the notice changed after it was analyzed (analysis shown, but flagged)
 * pending = not analyzed yet (new, failed, or deferred by AI quota)
 */
export type AnalysisStatus = 'ready' | 'stale' | 'pending';

export type { AnalysisEn };

export type NoticeAnalysis = Omit<Analysis, 'en'> & {
  /** English rendering (prompt v3+). null for older analyses — the UI must fall back to Korean. */
  en: AnalysisEn | null;
  provider: string;
  model: string;
  promptVersion: string;
  validationWarnings: string[];
  analyzedAt: string;
};

/** One board a notice was posted on (see src/sourceMeta.ts for college/major of the board). */
export interface NoticeSourceRef {
  source: string;
  kind: SourceKind;
  /** Official notice URL on that board. */
  url: string;
  sourceNoticeId: string;
  publishedAt: string | null;
}

export interface NoticeListItem {
  /** notices.id of the canonical copy (the first board it was stored from). */
  id: number;
  sourceNoticeId: string;
  title: string;
  /** Official notice URL of the canonical copy — always shown so users can verify. */
  sourceUrl: string;
  /**
   * Every board this notice appears on (cross-posted copies are merged, src/dedup.ts),
   * main → college → department. Always at least one entry.
   */
  sources: NoticeSourceRef[];
  publishedAt: string | null;
  boardCategory: string | null;
  crawledAt: string;
  contentUpdatedAt: string | null;
  analysisStatus: AnalysisStatus;
  analysis: NoticeAnalysis | null;
}

export interface NoticeDetail extends NoticeListItem {
  author: string | null;
  attachments: RawNotice['attachments'];
  originalContent: string;
}

export interface ApiError {
  error: string;
}
