import type { SupabaseClient } from '@supabase/supabase-js';
import type { Campaign, CampaignInsert, LeadInsert } from '../../types';
import type { Database } from '../../types/database';
import { updateCampaignFlowDataWithClient } from './update-campaign-flow-with-client';

type DbClient = SupabaseClient<Database>;

const LEAD_COPY_CHUNK_SIZE = 200;

export interface DuplicateCampaignOptions {
  name: string;
  ownerId: string;
  accountId: string;
  copySettings?: boolean;
  copyLeads?: boolean;
}

type SourceLeadRow = {
  email: string | null;
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  website: string | null;
  linkedin_url: string | null;
  company_linkedin_url: string | null;
  phone_number: string | null;
  mobile_phone_number: string | null;
  source: string | null;
  custom_lead_data: LeadInsert['custom_lead_data'];
  global_lead_id: string | null;
  mailbox_id: string | null;
};

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function getCampaignByIdWithClient(db: DbClient, id: string): Promise<Campaign | null> {
  const { data, error } = await db
    .from('campaigns')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    throw new Error(`Failed to fetch campaign: ${error.message}`);
  }

  return data;
}

async function createCampaignWithClient(db: DbClient, campaign: CampaignInsert): Promise<Campaign> {
  const now = new Date().toISOString();
  const { data, error } = await db
    .from('campaigns')
    .insert({
      ...campaign,
      created_at: now,
      updated_at: now,
    } as never)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create campaign: ${error.message}`);
  }
  if (!data) {
    throw new Error('Failed to create campaign: No data returned');
  }

  return data;
}

async function updateCampaignSettingsWithClient(
  db: DbClient,
  campaignId: string,
  sourceCampaign: Campaign,
): Promise<void> {
  const { error } = await db
    .from('campaigns')
    .update({
      jitter_percentage: sourceCampaign.jitter_percentage,
      schedule: sourceCampaign.schedule,
      sending_interval_seconds: sourceCampaign.sending_interval_seconds,
      webhook_url_override: sourceCampaign.webhook_url_override,
      webhook_signing_secret_override: sourceCampaign.webhook_signing_secret_override,
      webhook_enabled_events_override: sourceCampaign.webhook_enabled_events_override,
      locked: false,
      updated_at: new Date().toISOString(),
    } as never)
    .eq('id', campaignId)
    .is('deleted_at', null);

  if (error) {
    throw new Error(`Failed to update campaign settings: ${error.message}`);
  }
}

async function getCampaignMailboxIdsWithClient(db: DbClient, campaignId: string): Promise<string[]> {
  const { data, error } = await db
    .from('campaign_mailboxes')
    .select('mailbox_id')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch campaign mailbox assignments: ${error.message}`);
  }

  return ((data ?? []) as Array<{ mailbox_id: string | null }>).map((row) => row.mailbox_id).filter(Boolean) as string[];
}

async function copyCampaignMailboxAssignmentsWithClient(
  db: DbClient,
  sourceMailboxIds: string[],
  targetCampaignId: string,
  targetAccountId: string,
): Promise<void> {
  if (sourceMailboxIds.length === 0) {
    return;
  }

  const { error } = await db.from('campaign_mailboxes').insert(
    sourceMailboxIds.map((mailboxId) => ({
      campaign_id: targetCampaignId,
      mailbox_id: mailboxId,
      account_id: targetAccountId,
    })) as never,
  );

  if (error) {
    throw new Error(`Failed to copy campaign mailbox assignments: ${error.message}`);
  }
}

async function copyCampaignTagsWithClient(
  db: DbClient,
  sourceCampaignId: string,
  targetCampaignId: string,
  targetAccountId: string,
): Promise<void> {
  const { data, error } = await db
    .from('campaign_tag_assignments')
    .select('tag_id')
    .eq('campaign_id', sourceCampaignId);

  if (error) {
    throw new Error(`Failed to fetch campaign tag assignments: ${error.message}`);
  }

  const tagIds = [
    ...new Set(((data ?? []) as Array<{ tag_id: string | null }>).map((row) => row.tag_id).filter(Boolean)),
  ] as string[];
  if (tagIds.length === 0) {
    return;
  }

  const { error: insertError } = await db.from('campaign_tag_assignments').insert(
    tagIds.map((tagId) => ({
      campaign_id: targetCampaignId,
      tag_id: tagId,
      account_id: targetAccountId,
    })) as never,
  );

  if (insertError) {
    throw new Error(`Failed to copy campaign tags: ${insertError.message}`);
  }
}

