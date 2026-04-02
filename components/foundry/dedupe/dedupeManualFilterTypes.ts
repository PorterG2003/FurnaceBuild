export type PresenceFilter = 'any' | 'present' | 'missing';

export interface ManualCompaniesFilters {
  normalizedKey: PresenceFilter;
  notes: PresenceFilter;
}

export interface ManualEntityOwnersFilters {
  currentOnly: boolean;
  ownerNormalizedKey: PresenceFilter;
  stateEntityId: string;
}

export const DEFAULT_MANUAL_COMPANIES_FILTERS: ManualCompaniesFilters = {
  normalizedKey: 'any',
  notes: 'any',
};

export const DEFAULT_MANUAL_ENTITY_OWNERS_FILTERS: ManualEntityOwnersFilters = {
  currentOnly: true,
  ownerNormalizedKey: 'any',
  stateEntityId: '',
};

export function presenceFilterToBool(value: PresenceFilter): boolean | undefined {
  if (value === 'present') return true;
  if (value === 'missing') return false;
  return undefined;
}

export function countManualCompaniesFilters(filters: ManualCompaniesFilters): number {
  let count = 0;
  if (filters.normalizedKey !== DEFAULT_MANUAL_COMPANIES_FILTERS.normalizedKey) count += 1;
  if (filters.notes !== DEFAULT_MANUAL_COMPANIES_FILTERS.notes) count += 1;
  return count;
}

export function countManualEntityOwnerFilters(filters: ManualEntityOwnersFilters): number {
  let count = 0;
  if (filters.currentOnly !== DEFAULT_MANUAL_ENTITY_OWNERS_FILTERS.currentOnly) count += 1;
  if (filters.ownerNormalizedKey !== DEFAULT_MANUAL_ENTITY_OWNERS_FILTERS.ownerNormalizedKey) count += 1;
  if (filters.stateEntityId.trim()) count += 1;
  return count;
}
