export type LeadsColumnSourceType = 'person' | 'membership' | 'rollup';

export interface LeadsColumnDef {
  id: string;
  sourceType: LeadsColumnSourceType;
  sourceLabel: string;
  fieldKey: string;
  label: string;
  visible: boolean;
  campaignId?: string | null;
  campaignName?: string | null;
  width?: number;
}

export type LeadsCellValue = string | number | boolean | null;

export type MockReplyCategory = 'Interested' | 'Neutral' | 'Not Interested' | null;

export type MockMembership = {
  id: string;
  globalLeadId: string;
  campaignId: string;
  companyName: string | null;
  title: string | null;
  enrollmentState: 'not_started' | 'active' | 'paused' | 'completed' | 'stopped';
  replyCategory: MockReplyCategory;
  createdAt: string;
  lastActivityAt: string;
  hasReply: boolean;
  phone: string | null;
  mobilePhone: string | null;
  website: string | null;
  linkedinUrl: string | null;
  customLeadData: Record<string, string | number | null>;
};

export type MockPerson = {
  id: string;
  globalLeadId: string;
  email: string;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  memberships: MockMembership[];
};

export type LeadsTableRow = {
  person: MockPerson;
  globalLeadId: string;
  cells: Record<string, LeadsCellValue>;
};

export type AccountLeadPersonSummary = {
  globalLeadId: string;
  email: string;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  campaignCount: number;
  companyList: string | null;
  hasReply: boolean;
  latestActivity: string | null;
  newestMembershipCreatedAt: string | null;
};

export type SavedLeadListPeoplePageRow = {
  globalLeadId: string;
  email: string | null;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  campaignCount: number;
  companyList: string | null;
  hasReply: boolean;
  latestActivity: string | null;
  newestMembershipCreatedAt: string | null;
};

export type AccountLeadExplorerQuery = {
  searchQuery?: string;
  campaignIds?: string[];
  campaignTagIds?: string[];
  replyStatuses?: Array<'replied' | 'not_replied'>;
  enrollmentStates?: Array<'not_started' | 'active' | 'paused' | 'completed' | 'stopped'>;
  replyCategories?: Array<'Interested' | 'Neutral' | 'Not Interested'>;
  sortColumn?: string;
  sortDirection?: 'asc' | 'desc';
  globalLeadIds?: string[];
  limit?: number;
  offset?: number;
};

export type SavedLeadListPeopleQuery = {
  searchQuery?: string;
  campaignIds?: string[];
  campaignTagIds?: string[];
  replyStatuses?: Array<'replied' | 'not_replied'>;
  enrollmentStates?: Array<'not_started' | 'active' | 'paused' | 'completed' | 'stopped'>;
  replyCategories?: Array<'Interested' | 'Neutral' | 'Not Interested'>;
  sortColumn?: string;
  sortDirection?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
};
