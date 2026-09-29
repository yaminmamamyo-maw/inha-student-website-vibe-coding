import { Link } from 'react-router-dom';
import { shortDate } from '../lib/dates.ts';
import type { NoticeEvent } from '../lib/events.ts';
import { noticeTitle } from '../lib/i18n.ts';
import { useLanguage } from '../lib/language.tsx';
import { DdayBadge } from './DdayBadge.tsx';
import './UpcomingList.css';

/** Compact date-first list of upcoming deadlines/events; each row opens the calendar on that day. */
export function UpcomingList({ events }: { events: NoticeEvent[] }) {
  const { lang, t } = useLanguage();
  return (
    <ul className="upcoming">
      {events.map((e) => (
        <li key={`${e.notice.id}-${e.kind}`}>
          <Link to={`/calendar?date=${e.date.slice(0, 10)}&month=${e.date.slice(0, 7)}&notice=${e.notice.id}`} className="upcoming__row">
            <span className="upcoming__date">{shortDate(e.date, lang)}</span>
            <span className={`ev ev--${e.kind} ev--sample`}>{t.events[e.kind]}</span>
            <span className="upcoming__title">{noticeTitle(e.notice, lang)}</span>
            {e.kind === 'deadline' ? <DdayBadge deadline={e.date} /> : <span />}
          </Link>
        </li>
      ))}
    </ul>
  );
}
