export { buildLeadsTableColumns, type LeadsTableRow } from '@/lib/leads/columns/buildTableColumns';

// Legacy helper for mock/devtools flows that still pass full datasets.
import type { LeadsListDefinition, LeadsPeopleRow, LeadsWorkbenchDataset } from './types';
import { resolveCellValue } from '@/lib/leads/columns/resolveCellValue';

export function buildPeopleRows(dataset: LeadsWorkbenchDataset, list: LeadsListDefinition): LeadsPeopleRow[] {
  return dataset.people.map((person) => ({
    person,
    globalLeadId: person.globalLeadId,
    cells: Object.fromEntries(
      list.columns.map((column) => [
        column.id,
        resolveCellValue(column, { workbenchPerson: person }),
      ]),
    ),
  }));
}
