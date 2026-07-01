import { supabase } from '../../client';
import type { AccountLeadDetail, AccountPersonProfileUpdate, LeadDetailThread } from '@/lib/leads/types';
import {
  buildMockPersonFromSummary,
  getAccountLeadCampaigns,
  getAccountLeadPersonSummaryFromRollup,
  getAccountLeadWorkbenchDataset,
} from './account-leads';
import { fetchLeadIdsByGlobalLeadIdsIncludingDeleted } from './fetch-leads-by-global-ids';
import { getLeadReplacementSummariesByLeadIds } from '../leads';
import { getTagsForThreads } from '../thread-tags';

const POSTGREST_IN_CHUNK_SIZE = 100;
const POSTGREST_RANGE_PAGE_SIZE = 500;

function chunk<T>(values: T[], chunkSize = POSTGREST_IN_CHUNK_SIZE): T[][] {
  if (values.length === 0) return [];
  const chunks: T[][] = [];
  for (let i = 0; i < values.length; i += chunkSize) {
    chunks.push(values.slice(i, i + chunkSize));
  }
  return chunks;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

type ThreadRow = {
  id: string;
  lead_id: string | null;
  campaign_id: string | null;
  subject: string;
  category: string | null;
  last_message_at: string;
  has_reply: boolean;
  message_count: number;
  out_of_office: boolean;
};

async function fetchLeadDetailThreads(accountId: string, leadIds: string[]): Promise<LeadDetailThread[]> {
  const rows: ThreadRow[] = [];
  for (const idChunk of chunk(unique(leadIds))) {
    for (let offset = 0; ; offset += POSTGREST_RANGE_PAGE_SIZE) {
      const { data, error } = await supabase
        .from('email_threads')
        .select(
          'id, lead_id, campaign_id, subject, category, last_message_at, has_reply, message_count, out_of_office',
        )
        .eq('account_id', accountId)
        .in('lead_id', idChunk)
        .order('last_message_at', { ascending: false })
        .order('id', { ascending: true })
        .range(offset, offset + POSTGREST_RANGE_PAGE_SIZE - 1);

      if (error) {
        throw new Error(`Failed to fetch lead threads: ${error.message}`);
      }

      const pageRows = (data ?? []) as ThreadRow[];
      rows.push(...pageRows);
      if (pageRows.length < POSTGREST_RANGE_PAGE_SIZE) break;
    }
  }

  return rows.map((thread) => ({
    id: thread.id,
    leadId: thread.lead_id,
    campaignId: thread.campaign_id,
    subject: thread.subject,
    category: thread.category,
    lastMessageAt: thread.last_message_at,
    hasReply: thread.has_reply,
    messageCount: thread.message_count,
    outOfOffice: thread.out_of_office,
  }));
}

export async function getAccountLeadDetail(
  accountId: string,
  globalLeadId: string,
): Promise<AccountLeadDetail | null> {
  const dataset = await getAccountLeadWorkbenchDataset(accountId, [globalLeadId]);
  let person = dataset.people[0];

  if (!person) {
    const summary = await getAccountLeadPersonSummaryFromRollup(accountId, globalLeadId);
    if (!summary) {
      return null;
    }
    person = buildMockPersonFromSummary(summary);
  }

  const activeLeadIds = person.memberships.map((membership) => membership.id);
  const historicalLeadIds =
    activeLeadIds.length > 0
      ? activeLeadIds
      : await fetchLeadIdsByGlobalLeadIdsIncludingDeleted(accountId, [globalLeadId]);

  const [threads, replacementSummariesByLeadId] = await Promise.all([
    historicalLeadIds.length ? fetchLeadDetailThreads(accountId, historicalLeadIds) : Promise.resolve([]),
    historicalLeadIds.length ? getLeadReplacementSummariesByLeadIds(historicalLeadIds) : Promise.resolve({}),
  ]);

  const threadIds = threads.map((thread) => thread.id);
  const threadTagsByThreadId = threadIds.length ? await getTagsForThreads(threadIds) : {};

  const campaigns =
    dataset.campaigns.length > 0 ? dataset.campaigns : await getAccountLeadCampaigns(accountId);

  return {
    person,
    campaigns,
    threads,
    threadTagsByThreadId,
    replacementSummariesByLeadId,
  };
}

function profileUpdatePayload(updates: AccountPersonProfileUpdate): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) {
      payload[key] = value;
    }
  }
  return payload;
}

function formatProfileUpdateError(message: string): string {
  if (message.includes('Failed to fetch')) {
    return 'Network error while saving. Check your connection and try again.';
  }
  return message;
}

export async function updateAccountPersonProfile(
  accountId: string,
  globalLeadId: string,
  updates: AccountPersonProfileUpdate,
): Promise<void> {
  const payload = profileUpdatePayload(updates);
  if (Object.keys(payload).length === 0) {
    return;
  }

  const { error } = await supabase.rpc('update_account_person_profile', {
    p_account_id: accountId,
    p_global_lead_id: globalLeadId,
    p_updates: payload,
  });

  if (error) {
    throw new Error(`Failed to update lead profile: ${formatProfileUpdateError(error.message)}`);
  }
}