async function copyCampaignLeadsWithClient(
  db: DbClient,
  sourceCampaignId: string,
  targetCampaign: Campaign,
  copiedMailboxIds: Set<string>,
): Promise<void> {
  const { data, error } = await db
    .from('leads')
    .select(
      'email, name, first_name, last_name, company_name, website, linkedin_url, company_linkedin_url, phone_number, mobile_phone_number, source, custom_lead_data, global_lead_id, mailbox_id',
    )
    .eq('campaign_id', sourceCampaignId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch source campaign leads: ${error.message}`);
  }

  const targetAccountId = targetCampaign.account_id;
  if (!targetAccountId) {
    throw new Error('Duplicated campaign is missing an account_id.');
  }

  const leadRows = (data ?? []) as SourceLeadRow[];
  if (leadRows.length === 0) {
    return;
  }

  const inserts: LeadInsert[] = leadRows.map((lead) => ({
    campaign_id: targetCampaign.id,
    bucket_id: targetCampaign.bucket_id,
    account_id: targetAccountId,
    email: lead.email,
    name: lead.name,
    first_name: lead.first_name,
    last_name: lead.last_name,
    company_name: lead.company_name,
    website: lead.website,
    linkedin_url: lead.linkedin_url,
    company_linkedin_url: lead.company_linkedin_url,
    phone_number: lead.phone_number,
    mobile_phone_number: lead.mobile_phone_number,
    source: lead.source,
    custom_lead_data: lead.custom_lead_data ?? null,
    global_lead_id: lead.global_lead_id,
    mailbox_id: lead.mailbox_id && copiedMailboxIds.has(lead.mailbox_id) ? lead.mailbox_id : null,
    smartlead_lead_id: null,
  }));

  for (const batch of chunk(inserts, LEAD_COPY_CHUNK_SIZE)) {
    const { error: insertError } = await db.from('leads').insert(batch as never);
    if (insertError) {
      throw new Error(`Failed to copy campaign leads: ${insertError.message}`);
    }
  }
}

export async function duplicateCampaignWithClient(
  db: DbClient,
  sourceCampaignId: string,
  options: DuplicateCampaignOptions,
): Promise<Campaign> {
  const sourceCampaign = await getCampaignByIdWithClient(db, sourceCampaignId);
  if (!sourceCampaign || sourceCampaign.deleted_at) {
    throw new Error('Campaign not found.');
  }
  if (!sourceCampaign.account_id || sourceCampaign.account_id !== options.accountId) {
    throw new Error('Campaign not found for this account.');
  }
  if (sourceCampaign.source === 'smartlead' || sourceCampaign.smartlead_campaign_id != null) {
    throw new Error('Smartlead campaigns are read-only.');
  }

  const copySettings = options.copySettings ?? true;
  const copyLeads = options.copyLeads ?? false;

  const duplicatedCampaign = await createCampaignWithClient(db, {
    name: options.name,
    owner_id: options.ownerId,
    account_id: options.accountId,
    organization_id: null,
    status: 'draft',
  });

  let copiedMailboxIds: string[] = [];

  if (copySettings) {
    await updateCampaignSettingsWithClient(db, duplicatedCampaign.id, sourceCampaign);

    if (sourceCampaign.flow_data) {
      await updateCampaignFlowDataWithClient(db, {
        campaignId: duplicatedCampaign.id,
        accountId: targetAccountId,
        flowData: sourceCampaign.flow_data,
        changeSource: 'duplicate_campaign',
      });
    }

    copiedMailboxIds = await getCampaignMailboxIdsWithClient(db, sourceCampaign.id);
    await copyCampaignMailboxAssignmentsWithClient(db, copiedMailboxIds, duplicatedCampaign.id, options.accountId);
    await copyCampaignTagsWithClient(db, sourceCampaign.id, duplicatedCampaign.id, options.accountId);
  }

  if (copyLeads) {
    await copyCampaignLeadsWithClient(db, sourceCampaign.id, duplicatedCampaign, new Set(copiedMailboxIds));
  }

  const reloadedCampaign = await getCampaignByIdWithClient(db, duplicatedCampaign.id);
  if (!reloadedCampaign) {
    throw new Error('Failed to load duplicated campaign.');
  }

  return reloadedCampaign;
}
