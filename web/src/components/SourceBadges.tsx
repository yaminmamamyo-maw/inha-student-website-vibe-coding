import type { NoticeSourceRef } from '@shared/api/types.ts';
import { sourceMeta } from '@shared/sourceMeta.ts';
import { useLanguage } from '../lib/language.tsx';
import { boardUnit } from '../lib/sourceFilter.ts';

/** Name of the board a notice was posted on: "본교"/"University", or the college/department name (kept in Korean). */
export function useBoardLabel() {
  const { t } = useLanguage();
  return (s: NoticeSourceRef) => boardUnit(sourceMeta(s.source)) ?? t.source.main;
}

/** One badge per board the notice was posted on, main → college → department, e.g. 본교 · AI융합대학 · 컴퓨터공학과. */
export function SourceBadges({ sources }: { sources: NoticeSourceRef[] }) {
  const label = useBoardLabel();
  return (
    <>
      {sources.map((s) => (
        <span key={`${s.source}:${s.sourceNoticeId}`} className="chip chip--source" data-kind={s.kind} lang={s.kind === 'main' ? undefined : 'ko'}>
          {label(s)}
        </span>
      ))}
    </>
  );
}
