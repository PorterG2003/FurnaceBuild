import { buildSavedListPeopleRows } from '@/lib/leads/columns/buildSavedListRows';
import type { LeadsTableRow } from '@/lib/leads/columns/buildTableColumns';
import { resolvePersonSummaryCellValue } from '@/lib/leads/columns/resolveCellValue';
import type { LeadsColumnDef } from '@/lib/leads/columns/types';
import type { LeadsPeopleRow, MockPerson } from '@/lib/devtools/leads-workbench/types';
import type { AccountLeadPersonSummary } from '@/lib/supabase/services/leads/account-leads';
import type { SavedLeadListPeoplePageRow } from '@/lib/supabase/services/leads/saved-lists';

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

    const cells: Record<string, import('@/lib/leads/columns').LeadsCellValue> = {};
    for (const column of columns) {
      cells[column.id] = resolvePersonSummaryCellValue(person, column.fieldKey);
    }

    return {
      person: emptyPerson,
      globalLeadId: person.globalLeadId,
      cells,
    } satisfies LeadsPeopleRow;
  });
}

export function buildSavedListExportRows(params: {
  columns: LeadsColumnDef[];
  pageRows: SavedLeadListPeoplePageRow[];
  workbenchPeople: MockPerson[];
}): LeadsTableRow[] {
  return buildSavedListPeopleRows(params);
}
