import type {
  LeadsColumnDef,
  LeadsListDefinition,
  LeadsListFilters,
  LeadsWorkbenchDataset,
  MockCampaign,
  MockEnrollmentState,
  MockMembership,
  MockPerson,
} from './types';
import { DEFAULT_SAVED_LIST_COLUMNS } from '@/lib/leads/columns/defaults';
import { computeColumnStats } from '@/lib/leads/columns/stats';

export { computeColumnStats };

const CAMPAIGNS: MockCampaign[] = [
  { id: 'camp-atlas', name: 'Atlas Launch', isSmartlead: false },
  { id: 'camp-zenith', name: 'Zenith Pipeline', isSmartlead: false },
  { id: 'camp-summit', name: 'Summit ABM', isSmartlead: false },
  { id: 'camp-pulse', name: 'Pulse RevOps', isSmartlead: false },
  { id: 'camp-orbit', name: 'Orbit Smartlead', isSmartlead: true },
  { id: 'camp-nova', name: 'Nova Smartlead', isSmartlead: true },
];

const NAMES = [
  ['Alex', 'Carter'],
  ['Jordan', 'Lee'],
  ['Taylor', 'Ng'],
  ['Casey', 'Brooks'],
  ['Morgan', 'Singh'],
  ['Avery', 'Diaz'],
  ['Riley', 'Patel'],
  ['Cameron', 'Scott'],
  ['Drew', 'Kelly'],
  ['Quinn', 'Morris'],
];

const COMPANIES = [
  'Northstar Labs',
  'Harbor Health',
  'Maple Freight',
  'Lighthouse AI',
  'Summit Works',
  'Crescent Systems',
  'Echo Commerce',
  'Beacon Security',
  'Slate Logistics',
  'Vertex Homes',
];

function isoAt(dayOffset: number, hour: number): string {
  const d = new Date(Date.UTC(2026, 4, 1 + dayOffset, hour, 0, 0));
  return d.toISOString();
}

function makeGlobalLeadId(i: number): string {
  return `glid-${String(i + 1).padStart(3, '0')}`;
}

function pickEnrollment(i: number): MockEnrollmentState {
  return (['active', 'paused', 'completed', 'stopped', 'not_started'][i % 5] ?? 'active') as MockEnrollmentState;
}

function pickReply(i: number) {
  return ([null, 'Interested', 'Neutral', 'Not Interested'][i % 4] ?? null) as MockMembership['replyCategory'];
}

function buildMembership(params: {
  index: number;
  personIndex: number;
  campaign: MockCampaign;
  companyName: string | null;
}): MockMembership {
  const { index, personIndex, campaign, companyName } = params;
  const createdAt = isoAt(index + personIndex, 9 + (index % 7));
  const replyCategory = pickReply(index + personIndex);
  return {
    id: `lead-${personIndex + 1}-${campaign.id}`,
    globalLeadId: makeGlobalLeadId(personIndex),
    campaignId: campaign.id,
    companyName,
    title: index % 3 === 0 ? 'Head of Growth' : index % 3 === 1 ? 'RevOps Manager' : 'Founder',
    enrollmentState: pickEnrollment(index + personIndex),
    replyCategory,
    createdAt,
    lastActivityAt: isoAt(index + personIndex + 4, 15 + (index % 4)),
    hasReply: replyCategory != null,
    phone: index % 4 === 0 ? null : `555-010-${String((personIndex + index) % 10).padStart(2, '0')}`,
    website: companyName ? `https://${companyName.toLowerCase().replace(/[^a-z0-9]+/g, '')}.com` : null,
    linkedinUrl: index % 5 === 0 ? null : `https://linkedin.com/in/${makeGlobalLeadId(personIndex)}`,
    customLeadData: {
      role: index % 2 === 0 ? 'Champion' : 'Decision Maker',
      region: ['West', 'Central', 'East'][index % 3] ?? 'West',
      intentScore: 62 + ((personIndex + index) % 28),
      persona: index % 4 === 0 ? 'Ops' : 'Growth',
    },
  };
}

