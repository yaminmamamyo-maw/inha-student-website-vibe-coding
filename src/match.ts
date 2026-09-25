// Deterministic profile ↔ notice matching. No AI: it reads the structured/AI-extracted fields
// that already exist (category, target, title) and applies small, explainable rules.
// Dependency-free, so both the web app (personalized Home) and the backend (future
// notifications on new notices) use the same function.
//
// Personalized PRIORITY, not personalized ACCESS: a "none" result only means "not for you";
// callers must still show every notice in the all-notices view.

import type { NoticeListItem } from './api/types.ts';
import type { Category } from './categories.ts';
import { INHA_COLLEGES } from './inhaCatalog.ts';
import { INTERESTS, type InterestId, type Profile } from './profile.ts';
import { sourceMeta } from './sourceMeta.ts';

export type MatchLevel = 'high' | 'medium' | 'low' | 'none';

export interface MatchResult {
  relevanceScore: number; // 0–100
  matchLevel: MatchLevel;
  /** Why it matched, in the order the rules fired (Korean UI text). */
  matchReasons: string[];
  /** The same reasons in English, index-aligned with `matchReasons` (presentation only). */
  matchReasonsEn: string[];
  /** Set when the notice explicitly excludes this profile (matchLevel "none"). */
  excludedBecause: string | null;
  excludedBecauseEn: string | null;
  /** True when the notice has no AI analysis yet, so only its title could be used. */
  basedOnTitleOnly: boolean;
}

export const SCORE = {
  major: 50,
  college: 30,
  titleMajor: 35,
  titleCollege: 20,
  sourceMajor: 35,
  sourceCollege: 20,
  year: 25,
  allUndergrad: 25,
  interestCategory: 30,
  interestKeyword: 20,
} as const;
export const LEVEL_MIN = { high: 50, medium: 25 } as const;

/** How each interest maps onto the AI category enum, plus title keywords as a fallback. */
export const INTEREST_RULES: Record<InterestId, { categories: Category[]; keywords: RegExp }> = {
  scholarship: { categories: ['장학금'], keywords: /장학/ },
  competition: { categories: [], keywords: /공모전|경진대회|대회|챌린지|해커톤|콘테스트/ },
  career: { categories: ['취업/진로'], keywords: /인턴|채용|취업|현장실습|직무|면접/ },
  academic: { categories: ['학사'], keywords: /수강|학사|계절학기|학점|다중전공|복수전공|부전공/ },
  event: { categories: ['행사/특강'], keywords: /특강|설명회|박람회|포럼|세미나|축제/ },
  activity: { categories: ['모집/선발'], keywords: /서포터즈|기자단|대외활동|멘토|봉사단/ },
  international: { categories: ['국제교류'], keywords: /교환학생|해외|파견|국제교류|어학연수/ },
};

// ---------- text helpers ----------

interface Term {
  term: string;
  /** What the term refers to: a major name or a college name. */
  major?: string;
  college: string;
}

const TERMS: Term[] = INHA_COLLEGES.flatMap((c) => [
  ...[c.college, ...(c.formerNames ?? [])].map((term) => ({ term, college: c.college })),
  ...c.majors.flatMap((mj) => [mj.name, ...(mj.aliases ?? [])].map((term) => ({ term, major: mj.name, college: c.college }))),
]).sort((a, b) => b.term.length - a.term.length); // longest first: "파이낸스경영학과" before "경영학과"

/** Majors/colleges named in the text. Matched longest-first with masking so short names can't match inside long ones. */
function findUnits(text: string): { majors: Set<string>; colleges: Set<string>; majorColleges: Set<string> } {
  let rest = text;
  const majors = new Set<string>();
  const colleges = new Set<string>();
  const majorColleges = new Set<string>();
  for (const t of TERMS) {
    if (!rest.includes(t.term)) continue;
    rest = rest.split(t.term).join(' '.repeat(t.term.length));
    if (t.major) {
      majors.add(t.major);
      majorColleges.add(t.college);
    } else colleges.add(t.college);
  }
  return { majors, colleges, majorColleges };
}

/** Semesters a student has completed by `today` (KST YYYY-MM-DD): spring = Mar–Aug, fall = Sep–Feb. */
export function completedSemesters(year: number, today: string): number {
  const month = Number(today.slice(5, 7));
  const inYear = month >= 3 && month <= 8 ? 0 : month >= 9 ? 1 : 2;
  return (year - 1) * 2 + inYear;
}

