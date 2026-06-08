import { resolveCellValue, resolvePersonSummaryCellValue } from './resolveCellValue.js';
import type {
  AccountLeadPersonSummary,
  LeadsColumnDef,
  LeadsTableRow,
  MockPerson,
  SavedLeadListPeoplePageRow,
} from './types.js';

export function columnsNeedWorkbenchDataset(columns: LeadsColumnDef[]): boolean {
  return columns.some((column) => column.visible && column.sourceType === 'membership');
}

export function mapAccountSummaryToSavedListPeopleRow(
  summary: AccountLeadPersonSummary,
): SavedLeadListPeoplePageRow {
  return {
    globalLeadId: summary.globalLeadId,
    email: summary.email,
    displayName: summary.displayName,
    firstName: summary.firstName,
    lastName: summary.lastName,
    campaignCount: summary.campaignCount,
    companyList: summary.companyList,
    hasReply: summary.hasReply,
    latestActivity: summary.latestActivity,
    newestMembershipCreatedAt: summary.newestMembershipCreatedAt,
  };
}

export function buildExplorerExportRows(
  people: AccountLeadPersonSummary[],
  columns: LeadsColumnDef[],
): LeadsTableRow[] {
  return people.map((person) => {
    const emptyPerson: MockPerson = {
      id: person.globalLeadId,
      globalLeadId: person.globalLeadId,
      email: person.email,
      displayName: person.displayName,
      firstName: person.firstName,
      lastName: person.lastName,
      memberships: [],
    };

    const cells: Record<string, import('./types.js').LeadsCellValue> = {};
    for (const column of columns) {
      cells[column.id] = resolvePersonSummaryCellValue(person, column.fieldKey);
    }

    return {
      person: emptyPerson,
      globalLeadId: person.globalLeadId,
      cells,
    };
  });
}

function buildSavedListPeopleRows(params: {
  columns: LeadsColumnDef[];
  pageRows: SavedLeadListPeoplePageRow[];
  workbenchPeople: MockPerson[];
}): LeadsTableRow[] {
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

export function buildSavedListExportRows(params: {
  columns: LeadsColumnDef[];
  pageRows: SavedLeadListPeoplePageRow[];
  workbenchPeople: MockPerson[];
}): LeadsTableRow[] {
  return buildSavedListPeopleRows(params);
}
