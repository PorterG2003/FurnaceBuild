import type { LeadsCellValue } from './types';

export function computeColumnStats(values: Array<LeadsCellValue>) {
  const nonEmpty = values.filter((value) => value !== null && value !== '' && value !== false);
  return {
    filledCount: nonEmpty.length,
    emptyCount: values.length - nonEmpty.length,
    distinctValueCount: new Set(nonEmpty.map((value) => String(value))).size,
  };
}
