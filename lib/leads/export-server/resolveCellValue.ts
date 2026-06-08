import type {
  LeadsCellValue,
  LeadsColumnDef,
  SavedLeadListPeoplePageRow,
} from './types.js';

export type WorkbenchPersonLike = {
  email: string;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  memberships: Array<{
    campaignId: string;
    companyName: string | null;
    title: string | null;
    enrollmentState: string;
    replyCategory: string | null;
    createdAt: string;
    lastActivityAt: string;
    hasReply: boolean;
    phone: string | null;
    website: string | null;
    linkedinUrl: string | null;
    customLeadData: Record<string, string | number | null>;
  }>;
};

export type PersonSummaryLike = {
  email: string | null;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  campaignCount: number;
  companyList: string | null;
  hasReply: boolean;
  latestActivity: string | null;
};

export function resolvePersonSummaryCellValue(
  person: PersonSummaryLike | SavedLeadListPeoplePageRow,
  fieldKey: string,
): LeadsCellValue {
  switch (fieldKey) {
    case 'email':
      return person.email;
    case 'display_name':
      return person.displayName;
    case 'first_name':
      return person.firstName;
    case 'last_name':
      return person.lastName;
    case 'campaign_count':
      return person.campaignCount;
    case 'company_list':
      return person.companyList;
    case 'has_reply':
      return person.hasReply;
    case 'latest_activity':
      return person.latestActivity;
    default:
      return null;
  }
}

function findMembership(person: WorkbenchPersonLike, column: LeadsColumnDef) {
  if (!column.campaignId) return person.memberships[0] ?? null;
  return person.memberships.find((membership) => membership.campaignId === column.campaignId) ?? null;
}

export function resolveWorkbenchCellValue(
  person: WorkbenchPersonLike,
  column: LeadsColumnDef,
): LeadsCellValue {
  if (column.sourceType === 'person') {
    return resolvePersonSummaryCellValue(
      {
        email: person.email,
        displayName: person.displayName,
        firstName: person.firstName,
        lastName: person.lastName,
        campaignCount: person.memberships.length,
        companyList: null,
        hasReply: person.memberships.some((m) => m.hasReply),
        latestActivity: null,
      },
      column.fieldKey,
    );
  }

  if (column.sourceType === 'membership') {
    const membership = findMembership(person, column);
    if (!membership) return null;
    switch (column.fieldKey) {
      case 'company_name':
        return membership.companyName;
      case 'title':
        return membership.title;
      case 'enrollment_state':
        return membership.enrollmentState;
      case 'reply_category':
        return membership.replyCategory;
      case 'created_at':
        return membership.createdAt;
      case 'last_activity':
        return membership.lastActivityAt;
      case 'phone':
        return membership.phone;
      case 'website':
        return membership.website;
      case 'linkedin_url':
        return membership.linkedinUrl;
      default:
        return membership.customLeadData[column.fieldKey] ?? null;
    }
  }

  if (column.sourceType === 'rollup') {
    switch (column.fieldKey) {
      case 'campaign_count':
        return person.memberships.length;
      case 'company_list': {
        const companies = [...new Set(person.memberships.map((m) => m.companyName).filter(Boolean))];
        return companies.length > 0 ? companies.join(', ') : null;
      }
      case 'has_reply':
        return person.memberships.some((m) => m.hasReply);
      case 'latest_activity':
        return [...person.memberships]
          .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt))[0]?.lastActivityAt ?? null;
      case 'smartlead_count':
        return person.memberships.filter(
          (m) => m.campaignId.includes('orbit') || m.campaignId.includes('nova'),
        ).length;
      case 'native_count':
        return person.memberships.filter(
          (m) => !m.campaignId.includes('orbit') && !m.campaignId.includes('nova'),
        ).length;
      case 'interested_count':
        return person.memberships.filter((m) => m.replyCategory === 'Interested').length;
      default:
        return null;
    }
  }

  return null;
}

export function resolveCellValue(
  column: LeadsColumnDef,
  sources: {
    summary?: PersonSummaryLike | SavedLeadListPeoplePageRow | null;
    workbenchPerson?: WorkbenchPersonLike | null;
  },
): LeadsCellValue {
  if (column.sourceType === 'membership') {
    if (!sources.workbenchPerson) return null;
    return resolveWorkbenchCellValue(sources.workbenchPerson, column);
  }

  if (sources.summary) {
    const fromSummary = resolvePersonSummaryCellValue(sources.summary, column.fieldKey);
    if (fromSummary !== null || column.sourceType === 'person') {
      return fromSummary;
    }
  }

  if (sources.workbenchPerson) {
    return resolveWorkbenchCellValue(sources.workbenchPerson, column);
  }

  return null;
}

export function formatCellValue(column: LeadsColumnDef, value: LeadsCellValue): string {
  if (value == null || value === '') return '—';
  if (
    column.fieldKey === 'created_at' ||
    column.fieldKey === 'last_activity' ||
    column.fieldKey === 'latest_activity'
  ) {
    return new Date(String(value)).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}
