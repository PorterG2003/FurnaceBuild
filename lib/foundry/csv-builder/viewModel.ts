import type { CsvBuilderColumnRow, CsvBuilderHydratedRow } from '@/lib/foundry/registry-types';

export interface CsvBuilderWorkspaceViewModel {
  orderedColumns: CsvBuilderColumnRow[];
  visibleColumns: CsvBuilderColumnRow[];
  rows: CsvBuilderHydratedRow[];
}

export function buildCsvBuilderWorkspaceViewModel(input: {
  columns: CsvBuilderColumnRow[];
  rows: CsvBuilderHydratedRow[];
}): CsvBuilderWorkspaceViewModel {
  const orderedColumns = [...input.columns].sort((a, b) => a.position - b.position);
  return {
    orderedColumns,
    visibleColumns: orderedColumns.filter((column) => column.visible),
    rows: input.rows,
  };
}
