export const THREAD_CATEGORIES = ['Interested', 'Neutral', 'Not Interested', 'Auto Reply'] as const;

export type ThreadCategory = (typeof THREAD_CATEGORIES)[number];

export const NO_CATEGORY_FILTER = 'no_category';
