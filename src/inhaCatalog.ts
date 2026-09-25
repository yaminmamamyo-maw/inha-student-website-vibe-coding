// Inha University undergraduate colleges and majors, copied from each college's page on the
// official site (www.inha.ac.kr/kr/<id>/subview.do, "현재메뉴" list), checked 2026-09-24.
// Dependency-free: shared by the matching engine (backend) and the profile form (web).
// Update by re-reading those pages; interdisciplinary "(융합전공)" programs are left out.

export interface CollegeEntry {
  college: string;
  /** Earlier official names; still recognized in notices and in saved profiles. */
  formerNames?: string[];
  /** Official page, for re-checking the list. */
  url: string;
  majors: MajorEntry[];
}

export interface MajorEntry {
  /** Display name used in profiles. */
  name: string;
  /** Other spellings that may appear in notices (e.g. the parent 학부). */
  aliases?: string[];
}

const m = (name: string, ...aliases: string[]): MajorEntry => (aliases.length ? { name, aliases } : { name });
const page = (id: number) => `https://www.inha.ac.kr/kr/${id}/subview.do`;

export const INHA_COLLEGES: CollegeEntry[] = [
  {
    college: '공과대학', url: page(990),
    majors: [
      m('기계공학과'), m('항공우주공학과'), m('조선해양공학과'), m('산업경영공학과'), m('화학공학과'), m('고분자공학과'),
      m('신소재공학과'), m('사회인프라공학과'), m('환경공학과'), m('공간정보공학과'), m('건축공학', '건축학부'), m('건축학', '건축학부'),
      m('에너지자원공학과'), m('융합기술경영학부'), m('전기전자공학부'), m('반도체시스템공학과'), m('이차전지융합학과'),
    ],
  },
  { college: '자연과학대학', url: page(991), majors: [m('수학과'), m('통계학과'), m('물리학과'), m('화학과'), m('해양과학과'), m('식품영양학과')] },
  { college: '경영대학', url: page(992), majors: [m('경영학과', '경영학부'), m('파이낸스경영학과', '경영학부'), m('아태물류학부'), m('국제통상학과')] },
  { college: '사범대학', url: page(993), majors: [m('국어교육과'), m('영어교육과'), m('사회교육과'), m('교육학과'), m('체육교육과'), m('수학교육과')] },
  {
    college: '사회과학대학', url: page(994),
    majors: [m('행정학과'), m('정치외교학과'), m('미디어커뮤니케이션학과'), m('경제학과'), m('소비자학과'), m('아동심리학과'), m('사회복지학과')],
  },
  {
    college: '문과대학', url: page(995),
    majors: [m('한국어문학과'), m('사학과'), m('철학과'), m('중국학과'), m('일본언어문화학과'), m('영미유럽인문융합학부'), m('문화콘텐츠문화경영학과')],
  },
  { college: '의과대학', url: page(996), majors: [m('의예과'), m('의학과')] },
  { college: '미래융합대학', url: page(997), majors: [m('메카트로닉스공학과'), m('소프트웨어융합공학과'), m('산업경영학과'), m('금융투자학과'), m('반도체산업융합학과')] },
  { college: '예술체육대학', url: page(998), majors: [m('조형예술학과'), m('디자인융합학과'), m('스포츠과학과'), m('연극영화학과'), m('의류디자인학과')] },
  { college: '국제학부', url: page(999), majors: [m('IBT학과'), m('ISE학과'), m('KLC학과')] },
  {
    college: '프런티어창의대학', url: page(989),
    majors: [m('자유전공융합학부'), m('공학융합학부'), m('자연과학융합학부'), m('경영융합학부'), m('사회과학융합학부'), m('인문융합학부')],
  },
  {
    // Renamed from 소프트웨어융합대학 (kr/3907 page title and aicc.inha.ac.kr, checked 2026-09-25).
    college: 'AI융합대학', formerNames: ['소프트웨어융합대학'], url: page(3907),
    majors: [m('인공지능공학과'), m('데이터사이언스학과'), m('스마트모빌리티공학과'), m('디자인테크놀로지학과'), m('컴퓨터공학과')],
  },
  { college: '간호대학', url: page(4142), majors: [m('간호학과')] },
  { college: '바이오시스템융합학부', url: page(4097), majors: [m('생명공학과'), m('바이오제약공학과'), m('생명과학과'), m('첨단바이오의약학과'), m('바이오식품공학과')] },
];

/** A former college name (e.g. from a profile saved before a rename) → its current name; others unchanged. */
export const currentCollegeName = (college: string) =>
  INHA_COLLEGES.find((c) => c.formerNames?.includes(college))?.college ?? college;

export const collegeOf =(major: string) => INHA_COLLEGES.find((c) => c.majors.some((x) => x.name === major))?.college ?? null;
