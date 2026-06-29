import type { SupabaseClient } from '@supabase/supabase-js';
import type { LeadInsert } from '../../types';
import { ADD_TO_CAMPAIGN_WRITE_CHUNK_SIZE } from '@/lib/leads/workbench/addToCampaignConstants';
import { fetchLeadsByGlobalLeadIdsWithClient } from './fetch-leads-by-global-ids';
import {
  buildAddToCampaignPayloads,
  mergeLeadUpdatePatch,
  type AddToCampaignPayloadResult,
} from './add-to-campaign-payload';

const POSTGREST_IN_CHUNK_SIZE = 100;
const ENROLLMENT_CHUNK_SIZE = 100;

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

export interface AddGlobalLeadsToCampaignResult {
  created: number;
  updated: number;
  enrolled: number;
  skipped: number;
  /** Leads added but missing one or more required custom (personalization) fields. */
  incomplete: number;
  failed: number;
  errors: Array<{ globalLeadId: string; message: string }>;
}

export interface AddGlobalLeadsToCampaignOptions {
  onProgress?: (processed: number, total: number) => void;
}

type TargetLeadRow = {
  id: string;
  email: string | null;
  global_lead_id: string | null;
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  website: string | null;
  linkedin_url: string | null;
  phone_number: string | null;
  custom_lead_data: LeadInsert['custom_lead_data'];
};

type ReadyPayload = Extract<AddToCampaignPayloadResult, { kind: 'ready' }>;

async function fetchTargetCampaignLeads(
  db: SupabaseClient,
  accountId: string,
  campaignId: string,
  globalLeadIds: string[],
): Promise<Map<string, TargetLeadRow>> {
  const byGlobalId = new Map<string, TargetLeadRow>();
  const uniqueIds = unique(globalLeadIds);
  if (uniqueIds.length === 0) return byGlobalId;

  for (const idChunk of chunk(uniqueIds)) {
    const { data, error } = await db
      .from('leads')
      .select(
        'id, email, global_lead_id, name, first_name, last_name, company_name, website, linkedin_url, phone_number, custom_lead_data',
      )
      .eq('account_id', accountId)
      .eq('campaign_id', campaignId)
      .is('deleted_at', null)
      .in('global_lead_id', idChunk);

    if (error) {
      throw new Error(`Failed to load existing campaign leads: ${error.message}`);
    }

    for (const row of data ?? []) {
      if (row.global_lead_id) {
        byGlobalId.set(row.global_lead_id, row as TargetLeadRow);
      }
    }
  }

  return byGlobalId;
}

async function ensureCampaignEnrollments(
  db: SupabaseClient,
  campaignId: string,
  leadIds: string[],
): Promise<void> {
  if (!leadIds.length) return;

  const { data: campaign, error: campError } = await db
    .from('campaigns')
    .select('account_id, deleted_at')
    .eq('id', campaignId)
    .single();
  if (campError || !campaign?.account_id) {
    throw new Error(`Campaign not found or missing account_id: ${campError?.message}`);
  }
  if (campaign.deleted_at) {
    throw new Error(`Campaign ${campaignId} has been deleted`);
  }

  const rows = leadIds.map((leadId) => ({
    campaign_id: campaignId,
    account_id: campaign.account_id,
    lead_id: leadId,
    current_node_id: null,
    state: 'active' as const,
    next_run_at: new Date().toISOString(),
    flow_position: {},
    deleted_at: null,
  }));

  const { error } = await db.from('enrollments').upsert(rows as never, {
    onConflict: 'campaign_id,lead_id',
    ignoreDuplicates: true,
  });

  if (error) {
    throw new Error(`Failed to ensure campaign enrollments: ${error.message}`);
  }
}

async function ensureActiveEnrollmentsHaveNextRunAt(db: SupabaseClient, leadIds: string[]): Promise<void> {
  if (leadIds.length === 0) return;

  const now = new Date().toISOString();
  const { error } = await db
    .from('enrollments')
    .update({ next_run_at: now, updated_at: now })
    .in('lead_id', leadIds)
    .is('deleted_at', null)
    .eq('state', 'active')
    .is('next_run_at', null);

  if (error) {
    throw new Error(`Failed to refresh enrollments: ${error.message}`);
  }
}

