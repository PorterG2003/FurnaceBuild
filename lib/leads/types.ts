import type { MockCampaign, MockPerson } from '@/lib/devtools/leads-workbench/types';
import type { LeadReplacementSummary } from '@/lib/leads/replacementSummary';
import type { ThreadTag } from '@/lib/supabase/services/thread-tags';

export type { MockCampaign as AccountLeadCampaign, MockPerson as AccountLeadPerson } from '@/lib/devtools/leads-workbench/types';

export interface LeadDetailThread {
  id: string;
  leadId: string | null;
  campaignId: string | null;
  subject: string;
  category: string | null;
  lastMessageAt: string;
  hasReply: boolean;
  messageCount: number;
  outOfOffice: boolean;
}

export interface AccountLeadDetail {
  person: MockPerson;
  campaigns: MockCampaign[];
  threads: LeadDetailThread[];
  threadTagsByThreadId: Record<string, ThreadTag[]>;
  replacementSummariesByLeadId: Record<string, LeadReplacementSummary>;
}

export interface AccountPersonProfileUpdate {
  name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  company_name?: string | null;
  website?: string | null;
  linkedin_url?: string | null;
  company_linkedin_url?: string | null;
  phone_number?: string | null;
  custom_lead_data?: Record<string, unknown> | null;
}
