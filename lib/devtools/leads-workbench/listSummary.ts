import { filterPeople } from './mockDataset';
import type { LeadsListDefinition, LeadsWorkbenchDataset } from './types';

export function getSavedListLeadCount(
  list: LeadsListDefinition,
  dataset: LeadsWorkbenchDataset,
): number {
  return filterPeople(dataset.people, list.filters, dataset.campaigns).length;
}
