import * as aicc from './inhaAiccNotice.ts';
import * as cse from './inhaCseNotice.ts';
import * as ds from './inhaDatascienceNotice.ts';
import * as dt from './inhaDesigntechNotice.ts';
import * as doai from './inhaDoaiNotice.ts';
import type { BoardSource } from './k2web.ts';
import * as main from './inhaMainNotice.ts';
import * as sme from './inhaSmeNotice.ts';

// Every board the ingest CLI can crawl, in ingest order (main first, so a cross-posted
// notice's main-board copy becomes the canonical one). Metadata for the UI: src/sourceMeta.ts.

export interface SourceEntry {
  id: string;
  /** Short name for `--source`. */
  alias: string;
  board: BoardSource;
  /** Listed notices processed per run unless --limit is given (undefined = whole list page). */
  defaultLimit?: number;
}

export const SOURCES: SourceEntry[] = [
  { id: main.SOURCE, alias: 'main', board: main.board },
  { id: aicc.SOURCE, alias: 'aicc', board: aicc.board, defaultLimit: 10 },
  { id: cse.SOURCE, alias: 'cse', board: cse.board, defaultLimit: 10 },
  { id: doai.SOURCE, alias: 'ai', board: doai.board, defaultLimit: 10 },
  { id: ds.SOURCE, alias: 'ds', board: ds.board, defaultLimit: 10 },
  { id: dt.SOURCE, alias: 'dt', board: dt.board, defaultLimit: 10 },
  { id: sme.SOURCE, alias: 'sme', board: sme.board, defaultLimit: 10 },
];

/** "cse,aicc" / "inha-cse-notice" → entries in SOURCES order. Throws on an unknown name. */
export function selectSources(spec: string | undefined): SourceEntry[] {
  if (!spec) return SOURCES;
  const names = spec.split(',').map((s) => s.trim()).filter(Boolean);
  for (const n of names) {
    if (!SOURCES.some((s) => s.alias === n || s.id === n)) {
      throw new Error(`Unknown source "${n}". Known: ${SOURCES.map((s) => `${s.alias} (${s.id})`).join(', ')}`);
    }
  }
  return SOURCES.filter((s) => names.includes(s.alias) || names.includes(s.id));
}

/** The source whose board an article URL belongs to (for `crawl` / `poc`). */
export function sourceForUrl(url: string): SourceEntry {
  for (const s of SOURCES) {
    try {
      s.board.parseNoticeUrl(url);
      return s;
    } catch {
      // not this board
    }
  }
  return SOURCES[0]; // main board: its parseNoticeUrl gives the usual error message
}
