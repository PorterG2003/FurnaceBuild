export type ExportReadyFilter = 'ready' | 'all' | 'blocked';

export type ExportTriFilter = 'any' | 'yes' | 'no';

export type ExportPresentationMode = 'contact' | 'company';

export type ExportGoogleAdsResultFilter = 'any' | 'yes' | 'no' | 'unknown';

export interface ExportFiltersState {
  exportReady: ExportReadyFilter;
  companyNameQuery: string;
  companyNameBlankFilter: ExportTriFilter;
  registryState: string[];
  linkedFilter: ExportTriFilter;
  reviewFilter: ExportTriFilter;
  parseFilter: ExportTriFilter;
  hasWebsiteFilter: ExportTriFilter;
  hasNotesFilter: ExportTriFilter;
  hasNormalizedKeyFilter: ExportTriFilter;
  addressState: string;
  addressCity: string;
  postalCode: string;
  primaryLocationState: string;
  primaryLocationCity: string;
  ownerFilter: ExportTriFilter;
  ownerTitleQuery: string;
  googleAdsResult: ExportGoogleAdsResultFilter;
}

export const DEFAULT_EXPORT_READY: ExportReadyFilter = 'ready';

export const DEFAULT_EXPORT_FILTERS: ExportFiltersState = {
  exportReady: DEFAULT_EXPORT_READY,
  companyNameQuery: '',
  companyNameBlankFilter: 'any',
  registryState: [],
  linkedFilter: 'any',
  reviewFilter: 'any',
  parseFilter: 'any',
  hasWebsiteFilter: 'any',
  hasNotesFilter: 'any',
  hasNormalizedKeyFilter: 'any',
  addressState: '',
  addressCity: '',
  postalCode: '',
  primaryLocationState: '',
  primaryLocationCity: '',
  ownerFilter: 'any',
  ownerTitleQuery: '',
  googleAdsResult: 'any',
};

export function sanitizeExportFiltersForMode(
  filters: ExportFiltersState,
  mode: ExportPresentationMode,
): ExportFiltersState {
  if (mode === 'contact') {
    return filters;
  }

  return {
    ...filters,
    ownerFilter: 'any',
    ownerTitleQuery: '',
  };
}

export function countNonDefaultExportFilters(
  filters: ExportFiltersState,
  mode: ExportPresentationMode,
): number {
  const visibleFilters = sanitizeExportFiltersForMode(filters, mode);
  let n = 0;
  if (visibleFilters.exportReady !== DEFAULT_EXPORT_READY) n += 1;
  if (visibleFilters.companyNameQuery.trim().length > 0) n += 1;
  if (visibleFilters.companyNameBlankFilter !== 'any') n += 1;
  if (visibleFilters.registryState.length > 0) n += 1;
  if (visibleFilters.linkedFilter !== 'any') n += 1;
  if (visibleFilters.reviewFilter !== 'any') n += 1;
  if (visibleFilters.parseFilter !== 'any') n += 1;
  if (visibleFilters.hasWebsiteFilter !== 'any') n += 1;
  if (visibleFilters.hasNotesFilter !== 'any') n += 1;
  if (visibleFilters.hasNormalizedKeyFilter !== 'any') n += 1;
  if (visibleFilters.addressState.trim().length > 0) n += 1;
  if (visibleFilters.addressCity.trim().length > 0) n += 1;
  if (visibleFilters.postalCode.trim().length > 0) n += 1;
  if (visibleFilters.primaryLocationState.trim().length > 0) n += 1;
  if (visibleFilters.primaryLocationCity.trim().length > 0) n += 1;
  if (visibleFilters.ownerFilter !== 'any') n += 1;
  if (visibleFilters.ownerTitleQuery.trim().length > 0) n += 1;
  if (visibleFilters.googleAdsResult !== 'any') n += 1;
  return n;
}
