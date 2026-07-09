export type MetaAdLibraryActiveStatus = 'active' | 'inactive' | 'all';
export type MetaAdLibrarySearchType = 'keyword_unordered' | 'keyword_exact_phrase';

export interface BuildMetaAdLibrarySearchUrlOptions {
  q: string;
  country?: string;
  activeStatus?: MetaAdLibraryActiveStatus;
  searchType?: MetaAdLibrarySearchType;
  adType?: string;
  mediaType?: string;
}

const META_AD_LIBRARY_BASE = 'https://www.facebook.com/ads/library/';

export function buildMetaAdLibrarySearchUrl(options: BuildMetaAdLibrarySearchUrlOptions): string {
  const q = options.q.trim();
  if (!q) throw new Error('Search query is required');
  const params = new URLSearchParams({
    active_status: options.activeStatus ?? 'active',
    ad_type: options.adType ?? 'all',
    country: options.country ?? 'US',
    media_type: options.mediaType ?? 'all',
    q,
    search_type: options.searchType ?? 'keyword_unordered',
  });
  return `${META_AD_LIBRARY_BASE}?${params.toString()}`;
}

/** Multi-word names and domain-like terms use exact phrase; single tokens use unordered keyword search. */
export function pickSearchTypeForTerm(term: string): MetaAdLibrarySearchType {
  const trimmed = term.trim();
  if (/\s/.test(trimmed)) return 'keyword_exact_phrase';
  if (trimmed.includes('.')) return 'keyword_exact_phrase';
  return 'keyword_unordered';
}
