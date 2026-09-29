import { CATEGORIES, type Category } from '@shared/categories.ts';

export { CATEGORIES, type Category };

/** Chip tint per AI category (gchf palette + pale tints of its accents). */
export const CATEGORY_TINT: Record<Category, string> = {
  장학금: 'var(--mint)',
  학사: 'var(--lavender)',
  '모집/선발': 'var(--sand)',
  '행사/특강': 'var(--tint-event)',
  '취업/진로': 'var(--tint-career)',
  국제교류: 'var(--tint-intl)',
  '시설/생활': 'var(--tint-life)',
  기타: 'transparent',
};

/** Filter value for notices that have no AI analysis yet. */
export const PENDING_FILTER = '분석 대기';
