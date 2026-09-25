import type { NoticeDetail } from '@shared/api/types.ts';
import { useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { DdayBadge } from '../components/DdayBadge.tsx';
import { LanguageToggle } from '../components/LanguageToggle.tsx';
import { SourceBadges, useBoardLabel } from '../components/SourceBadges.tsx';
import { deadlineOf } from '../components/NoticeCard.tsx';
import { StateMessage } from '../components/StateMessage.tsx';
import { api, useApi } from '../lib/api.ts';
import { calendarHref } from '../lib/calendar.ts';
import { CATEGORY_TINT } from '../lib/categories.ts';
import { dday, fullDate, shortDate, todayKst } from '../lib/dates.ts';
import { categoryName, type Lang } from '../lib/i18n.ts';
import { useLanguage } from '../lib/language.tsx';
import { downloadIcs } from '../lib/ics.ts';
import { useSaved } from '../lib/saved.tsx';
import './NoticeDetailPage.css';

export function NoticeDetailPage() {
  const id = Number(useParams().id);
  const state = useApi((signal) => api.notice(id, signal), id);
  // The global app language (lib/language.tsx); this page has no language state of its own.
  const { lang, t: all } = useLanguage();
  const t = all.notice;
  // Came from the calendar? Go back to that exact view (month/day/highlight), else to the list.
  const from = (useLocation().state as { from?: string } | null)?.from;
  const fromCalendar = from?.startsWith('/calendar');

  return (
    <article className="detail" lang={lang}>
      <Link to={fromCalendar ? from! : '/'} className="pill detail__back">
        {fromCalendar ? t.backToCalendar : t.back}
      </Link>
      {state.status === 'loading' && <StateMessage title={t.loading} />}
      {state.status === 'error' &&
        (state.error === 'Notice not found' ? (
          <StateMessage title={t.notFound}>{t.notFoundBody}</StateMessage>
        ) : (
          <StateMessage title={t.loadError} action={{ label: all.common.retry, onClick: state.retry }}>
            {state.error}
          </StateMessage>
        ))}
      {state.status === 'ok' && (
        <Detail notice={state.data} lang={lang} />
      )}
    </article>
  );
}

function Detail({ notice, lang }: { notice: NoticeDetail; lang: Lang }) {
  const { t: all } = useLanguage();
  const t = all.notice;
  const a = notice.analysis;
  const deadline = deadlineOf(notice);
  const [showAllSummary, setShowAllSummary] = useState(false);
  const [calendarMsg, setCalendarMsg] = useState<'added' | 'removed' | 'ics' | null>(null);
  const hasDates = Boolean(deadline || a?.eventDate);
  // "캘린더에 추가" saves the notice to the in-app calendar ("내 일정"); .ics export stays as a secondary option.
  const { isSaved, add, remove } = useSaved();
  const saved = isSaved(notice.id);
  const baseLink = calendarHref(notice, todayKst());
  const calendarLink = baseLink && saved ? `${baseLink}&view=mine` : baseLink;

  // English content comes from the backend (analysis.en, prompt v3+). If it is missing,
  // show the Korean original with a note — never translate on the client.
  const en = lang === 'en' ? (a?.en ?? null) : null;
  const englishMissing = lang === 'en' && a !== null && en === null;
  const title = en?.title ?? notice.title;
  const summary = en?.summary ?? a?.summary ?? [];
  const easy = en?.easyExplanation ?? a?.easyExplanation ?? '';
  const target = en?.target ?? a?.target ?? '';
  const contentLang: Lang = en ? 'en' : 'ko'; // for screen readers / hyphenation
  const boardLabel = useBoardLabel();

  return (
    <>
      <header className="detail__head">
        <div className="detail__tags">
          {a ? (
            <span className="chip" style={{ background: CATEGORY_TINT[a.category] }} title={t.category}>
              {categoryName(a.category, lang)}
            </span>
          ) : (
            <span className="chip chip--pending">{all.common.pending}</span>
          )}
          <SourceBadges sources={notice.sources} />
          {notice.boardCategory && (
            <span className="detail__board">
              {t.boardCategory} · <span lang="ko">{notice.boardCategory}</span>
            </span>
          )}
          {/* same global toggle as the nav, repeated here for discoverability */}
          <span className="detail__lang">
            <LanguageToggle />
          </span>
        </div>
        <h1 className="detail__title" lang={contentLang}>
          {title}
        </h1>
        {en && (
          <p className="detail__title-ko" lang="ko">
            {notice.title}
          </p>
        )}
        <p className="detail__meta">
          {t.posted} {notice.publishedAt ? fullDate(notice.publishedAt, lang) : '—'}
          {notice.author && <> · <span lang="ko">{notice.author}</span></>}
          {/* one link per board it was posted on (cross-posted copies are merged into this notice) */}
          {notice.sources.length > 1 ? (
            notice.sources.map((s) => (
              <span key={s.url}>
                {' · '}
                <a href={s.url} target="_blank" rel="noreferrer">
                  {all.source.viewOriginal(boardLabel(s))}
                </a>
              </span>
            ))
          ) : (
            <>
              {' · '}
              <a href={notice.sourceUrl} target="_blank" rel="noreferrer">
                {t.viewOriginal}
              </a>
            </>
          )}
        </p>
      </header>

      {englishMissing && (
        <p className="detail__banner detail__banner--info" role="status">
          {t.noEnglish}
        </p>
      )}
      {notice.analysisStatus === 'stale' && <p className="detail__banner detail__banner--stale">{t.staleBanner}</p>}

      {!a ? (
        <section className="detail__pending">
          <p className="detail__pending-title">{t.pendingTitle}</p>
          <p>{t.pendingBody}</p>
          <a href={notice.sourceUrl} target="_blank" rel="noreferrer" className="pill">
            {t.viewOriginal}
          </a>
        </section>
      ) : (
        <div className="detail__layout">
          <div className="detail__main" lang={contentLang}>
            <section aria-labelledby="sum">
              <h2 id="sum" className="detail__h2" lang={lang}>
                <em>AI</em> {t.summary}
              </h2>
              <ol className="detail__summary">
                {(showAllSummary ? summary : summary.slice(0, 3)).map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
              {summary.length > 3 && (
                <button type="button" className="detail__more" lang={lang} onClick={() => setShowAllSummary((v) => !v)}>
                  {showAllSummary ? t.lessSummary : t.moreSummary(summary.length - 3)}
                </button>
              )}
            </section>

            <section className="detail__easy" aria-labelledby="easy">
              <h2 id="easy" className="detail__h2" lang={lang}>
                {t.easy}
              </h2>
              <p>{easy}</p>
            </section>

            <section aria-labelledby="target">
              <h2 id="target" className="detail__h2" lang={lang}>
                {t.target}
              </h2>
              <p className="detail__target">{target || t.targetNone}</p>
            </section>

            {a.uncertain.length + a.validationWarnings.length > 0 && (
              <section aria-labelledby="unc" lang={lang}>
                <h2 id="unc" className="detail__h2">
                  {t.uncertain}
                  {lang === 'en' && <span className="detail__h2-note">{t.koreanOnly}</span>}
                </h2>
                <ul className="detail__notes" lang="ko">
                  {a.uncertain.map((u, i) => (
                    <li key={i}>{u.reason}</li>
                  ))}
                  {a.validationWarnings.map((w, i) => (
                    <li key={`w${i}`} lang="en">
                      {t.autoWarning}: {w}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {notice.attachments.length > 0 && (
              <section aria-labelledby="att" lang={lang}>
                <h2 id="att" className="detail__h2">
                  {t.attachments} <span className="detail__h2-note">{t.attachmentsNote}</span>
                </h2>
                <ul className="detail__attachments">
                  {notice.attachments.map((f) => (
                    <li key={f.url}>
                      <a href={f.url} target="_blank" rel="noreferrer">
                        {f.kind === 'image' ? t.image : t.file} · <span lang="ko">{f.name}</span> ↗
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <details className="detail__original" lang={lang}>
              <summary>{t.originalText}</summary>
              <pre lang="ko">{notice.originalContent}</pre>
            </details>
          </div>

          <aside className="detail__aside" aria-label={t.keyDates} lang={lang}>
            <h2 className="detail__h2">{t.keyDates}</h2>
            <dl className="dates">
              <DateRow lang={lang} label={t.applicationStart} value={a.applicationStart} quote={a.evidence.applicationStart} />
              <DateRow lang={lang} label={t.applicationEnd} value={a.applicationEnd} quote={a.evidence.applicationEnd} />
              <DateRow lang={lang} label={t.deadline} value={deadline} quote={a.evidence.deadline ?? a.evidence.applicationEnd} strong />
              <DateRow lang={lang} label={t.event} value={a.eventDate} quote={a.evidence.eventDate} info={en?.eventInfo ?? null} />
            </dl>
            <div className="detail__actions">
              {saved ? (
                <button type="button" className="pill" aria-pressed onClick={() => (remove(notice.id), setCalendarMsg('removed'))}>
                  {t.removeFromCalendar}
                </button>
              ) : (
                <button type="button" className="pill pill--solid" onClick={() => (add(notice.id), setCalendarMsg('added'))} disabled={!hasDates}>
                  {t.addToCalendar}
                </button>
              )}
              {calendarLink && (
                <Link to={calendarLink} className="pill">
                  {t.viewInCalendar} →
                </Link>
              )}
              <a href={notice.sourceUrl} target="_blank" rel="noreferrer" className="pill">
                {t.viewOriginalShort}
              </a>
            </div>
            {saved && calendarMsg !== 'added' && <p className="detail__saved">{t.inMyCalendar}</p>}
            {calendarMsg && (
              <p className="detail__hint" role="status">
                {calendarMsg === 'added' ? t.added : calendarMsg === 'removed' ? t.removed : t.icsDone}
              </p>
            )}
            {hasDates && (
              <button type="button" className="detail__export" onClick={() => downloadIcs(notice, lang) && setCalendarMsg('ics')}>
                {t.exportIcs}
              </button>
            )}
            {!hasDates && <p className="detail__hint">{t.noDates}</p>}
            <p className="detail__ai-meta">{t.aiMeta(a.model, a.promptVersion, fullDate(a.analyzedAt, lang))}</p>
          </aside>
        </div>
      )}
    </>
  );
}

function DateRow({
  lang,
  label,
  value,
  quote,
  strong,
  info,
}: {
  lang: Lang;
  label: string;
  value: string | null;
  quote?: string | null;
  strong?: boolean;
  info?: string | null;
}) {
  const t = useLanguage().t.notice;
  return (
    <div className={`dates__row${strong ? ' dates__row--strong' : ''}`}>
      <dt>{label}</dt>
      <dd>
        {value ? (
          <>
            <span className="dates__value">
              {shortDate(value, lang)}
              {strong && <DdayBadge deadline={value} />}
            </span>
            {info && <span className="dates__info">{info}</span>}
            {/* evidence stays in Korean: it is a verbatim quote of the source */}
            {quote && (
              <span className="dates__quote">
                {t.source} “<span lang="ko">{quote}</span>”
              </span>
            )}
            {strong && dday(value).tone === 'closed' && <span className="dates__quote">{t.closedNote}</span>}
          </>
        ) : (
          <span className="dates__none">{t.notInNotice}</span>
        )}
      </dd>
    </div>
  );
}
