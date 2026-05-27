import type { LeadsWorkbenchDataset } from '@/lib/devtools/leads-workbench/types';

export interface LeadsActionStats {
  selectedPeople: number;
  membershipsInScope: number;
  nativeMemberships: number;
  smartleadMemberships: number;
  peopleWithReplies: number;
  peopleWithConflictingCompanies: number;
}

export function computeLeadsActionStats(params: {
  dataset: LeadsWorkbenchDataset;
  globalLeadIds: string[];
}): LeadsActionStats {
  const { dataset, globalLeadIds } = params;
  const idSet = new Set(globalLeadIds);
  const selectedPeopleRows = dataset.people.filter((person) => idSet.has(person.globalLeadId));
  const selectedPeople = selectedPeopleRows.length;
  const selectedMemberships = selectedPeopleRows.flatMap((person) => person.memberships);
  const nativeMemberships = selectedMemberships.filter(
    (membership) => !dataset.campaigns.find((campaign) => campaign.id === membership.campaignId)?.isSmartlead,
  ).length;
  const smartleadMemberships = selectedMemberships.filter((membership) =>
    dataset.campaigns.find((campaign) => campaign.id === membership.campaignId)?.isSmartlead,
  ).length;
  const peopleWithReplies = selectedPeopleRows.filter((person) =>
    person.memberships.some((membership) => membership.hasReply),
  ).length;
  const peopleWithConflictingCompanies = selectedPeopleRows.filter((person) => {
    const companies = new Set(
      person.memberships.map((membership) => membership.companyName).filter(Boolean),
    );
    return companies.size > 1;
  }).length;

  return {
    selectedPeople,
    membershipsInScope: selectedMemberships.length,
    nativeMemberships,
    smartleadMemberships,
    peopleWithReplies,
    peopleWithConflictingCompanies,
  };
}
