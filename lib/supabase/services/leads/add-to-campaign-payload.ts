import { getCampaignCustomFieldKeys } from '@/lib/client-api/flow-fields';
import type { Json } from '@/lib/supabase/types/database';
import type { LeadInsert } from '@/lib/supabase/types';
import type { LeadRowByGlobalId } from './fetch-leads-by-global-ids';

export type AddToCampaignPayloadResult =
  | {
      kind: 'ready';
      globalLeadId: string;
      email: string;
      insertPayload: Omit<LeadInsert, 'campaign_id' | 'bucket_id' | 'account_id'>;
    }
  | {
      kind: 'skipped';
      globalLeadId: string;
      reason: string;
    };

function pickNewestMembershipRow(rows: LeadRowByGlobalId[]): LeadRowByGlobalId | null {
  if (rows.length === 0) return null;
  return [...rows].sort((left, right) => {
    const byCreated = right.created_at.localeCompare(left.created_at);
    if (byCreated !== 0) return byCreated;
    return right.id.localeCompare(left.id);
  })[0]!;
}

function mergeCustomLeadData(
  existing: Record<string, string | number | null> | null | undefined,
  incoming: Record<string, string | number | null> | null | undefined,
): Record<string, string | number | null> {
  return {
    ...(existing ?? {}),
    ...(incoming ?? {}),
  };
}

function buildDisplayName(row: LeadRowByGlobalId): string | null {
  return row.name ?? ([row.first_name, row.last_name].filter(Boolean).join(' ') || null);
}

export function buildAddToCampaignPayloads(params: {
  flowData: Json | null | undefined;
  sourceRows: LeadRowByGlobalId[];
  globalLeadIds: string[];
  targetCampaignId: string;
}): AddToCampaignPayloadResult[] {
  const { flowData, sourceRows, globalLeadIds, targetCampaignId } = params;
  const requiredCustomKeys = getCampaignCustomFieldKeys(flowData);
  const rowsByGlobalId = new Map<string, LeadRowByGlobalId[]>();

  for (const row of sourceRows) {
    if (!row.global_lead_id) continue;
    const current = rowsByGlobalId.get(row.global_lead_id) ?? [];
    current.push(row);
    rowsByGlobalId.set(row.global_lead_id, current);
  }

  return globalLeadIds.map((globalLeadId) => {
    const memberships = rowsByGlobalId.get(globalLeadId) ?? [];
    const nonTargetMemberships = memberships.filter((row) => row.campaign_id !== targetCampaignId);
    const source =
      pickNewestMembershipRow(nonTargetMemberships.length > 0 ? nonTargetMemberships : memberships);

    if (!source?.email?.trim()) {
      return {
        kind: 'skipped',
        globalLeadId,
        reason: 'No email found for this person in the account.',
      };
    }

    const customLeadData = mergeCustomLeadData(
      null,
      (source.custom_lead_data ?? {}) as Record<string, string | number | null>,
    );

    for (const key of requiredCustomKeys) {
      const value = customLeadData[key];
      if (value === undefined || value === null || value === '') {
        return {
          kind: 'skipped',
          globalLeadId,
          reason: `Missing required custom field "${key}" for the target campaign.`,
        };
      }
    }

    return {
      kind: 'ready',
      globalLeadId,
      email: source.email.trim().toLowerCase(),
      insertPayload: {
        email: source.email.trim().toLowerCase(),
        name: buildDisplayName(source),
        first_name: source.first_name,
        last_name: source.last_name,
        company_name: source.company_name,
        website: source.website,
        linkedin_url: source.linkedin_url,
        phone_number: source.phone_number,
        global_lead_id: globalLeadId,
        source: 'Leads workbench',
        custom_lead_data: Object.keys(customLeadData).length > 0 ? (customLeadData as Json) : null,
      },
    };
  });
}

export function mergeLeadUpdatePatch(
  existing: {
    name: string | null;
    first_name: string | null;
    last_name: string | null;
    company_name: string | null;
    website: string | null;
    linkedin_url: string | null;
    phone_number: string | null;
    custom_lead_data: Json | null;
  },
  incoming: Omit<LeadInsert, 'campaign_id' | 'bucket_id' | 'account_id'>,
): Record<string, unknown> {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (!existing.name && incoming.name) patch.name = incoming.name;
  if (!existing.first_name && incoming.first_name) patch.first_name = incoming.first_name;
  if (!existing.last_name && incoming.last_name) patch.last_name = incoming.last_name;
  if (!existing.company_name && incoming.company_name) patch.company_name = incoming.company_name;
  if (!existing.website && incoming.website) patch.website = incoming.website;
  if (!existing.linkedin_url && incoming.linkedin_url) patch.linkedin_url = incoming.linkedin_url;
  if (!existing.phone_number && incoming.phone_number) patch.phone_number = incoming.phone_number;

  const existingCustom =
    existing.custom_lead_data && typeof existing.custom_lead_data === 'object' && !Array.isArray(existing.custom_lead_data)
      ? (existing.custom_lead_data as Record<string, unknown>)
      : {};
  const incomingCustom =
    incoming.custom_lead_data && typeof incoming.custom_lead_data === 'object' && !Array.isArray(incoming.custom_lead_data)
      ? (incoming.custom_lead_data as Record<string, unknown>)
      : {};
  if (Object.keys(incomingCustom).length > 0) {
    patch.custom_lead_data = { ...existingCustom, ...incomingCustom };
  }

  return patch;
}
