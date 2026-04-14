import type { CsvBuilderFilter } from '@/lib/foundry/registry-types';

export function serializeCsvBuilderFilters(filters: CsvBuilderFilter[] | undefined): string | undefined {
  if (!Array.isArray(filters) || filters.length === 0) return undefined;
  return JSON.stringify(filters);
}

export function countActiveCsvBuilderFilters(filters: CsvBuilderFilter[] | undefined): number {
  return Array.isArray(filters) ? filters.length : 0;
}
