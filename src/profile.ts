// Student profile used for personalization. Dependency-free: shared by the web app (stored in
// localStorage — no accounts yet) and the backend (future: match new notices → notifications).

import { currentCollegeName } from './inhaCatalog.ts';

export const INTERESTS = [
  { id: 'scholarship', label: '장학금', en: 'Scholarships' },
  { id: 'competition', label: '공모전·대회', en: 'Competitions' },
  { id: 'career', label: '인턴·취업', en: 'Internships & careers' },
  { id: 'academic', label: '학사·교육 프로그램', en: 'Academic programs' },
  { id: 'event', label: '행사·특강', en: 'Events & talks' },
  { id: 'activity', label: '모집·대외활동', en: 'Recruitment & activities' },
  { id: 'international', label: '국제교류', en: 'International' },
] as const;

export type InterestId = (typeof INTERESTS)[number]['id'];
export type AcademicYear = 1 | 2 | 3 | 4;

export interface Profile {
  college: string;
  major: string;
  year: AcademicYear;
  entranceYear: number;
  interests: InterestId[];
}

const INTEREST_IDS = new Set<string>(INTERESTS.map((i) => i.id));

/** Validate untrusted data (e.g. from localStorage). Returns null if it is not a usable profile. */
export function parseProfile(value: unknown): Profile | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const year = Number(v.year);
  const entranceYear = Number(v.entranceYear);
  if (typeof v.major !== 'string' || !v.major.trim() || typeof v.college !== 'string') return null;
  if (![1, 2, 3, 4].includes(year) || !Number.isInteger(entranceYear) || entranceYear < 2000 || entranceYear > 2100) return null;
  const interests = Array.isArray(v.interests) ? v.interests.filter((i): i is InterestId => typeof i === 'string' && INTEREST_IDS.has(i)) : [];
  return { college: currentCollegeName(v.college), major: v.major.trim(), year: year as AcademicYear, entranceYear, interests: [...new Set(interests)] };
}
