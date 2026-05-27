export type MockReplyCategory = 'Interested' | 'Neutral' | 'Not Interested' | null;
export type MockEnrollmentState = 'active' | 'paused' | 'completed' | 'stopped' | 'not_started';

export interface MockCampaign {
  id: string;
  name: string;
  isSmartlead: boolean;
}

export interface MockMembership {
  id: string;
  globalLeadId: string;
  campaignId: string;
  companyName: string | null;
  title: string | null;
  enrollmentState: MockEnrollmentState;
  replyCategory: MockReplyCategory;
  createdAt: string;
  lastActivityAt: string;
  hasReply: boolean;
  phone: string | null;
  website: string | null;
  linkedinUrl: string | null;
  customLeadData: Record<string, string | number | null>;
}

export interface MockPerson {
  id: string;
  globalLeadId: string;
  email: string;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  memberships: MockMembership[];
}

export type {
  LeadsColumnDef,
  LeadsColumnGroupDefinition,
  LeadsColumnCatalogField,
  LeadsColumnSourceType,
  LeadsCellValue,
  LeadsColumnStat,
} from '@/lib/leads/columns/types';

import type { LeadsColumnDef, LeadsCellValue } from '@/lib/leads/columns/types';

export type LeadsReplyStatusFilter = 'has_reply' | 'no_reply';

export interface LeadsListFilters {
  searchQuery?: string;
  campaignIds?: string[];
  /** Campaigns that have any of these tags (AND with `campaignIds` when both set). */
  campaignTagIds?: string[];
  /** Empty means all reply statuses. */
  replyStatuses?: LeadsReplyStatusFilter[];
  enrollmentStates?: MockEnrollmentState[];
  replyCategories?: Array<NonNullable<MockReplyCategory> | 'not_categorized'>;
  /** When set, only include people with these global lead IDs. */
  globalLeadIds?: string[];
  /** When set, only include people whose email matches one of these values (CSV import prototype). */
  importedEmails?: string[];
  /** @deprecated Use `replyStatuses: ['has_reply']` */
  requireReply?: boolean;
  /** @deprecated Use `enrollmentStates` instead. */
  statuses?: MockEnrollmentState[];
}

export interface LeadsListDefinition {
  id: string;
  name: string;
  description?: string;
  columns: LeadsColumnDef[];
  filters: LeadsListFilters;
  sortColumn?: string;
  sortDirection?: 'asc' | 'desc';
  updatedAt: string;
}

export interface LeadsWorkbenchDataset {
  campaigns: MockCampaign[];
  people: MockPerson[];
}

export interface LeadsPeopleRow {
  person: MockPerson;
  globalLeadId: string;
  cells: Record<string, LeadsCellValue>;
}