function buildPeople(): MockPerson[] {
  const people: MockPerson[] = [];

  for (let i = 0; i < 30; i += 1) {
    const [firstName, lastName] = NAMES[i % NAMES.length]!;
    const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}${i + 1}@example.com`;
    const membershipCampaigns =
      i < 10
        ? [CAMPAIGNS[i % 4]!]
        : i < 20
          ? [CAMPAIGNS[i % 4]!, CAMPAIGNS[(i + 1) % 4]!]
          : i < 25
            ? [CAMPAIGNS[0]!, CAMPAIGNS[2]!, CAMPAIGNS[4]!]
            : [CAMPAIGNS[1]!, CAMPAIGNS[3]!, CAMPAIGNS[5]!];

    const memberships = membershipCampaigns.map((campaign, membershipIndex) => {
      const edgeCompany =
        i >= 10 && membershipIndex > 0
          ? `${COMPANIES[(i + membershipIndex) % COMPANIES.length]} Client`
          : COMPANIES[i % COMPANIES.length]!;
      const companyName = i >= 25 && membershipIndex === 0 ? null : edgeCompany;
      const membership = buildMembership({
        index: membershipIndex,
        personIndex: i,
        campaign,
        companyName,
      });

      if (i >= 25 && membershipIndex === membershipCampaigns.length - 1) {
        membership.replyCategory = 'Interested';
        membership.hasReply = true;
        membership.enrollmentState = 'active';
      }
      return membership;
    });

    people.push({
      id: `person-${i + 1}`,
      globalLeadId: makeGlobalLeadId(i),
      email,
      displayName: `${firstName} ${lastName}`,
      firstName,
      lastName,
      memberships,
    });
  }

  return people;
}

let cachedDataset: LeadsWorkbenchDataset | null = null;

export function getLeadsWorkbenchMockDataset(): LeadsWorkbenchDataset {
  if (cachedDataset) return cachedDataset;
  cachedDataset = {
    campaigns: CAMPAIGNS,
    people: buildPeople(),
  };
  return cachedDataset;
}

function matchesSearch(person: MockPerson, query?: string): boolean {
  const normalized = query?.trim().toLowerCase();
  if (!normalized) return true;
  const haystack = [
    person.email,
    person.displayName ?? '',
    ...person.memberships.map((membership) => membership.companyName ?? ''),
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(normalized);
}

function resolveReplyStatuses(filters: LeadsListFilters): LeadsListFilters['replyStatuses'] {
  if (filters.replyStatuses?.length) return filters.replyStatuses;
  if (filters.requireReply) return ['has_reply'];
  return [];
}

const NATIVE_CAMPAIGN_IDS = CAMPAIGNS.filter((campaign) => !campaign.isSmartlead).map((campaign) => campaign.id);

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function filterPeople(people: MockPerson[], filters: LeadsListFilters, _campaigns: MockCampaign[]): MockPerson[] {
  const allowedCampaignIds = new Set(filters.campaignIds ?? []);
  const allowedGlobalLeadIds = new Set(filters.globalLeadIds ?? []);
  const allowedImportedEmails = new Set((filters.importedEmails ?? []).map(normalizeEmail));
  const replyStatuses = resolveReplyStatuses(filters);
  return people.filter((person) => {
    if (allowedGlobalLeadIds.size > 0 && !allowedGlobalLeadIds.has(person.globalLeadId)) {
      return false;
    }
    if (allowedImportedEmails.size > 0 && !allowedImportedEmails.has(normalizeEmail(person.email))) {
      return false;
    }
    if (!matchesSearch(person, filters.searchQuery)) return false;
    if (replyStatuses.length > 0) {
      const hasReply = person.memberships.some((membership) => membership.hasReply);
      const matchesReplyStatus =
        (replyStatuses.includes('has_reply') && hasReply) ||
        (replyStatuses.includes('no_reply') && !hasReply);
      if (!matchesReplyStatus) return false;
    }
    if (allowedCampaignIds.size > 0 && !person.memberships.some((membership) => allowedCampaignIds.has(membership.campaignId))) {
      return false;
    }
    const enrollmentStates = filters.enrollmentStates ?? filters.statuses ?? [];
    if (enrollmentStates.length > 0 && !person.memberships.some((membership) => enrollmentStates.includes(membership.enrollmentState))) {
      return false;
    }
    const replyCategories = filters.replyCategories ?? [];
    if (replyCategories.length > 0) {
      const matchesReplyCategory = person.memberships.some((membership) => {
        if (membership.replyCategory == null) {
          return replyCategories.includes('not_categorized');
        }
        return replyCategories.includes(membership.replyCategory);
      });
      if (!matchesReplyCategory) return false;
    }
    return true;
  });
}

export function getDefaultLeadsLists(now = new Date().toISOString()): LeadsListDefinition[] {
  const baseColumns: LeadsColumnDef[] = [...DEFAULT_SAVED_LIST_COLUMNS];

  return [
    {
      id: 'all-leads',
      name: 'All leads',
      description: 'Default people view across every campaign.',
      columns: baseColumns,
      filters: {},
      sortColumn: 'rollup-activity',
      sortDirection: 'desc',
      updatedAt: now,
    },
    {
      id: 'hot-replies',
      name: 'Hot replies',
      description: 'People with at least one reply in any campaign.',
      columns: baseColumns,
      filters: { replyStatuses: ['has_reply'] },
      sortColumn: 'rollup-activity',
      sortDirection: 'desc',
      updatedAt: now,
    },
    {
      id: 'native-only',
      name: 'Native campaigns only',
      description: 'People with at least one membership in a Furnace-native campaign.',
      columns: baseColumns,
      filters: { campaignIds: NATIVE_CAMPAIGN_IDS },
      sortColumn: 'rollup-campaigns',
      sortDirection: 'desc',
      updatedAt: now,
    },
  ];
}

