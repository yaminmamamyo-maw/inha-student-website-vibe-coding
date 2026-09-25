// Which notice board a source is, and which college/major it belongs to.
// Dependency-free so the web frontend (badges, source filter) and match.ts can import it.
// Fetchers live in src/sources/; this file only describes them.

export const SOURCE_KINDS = ['main', 'college', 'department'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export interface SourceMeta {
  id: string;
  kind: SourceKind;
  /** College (as in src/inhaCatalog.ts) whose board this is; null for the main board. */
  college: string | null;
  /** Major (as in src/inhaCatalog.ts) whose board this is; only for department boards. */
  major: string | null;
}

// Order = display order of badges/links and ingest order (main first, so its copy becomes canonical).
export const NOTICE_SOURCES: SourceMeta[] = [
  { id: 'inha-main-notice', kind: 'main', college: null, major: null },
  { id: 'inha-aicc-notice', kind: 'college', college: 'AI융합대학', major: null },
  { id: 'inha-cse-notice', kind: 'department', college: 'AI융합대학', major: '컴퓨터공학과' },
  { id: 'inha-doai-notice', kind: 'department', college: 'AI융합대학', major: '인공지능공학과' },
  { id: 'inha-datascience-notice', kind: 'department', college: 'AI융합대학', major: '데이터사이언스학과' },
  { id: 'inha-designtech-notice', kind: 'department', college: 'AI융합대학', major: '디자인테크놀로지학과' },
  { id: 'inha-sme-notice', kind: 'department', college: 'AI융합대학', major: '스마트모빌리티공학과' },
];

const UNKNOWN: Omit<SourceMeta, 'id'> = { kind: 'main', college: null, major: null };

export const sourceMeta = (id: string): SourceMeta => NOTICE_SOURCES.find((s) => s.id === id) ?? { id, ...UNKNOWN };

/** Position in NOTICE_SOURCES (unknown sources last), for stable ordering. */
export const sourceOrder = (id: string) => {
  const i = NOTICE_SOURCES.findIndex((s) => s.id === id);
  return i === -1 ? NOTICE_SOURCES.length : i;
};