function buildUpsertRow(
  existing: TargetLeadRow,
  incoming: Omit<LeadInsert, 'campaign_id' | 'bucket_id' | 'account_id'>,
  campaignId: string,
  bucketId: string,
  accountId: string,
): { row: Record<string, unknown>; changed: boolean } {
  const patch = mergeLeadUpdatePatch(existing, incoming);
  const changed = Object.keys(patch).length > 1;
  return {
    changed,
    row: {
      id: existing.id,
      campaign_id: campaignId,
      bucket_id: bucketId,
      account_id: accountId,
      email: existing.email,
      global_lead_id: existing.global_lead_id,
      name: (patch.name as string | null | undefined) ?? existing.name,
      first_name: (patch.first_name as string | null | undefined) ?? existing.first_name,
      last_name: (patch.last_name as string | null | undefined) ?? existing.last_name,
      company_name: (patch.company_name as string | null | undefined) ?? existing.company_name,
      website: (patch.website as string | null | undefined) ?? existing.website,
      linkedin_url: (patch.linkedin_url as string | null | undefined) ?? existing.linkedin_url,
      phone_number: (patch.phone_number as string | null | undefined) ?? existing.phone_number,
      custom_lead_data: (patch.custom_lead_data as LeadInsert['custom_lead_data']) ?? existing.custom_lead_data,
      updated_at: patch.updated_at,
    },
  };
}

function toTargetLeadRow(
  row: {
    id: string;
    global_lead_id: string | null;
    email: string | null;
    name?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    company_name?: string | null;
    website?: string | null;
    linkedin_url?: string | null;
    phone_number?: string | null;
    custom_lead_data?: LeadInsert['custom_lead_data'];
  },
  fallback: ReadyPayload,
): TargetLeadRow {
  return {
    id: row.id,
    email: row.email ?? fallback.email,
    global_lead_id: row.global_lead_id,
    name: row.name ?? fallback.insertPayload.name ?? null,
    first_name: row.first_name ?? fallback.insertPayload.first_name ?? null,
    last_name: row.last_name ?? fallback.insertPayload.last_name ?? null,
    company_name: row.company_name ?? fallback.insertPayload.company_name ?? null,
    website: row.website ?? fallback.insertPayload.website ?? null,
    linkedin_url: row.linkedin_url ?? fallback.insertPayload.linkedin_url ?? null,
    phone_number: row.phone_number ?? fallback.insertPayload.phone_number ?? null,
    custom_lead_data: row.custom_lead_data ?? fallback.insertPayload.custom_lead_data ?? null,
  };
}

async function upsertLeadRowsBatch(
  db: SupabaseClient,
  rows: Record<string, unknown>[],
): Promise<void> {
  const { error } = await db.from('leads').upsert(rows as never, { onConflict: 'id' });
  if (error) {
    throw new Error(error.message);
  }
}

async function insertLeadRowsBatch(
  db: SupabaseClient,
  rows: LeadInsert[],
): Promise<Array<{ id: string; global_lead_id: string | null }>> {
  const { data, error } = await db.from('leads').insert(rows).select('id, global_lead_id');
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []) as Array<{ id: string; global_lead_id: string | null }>;
}

async function processNewLead(
  db: SupabaseClient,
  result: AddGlobalLeadsToCampaignResult,
  payload: ReadyPayload,
  campaignId: string,
  bucketId: string,
  accountId: string,
  existingByGlobalId: Map<string, TargetLeadRow>,
  leadIdsToEnroll: string[],
): Promise<void> {
  const insertPayload: LeadInsert = {
    ...payload.insertPayload,
    campaign_id: campaignId,
    bucket_id: bucketId,
    account_id: accountId,
  };

  const { data: inserted, error: insertError } = await db
    .from('leads')
    .insert(insertPayload)
    .select('id, global_lead_id')
    .single();

  if (insertError) {
    throw new Error(insertError.message);
  }

  if (inserted?.id) {
    leadIdsToEnroll.push(inserted.id);
    if (inserted.global_lead_id) {
      existingByGlobalId.set(inserted.global_lead_id, toTargetLeadRow(inserted, payload));
    }
    result.created += 1;
  }
}