/** Academic years allowed by the text, or null if it says nothing about years. */
function allowedYears(text: string, entranceYear: number, today: string): { years: Set<number> | null; label: string; labelEn: string } {
  const years = new Set<number>();
  const labels: string[] = [];
  const labelsEn: string[] = [];
  for (const m of text.matchAll(/([1-4])\s*학년\s*이상/g)) {
    for (let y = Number(m[1]); y <= 4; y++) years.add(y);
    labels.push(`${m[1]}학년 이상`);
    labelsEn.push(`year ${m[1]}+`);
  }
  for (const m of text.matchAll(/([1-4])\s*[~∼-]\s*([1-4])\s*학년/g)) {
    for (let y = Number(m[1]); y <= Number(m[2]); y++) years.add(y);
    labels.push(`${m[1]}~${m[2]}학년`);
    labelsEn.push(`years ${m[1]}–${m[2]}`);
  }
  for (const m of text.matchAll(/([1-4])\s*학년(?!\s*이상)/g)) {
    // skip "N학년 … 불가/제외" (handled as an exclusion) and range ends already counted
    const after = text.slice(m.index! + m[0].length, m.index! + m[0].length + 12);
    if (/^[^,.)]*?(불가|제외)/.test(after)) continue;
    years.add(Number(m[1]));
    labels.push(`${m[1]}학년`);
    labelsEn.push(`year ${m[1]}`);
  }
  if (/신입생/.test(text)) {
    years.add(1);
    labels.push('신입생');
    labelsEn.push('first-year students');
  }
  if (/졸업\s*예정자/.test(text)) {
    years.add(4);
    labels.push('졸업예정자');
    labelsEn.push('expected graduates');
  }
  // "26학번" / "2026학번": convert the entrance year to the academic year it corresponds to now
  for (const m of text.matchAll(/(\d{2}|\d{4})\s*학번/g)) {
    const yy = Number(m[1].slice(-2));
    const cohortYear = 2000 + yy;
    const nowYear = Number(today.slice(0, 4)) - (Number(today.slice(5, 7)) <= 2 ? 1 : 0);
    const y = nowYear - cohortYear + 1;
    if (y >= 1 && y <= 4) years.add(y);
    labels.push(`${yy}학번`);
    labelsEn.push(`class of '${yy}`);
    if (cohortYear === entranceYear) years.add(-1); // marker: explicit cohort match
  }
  if (years.size === 0) return { years: null, label: '', labelEn: '' };
  return { years, label: [...new Set(labels)].join('·'), labelEn: [...new Set(labelsEn)].join(', ') };
}

/** Years explicitly excluded ("1학년 불가", "1, 2학년 제외"). */
function excludedYears(text: string): Set<number> {
  const out = new Set<number>();
  for (const m of text.matchAll(/((?:[1-4]\s*,\s*)*[1-4])\s*학년[^,.)]*?(불가|제외)/g)) {
    for (const d of m[1].match(/[1-4]/g) ?? []) out.add(Number(d));
  }
  return out;
}

const GRAD_ONLY = /대학원생|석사|박사/;
const UNDERGRAD = /학부/;
const BROAD = /학부생|재학생|전체\s*학생|학생\s*전체|전체/;
/** Conditions we cannot check from a profile ("…이수중인", "성적 …", "해당 과목…"): no "all students" bonus. */
const UNVERIFIABLE = /이수\s*중|이수자|이수예정자|취득|해당|참여자|수강생|수혜자\s*중|선정된|선발된|소지자/;

// ---------- main ----------

