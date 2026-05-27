import type { SavedLeadListPeoplePageRow } from '@/lib/supabase/services/leads/saved-lists';
import type { MockPerson } from '@/lib/devtools/leads-workbench/types';
import type { LeadsColumnDef } from './types';
import { layoutNeedsReplyActivity } from './parseColumnLayout';
import { resolveCellValue } from './resolveCellValue';

export type SavedListPeopleRow = {
  person: MockPerson;
  globalLeadId: string;
  cells: Record<string, import('./types').LeadsCellValue>;
};

export function columnsNeedWorkbenchDataset(columns: LeadsColumnDef[]): boolean {
  return columns.some((column) => column.visible && column.sourceType === 'membership');
}

export { layoutNeedsReplyActivity };

export function buildSavedListPeopleRows(params: {
  columns: LeadsColumnDef[];
  pageRows: SavedLeadListPeoplePageRow[];
  workbenchPeople: MockPerson[];
}): SavedListPeopleRow[] {
  const { columns, pageRows, workbenchPeople } = params;
  const peopleByGlobalId = new Map(workbenchPeople.map((person) => [person.globalLeadId, person]));

  return pageRows.map((pageRow) => {
    const workbenchPerson = peopleByGlobalId.get(pageRow.globalLeadId) ?? null;
    const person: MockPerson =
      workbenchPerson ??
      ({
        id: pageRow.globalLeadId,
        globalLeadId: pageRow.globalLeadId,
        email: pageRow.email ?? '',
        displayName: pageRow.displayName,
        firstName: pageRow.firstName,
        lastName: pageRow.lastName,
        memberships: [],
      } satisfies MockPerson);

    const cells = Object.fromEntries(
      columns.map((column) => [
        column.id,
        resolveCellValue(column, { summary: pageRow, workbenchPerson: workbenchPerson ?? person }),
      ]),
    );

    return { person, globalLeadId: pageRow.globalLeadId, cells };
  });
}