export async function addGlobalLeadsToCampaignWithClient(
  db: SupabaseClient,
  accountId: string,
  campaignId: string,
  globalLeadIds: string[],
  options: AddGlobalLeadsToCampaignOptions = {},
): Promise<AddGlobalLeadsToCampaignResult> {
  const uniqueGlobalIds = unique(globalLeadIds.filter(Boolean));
  const result: AddGlobalLeadsToCampaignResult = {
    created: 0,
    updated: 0,
    enrolled: 0,
    skipped: 0,
    incomplete: 0,
    failed: 0,
    errors: [],
  };

  if (uniqueGlobalIds.length === 0) {
    return result;
  }

  const { data: campaign, error: campaignError } = await db
    .from('campaigns')
    .select('id, account_id, bucket_id, flow_data, source, deleted_at')
    .eq('id', campaignId)
    .single();

  if (campaignError || !campaign?.account_id || campaign.account_id !== accountId) {
    throw new Error('Campaign not found for this account.');
  }
  if (campaign.deleted_at) {
    throw new Error('Campaign has been deleted.');
  }
  if (campaign.source === 'smartlead') {
    throw new Error('Smartlead campaigns are read-only.');
  }
  if (!campaign.bucket_id) {
    throw new Error('Campaign is missing a bucket.');
  }

  const [sourceRows, existingByGlobalId] = await Promise.all([
    fetchLeadsByGlobalLeadIdsWithClient(db, accountId, uniqueGlobalIds),
    fetchTargetCampaignLeads(db, accountId, campaignId, uniqueGlobalIds),
  ]);

  const payloads = buildAddToCampaignPayloads({
    flowData: campaign.flow_data,
    sourceRows,
    globalLeadIds: uniqueGlobalIds,
    targetCampaignId: campaignId,
  });

  const leadIdsToEnroll: string[] = [];
  const total = payloads.length;
  let processed = 0;
  const reportProgress = (count: number) => {
    processed += count;
    options.onProgress?.(processed, total);
  };

  const readyCreates: ReadyPayload[] = [];
  const readyUpdates: Array<{ payload: ReadyPayload; existing: TargetLeadRow }> = [];

  for (const payload of payloads) {
    if (payload.kind === 'skipped') {
      result.skipped += 1;
      result.errors.push({ globalLeadId: payload.globalLeadId, message: payload.reason });
      reportProgress(1);
      continue;
    }

    if (payload.incomplete) {
      result.incomplete += 1;
    }

    const existing = existingByGlobalId.get(payload.globalLeadId);
    if (existing) {
      readyUpdates.push({ payload, existing });
    } else {
      readyCreates.push(payload);
    }
  }

  for (const updateChunk of chunk(readyUpdates, ADD_TO_CAMPAIGN_WRITE_CHUNK_SIZE)) {
    const upsertRows: Record<string, unknown>[] = [];
    const upsertPayloads: Array<{ payload: ReadyPayload; existing: TargetLeadRow }> = [];

    for (const { payload, existing } of updateChunk) {
      const { row, changed } = buildUpsertRow(
        existing,
        payload.insertPayload,
        campaignId,
        campaign.bucket_id,
        accountId,
      );
      leadIdsToEnroll.push(existing.id);
      result.updated += 1;
      if (changed) {
        upsertRows.push(row);
        upsertPayloads.push({ payload, existing });
      }
    }

    if (upsertRows.length > 0) {
      try {
        await upsertLeadRowsBatch(db, upsertRows);
      } catch {
        for (let index = 0; index < upsertRows.length; index += 1) {
          const row = upsertRows[index]!;
          const { payload, existing } = upsertPayloads[index]!;
          try {
            const { error: updateError } = await db
              .from('leads')
              .update(row)
              .eq('id', existing.id)
              .is('deleted_at', null);
            if (updateError) {
              throw new Error(updateError.message);
            }
          } catch (error) {
            result.failed += 1;
            result.updated -= 1;
            const enrollIdx = leadIdsToEnroll.lastIndexOf(existing.id);
            if (enrollIdx >= 0) leadIdsToEnroll.splice(enrollIdx, 1);
            result.errors.push({
              globalLeadId: payload.globalLeadId,
              message: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }
    }

    reportProgress(updateChunk.length);
  }

  for (const createChunk of chunk(readyCreates, ADD_TO_CAMPAIGN_WRITE_CHUNK_SIZE)) {
    const insertRows: LeadInsert[] = createChunk.map((payload) => ({
      ...payload.insertPayload,
      campaign_id: campaignId,
      bucket_id: campaign.bucket_id,
      account_id: accountId,
    }));

    try {
      const insertedRows = await insertLeadRowsBatch(db, insertRows);
      const insertedByGlobalId = new Map(
        insertedRows
          .filter((row) => row.global_lead_id)
          .map((row) => [row.global_lead_id as string, row]),
      );

      for (const payload of createChunk) {
        const inserted = insertedByGlobalId.get(payload.globalLeadId);
        if (!inserted?.id) {
          result.failed += 1;
          result.errors.push({
            globalLeadId: payload.globalLeadId,
            message: 'Lead insert did not return a row id.',
          });
          continue;
        }

        leadIdsToEnroll.push(inserted.id);
        existingByGlobalId.set(payload.globalLeadId, toTargetLeadRow(inserted, payload));
        result.created += 1;
      }
    } catch {
      for (const payload of createChunk) {
        try {
          await processNewLead(
            db,
            result,
            payload,
            campaignId,
            campaign.bucket_id,
            accountId,
            existingByGlobalId,
            leadIdsToEnroll,
          );
        } catch (error) {
          result.failed += 1;
          result.errors.push({
            globalLeadId: payload.globalLeadId,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    reportProgress(createChunk.length);
  }

  const uniqueLeadIds = unique(leadIdsToEnroll);
  for (const leadIdChunk of chunk(uniqueLeadIds, ENROLLMENT_CHUNK_SIZE)) {
    await ensureCampaignEnrollments(db, campaignId, leadIdChunk);
    result.enrolled += leadIdChunk.length;
  }

  await ensureActiveEnrollmentsHaveNextRunAt(db, uniqueLeadIds);

  return result;
}

export type { AddToCampaignPayloadResult };