export function matchNotice(profile: Profile, notice: NoticeListItem, today: string): MatchResult {
  const a = notice.analysis;
  const target = a?.target ?? ''; // AI-extracted eligibility (Korean); empty until analyzed
  const title = notice.title;
  // Every reason is recorded in Korean and English side by side. Language never affects the score.
  const reasons: string[] = [];
  const reasonsEn: string[] = [];
  const reason = (ko: string, en: string) => {
    reasons.push(ko);
    reasonsEn.push(en);
  };
  let score = 0;
  let excluded: string | null = null;
  let excludedEn: string | null = null;
  const exclude = (ko: string, en: string) => {
    if (excluded) return;
    excluded = ko;
    excludedEn = en;
  };
  let specific = false; // a major/college/year rule applied, so the "all students" bonus is not needed

  // 1. major / college named in the eligibility text
  const inTarget = findUnits(target);
  if (inTarget.majors.size > 0) {
    if (inTarget.majors.has(profile.major)) {
      score += SCORE.major;
      reason(`${profile.major} 대상`, `For ${profile.major}`);
      specific = true;
    } else if (inTarget.colleges.has(profile.college)) {
      score += SCORE.college;
      reason(`${profile.college} 대상`, `For ${profile.college}`);
      specific = true;
    } else {
      exclude(`다른 학과 대상 (${[...inTarget.majors].slice(0, 2).join(', ')})`, `For another major (${[...inTarget.majors].slice(0, 2).join(', ')})`);
    }
  } else if (inTarget.colleges.size > 0) {
    if (inTarget.colleges.has(profile.college)) {
      score += SCORE.college;
      reason(`${profile.college} 대상`, `For ${profile.college}`);
      specific = true;
    } else {
      exclude(`다른 단과대학 대상 (${[...inTarget.colleges].slice(0, 2).join(', ')})`, `For another college (${[...inTarget.colleges].slice(0, 2).join(', ')})`);
    }
  }

  // 1b. posted on the student's own department/college board (src/sourceMeta.ts): positive signal
  // only, like 1c, since those boards also carry notices for other groups (e.g. graduate students)
  let fromOwnBoard = false;
  if (!specific) {
    const boards = notice.sources.map((s) => sourceMeta(s.source));
    const deptBoard = boards.find((b) => b.major && b.major === profile.major);
    const collegeBoard = boards.find((b) => b.college && b.college === profile.college);
    if (deptBoard) {
      score += SCORE.sourceMajor;
      reason(`${profile.major} 게시판 공지`, `Posted on the ${profile.major} board`);
      fromOwnBoard = true;
    } else if (collegeBoard) {
      score += SCORE.sourceCollege;
      reason(`${profile.college} 게시판 공지`, `Posted on the ${profile.college} board`);
      fromOwnBoard = true;
    }
  }

  // 1c. the posting unit in the title ("[컴퓨터공학과] …"): positive signal only, since cross-major
  // notices exist. Skipped when 1b fired (a department board's title naming itself adds nothing).
  if (!specific && !fromOwnBoard) {
    const inTitle = findUnits(title);
    if (inTitle.majors.has(profile.major)) {
      score += SCORE.titleMajor;
      reason(`${profile.major} 공지`, `Posted by ${profile.major}`);
    } else if (inTitle.colleges.has(profile.college) || inTitle.majorColleges.has(profile.college)) {
      score += SCORE.titleCollege;
      reason(`${profile.college} 공지`, `Posted by ${profile.college}`);
    }
  }

  // 2. graduate-only
  if (GRAD_ONLY.test(target) && !UNDERGRAD.test(target)) exclude('대학원생 대상', 'For graduate students');

  // 3. academic year / cohort
  const ex = excludedYears(target);
  if (ex.has(profile.year)) exclude(`${profile.year}학년 제외`, `Year ${profile.year} excluded`);
  const { years, label, labelEn } = allowedYears(target, profile.entranceYear, today);
  if (years) {
    if (years.has(profile.year) || years.has(-1)) {
      score += SCORE.year;
      reason(`${label} 대상`, `For ${labelEn}`);
      specific = true;
    } else {
      exclude(`${label} 대상`, `For ${labelEn}`);
    }
  }

  // 4. "N학기 이상 이수" requirements
  for (const m of target.matchAll(/(\d{1,2})\s*학기\s*이상/g)) {
    const need = Number(m[1]);
    if (completedSemesters(profile.year, today) < need) exclude(`${need}학기 이상 이수 조건`, `Requires ${need}+ completed semesters`);
  }

  // 5. open to all undergraduates (and nothing we can't verify)
  if (!specific && BROAD.test(target) && !UNVERIFIABLE.test(target) && !GRAD_ONLY.test(target)) {
    score += SCORE.allUndergrad;
    reason('학부생 전체 대상', 'Open to all undergraduates');
  }

  // 6. interests: best single interest counts (category beats title keyword)
  let interestScore = 0;
  let interestReason = '';
  let interestReasonEn = '';
  for (const id of profile.interests) {
    const rule = INTEREST_RULES[id];
    const { label, en } = INTERESTS.find((i) => i.id === id)!;
    const s = a && rule.categories.includes(a.category) ? SCORE.interestCategory : rule.keywords.test(title) ? SCORE.interestKeyword : 0;
    if (s > interestScore) {
      interestScore = s;
      interestReason = `관심 분야: ${label}`;
      interestReasonEn = `Interest: ${en}`;
    }
  }
  if (interestScore) {
    score += interestScore;
    reason(interestReason, interestReasonEn);
  }

  if (excluded) {
    return {
      relevanceScore: 0, matchLevel: 'none', matchReasons: [excluded], matchReasonsEn: [excludedEn!],
      excludedBecause: excluded, excludedBecauseEn: excludedEn, basedOnTitleOnly: !a,
    };
  }
  score = Math.min(score, 100);
  const matchLevel: MatchLevel = score >= LEVEL_MIN.high ? 'high' : score >= LEVEL_MIN.medium ? 'medium' : 'low';
  return {
    relevanceScore: score, matchLevel, matchReasons: reasons, matchReasonsEn: reasonsEn,
    excludedBecause: null, excludedBecauseEn: null, basedOnTitleOnly: !a,
  };
}

/**
 * Notification foundation (not sending anything yet): which profiles a freshly analyzed notice
 * is highly relevant to. Call after a new/changed notice is analyzed and saved.
 */
export function notificationCandidates<P extends { id: string; profile: Profile }>(
  notice: NoticeListItem,
  profiles: P[],
  today: string,
): { profileId: string; result: MatchResult }[] {
  return profiles
    .map((p) => ({ profileId: p.id, result: matchNotice(p.profile, notice, today) }))
    .filter((c) => c.result.matchLevel === 'high');
}
