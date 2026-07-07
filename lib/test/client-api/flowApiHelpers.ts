import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { hashApiKey } from '../../client-api/auth.js';
import type { CampaignFlowData } from '../../campaigns/flow/index.js';
import { CAMPAIGN_FLOW_EXAMPLE_LINEAR } from '../../campaigns/flow/index.js';
import type { ClientApiDbHarness } from './harness.js';

export type FlowSaveResponseData = {
  flow: CampaignFlowData;
  flow_revision: string;
  field_sync: {
    declared_custom_added: string[];
    declared_custom_removed: string[];
    mapped_standard_added: string[];
    mapped_standard_removed: string[];
  };
  change_kind: string;
  change_reasons: string[];
  validation: {
    issues: unknown[];
    warnings: unknown[];
    blocking_issues: unknown[];
  };
  lifecycle: {
    allowed: boolean;
    code?: string;
    message?: string;
  };
};

export type FlowDryRunResponseData = {
  normalized_flow: CampaignFlowData;
  flow_revision: string;
  field_sync: FlowSaveResponseData['field_sync'];
  allowed: boolean;
  change_kind: string;
  change_reasons: string[];
  lifecycle: FlowSaveResponseData['lifecycle'];
  issues: unknown[];
  warnings: unknown[];
  blocking_issues: unknown[];
};

export function cloneFlow<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function linearFlowForApi(customFieldKeys: string[] = ['company']): CampaignFlowData {
  const flow = linearFlowForFieldSyncTest();
  const leadSource = flow.nodes.find((node) => node.type === 'leadSource');
  assert.ok(leadSource);
  leadSource!.data.customFieldKeys = customFieldKeys;
  return flow;
}

export function linearFlowForFieldSyncTest(): CampaignFlowData {
  const flow = cloneFlow(CAMPAIGN_FLOW_EXAMPLE_LINEAR);
  const leadSource = flow.nodes.find((node) => node.type === 'leadSource');
  assert.ok(leadSource);
  leadSource!.data.customFieldKeys = [];
  return flow;
}

export async function cleanupCreatedCampaign(
  harness: ClientApiDbHarness,
  campaignId: string | null,
): Promise<void> {
  if (!campaignId) return;
  await harness.supabase.from('campaign_flow_versions').delete().eq('campaign_id', campaignId);
  await harness.supabase.from('enrollments').delete().eq('campaign_id', campaignId);
  await harness.supabase.from('campaign_mailboxes').delete().eq('campaign_id', campaignId);
  await harness.supabase.from('campaign_tag_assignments').delete().eq('campaign_id', campaignId);
  await harness.supabase.from('nodes').delete().eq('campaign_id', campaignId);
  await harness.supabase.from('leads').delete().eq('campaign_id', campaignId);
  await harness.supabase.from('campaigns').delete().eq('id', campaignId);
}

export async function getFlowRevision(
  harness: ClientApiDbHarness,
  campaignId: string,
  apiKey: string,
): Promise<string> {
  const response = await harness.request(`/v1/campaigns/${campaignId}/flow`, {
    method: 'GET',
    apiKey,
  });
  assert.equal(response.status, 200);
  const body = await response.json() as { data: { flow_revision: string } };
  return body.data.flow_revision;
}

type SaveFlowOptions = {
  method?: 'POST' | 'PUT';
  ifMatch?: string;
  dryRun?: boolean;
  apiKey: string;
};

export async function saveFlow(
  harness: ClientApiDbHarness,
  campaignId: string,
  flow: CampaignFlowData | Record<string, unknown>,
  options: SaveFlowOptions,
): Promise<Response> {
  const query = options.dryRun ? '?dry_run=true' : '';
  const headers: Record<string, string> = {};
  if (options.ifMatch) {
    headers['If-Match'] = options.ifMatch;
  }
  return harness.request(`/v1/campaigns/${campaignId}/flow${query}`, {
    method: options.method ?? 'POST',
    apiKey: options.apiKey,
    headers,
    body: flow,
  });
}

export async function validateFlow(
  harness: ClientApiDbHarness,
  campaignId: string,
  flow: CampaignFlowData | Record<string, unknown>,
  apiKey: string,
): Promise<Response> {
  return harness.request(`/v1/campaigns/${campaignId}/flow:validate`, {
    method: 'POST',
    apiKey,
    body: flow,
  });
}

export async function patchFlowNode(
  harness: ClientApiDbHarness,
  campaignId: string,
  nodeId: string,
  data: Record<string, unknown>,
  apiKey: string,
): Promise<Response> {
  return harness.request(`/v1/campaigns/${campaignId}/flow/nodes/${nodeId}`, {
    method: 'PATCH',
    apiKey,
    body: { data },
  });
}

export function assertFlowSaveShape(data: unknown): asserts data is FlowSaveResponseData {
  assert.ok(data && typeof data === 'object');
  const record = data as Record<string, unknown>;
  assert.ok(record.flow && typeof record.flow === 'object');
  assert.equal(typeof record.flow_revision, 'string');
  assert.ok(record.field_sync && typeof record.field_sync === 'object');
  assert.equal(typeof record.change_kind, 'string');
  assert.ok(Array.isArray(record.change_reasons));
  assert.ok(record.validation && typeof record.validation === 'object');
  assert.ok(record.lifecycle && typeof record.lifecycle === 'object');
  assert.equal(typeof (record.lifecycle as { allowed: boolean }).allowed, 'boolean');
}

export function assertFlowDryRunShape(data: unknown): asserts data is FlowDryRunResponseData {
  assert.ok(data && typeof data === 'object');
  const record = data as Record<string, unknown>;
  assert.ok(record.normalized_flow && typeof record.normalized_flow === 'object');
  assert.equal(typeof record.flow_revision, 'string');
  assert.ok(record.field_sync && typeof record.field_sync === 'object');
  assert.equal(typeof record.allowed, 'boolean');
  assert.equal(typeof record.change_kind, 'string');
  assert.ok(Array.isArray(record.change_reasons));
  assert.ok(record.lifecycle && typeof record.lifecycle === 'object');
  assert.ok(Array.isArray(record.issues));
  assert.ok(Array.isArray(record.warnings));
  assert.ok(Array.isArray(record.blocking_issues));
}

export async function loadCampaignFlowFromDb(
  harness: ClientApiDbHarness,
  campaignId: string,
): Promise<CampaignFlowData | null> {
  const { data, error } = await harness.supabase
    .from('campaigns')
    .select('flow_data')
    .eq('id', campaignId)
    .maybeSingle();
  assert.equal(error, null);
  if (!data?.flow_data || typeof data.flow_data !== 'object') {
    return null;
  }
  return data.flow_data as CampaignFlowData;
}

export async function loadLatestFlowVersion(
  harness: ClientApiDbHarness,
  campaignId: string,
): Promise<{
  version_number: number;
  change_source: string;
  flow_data: unknown;
} | null> {
  const { data, error } = await harness.supabase
    .from('campaign_flow_versions')
    .select('version_number, change_source, flow_data')
    .eq('campaign_id', campaignId)
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle();
  assert.equal(error, null);
  return data ?? null;
}

export async function countFlowVersions(
  harness: ClientApiDbHarness,
  campaignId: string,
): Promise<number> {
  const { count, error } = await harness.supabase
    .from('campaign_flow_versions')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaignId);
  assert.equal(error, null);
  return count ?? 0;
}

export async function countSyncedNodes(
  harness: ClientApiDbHarness,
  campaignId: string,
): Promise<number> {
  const { count, error } = await harness.supabase
    .from('nodes')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaignId)
    .is('deleted_at', null);
  assert.equal(error, null);
  return count ?? 0;
}

export async function createForeignAccountApiKey(
  harness: ClientApiDbHarness,
): Promise<{ accountId: string; apiKeySecret: string; cleanup: () => Promise<void> }> {
  const timestamp = new Date().toISOString();
  const accountId = crypto.randomUUID();
  const ownerUserId = crypto.randomUUID();
  const apiKeySecret = `f_${crypto.randomUUID().replace(/-/g, '')}`;

  const { error: userError } = await harness.supabase.from('users').insert({
    id: ownerUserId,
    external_id: ownerUserId,
    email: `foreign-${accountId.slice(0, 8)}@furnace.test`,
    name: 'Foreign API Owner',
    created_at: timestamp,
    updated_at: timestamp,
  } as never);
  assert.equal(userError, null);

  const { error: accountError } = await harness.supabase.from('accounts').insert({
    id: accountId,
    name: `Foreign Account ${accountId.slice(0, 8)}`,
    created_at: timestamp,
    updated_at: timestamp,
  } as never);
  assert.equal(accountError, null);

  const { error: membershipError } = await harness.supabase.from('account_users').insert({
    id: crypto.randomUUID(),
    account_id: accountId,
    user_id: ownerUserId,
    is_owner: true,
    role: 'owner',
    created_at: timestamp,
    updated_at: timestamp,
  } as never);
  assert.equal(membershipError, null);

  const { error: keyError } = await harness.supabase.from('account_api_keys').insert({
    account_id: accountId,
    created_by_user_id: ownerUserId,
    name: `foreign-${accountId.slice(0, 8)}`,
    key_hash: hashApiKey(apiKeySecret),
    secret_prefix: apiKeySecret.slice(0, 8),
    expires_at: null,
    revoked_at: null,
  } as never);
  assert.equal(keyError, null);

  return {
    accountId,
    apiKeySecret,
    cleanup: async () => {
      await harness.supabase.from('account_api_keys').delete().eq('account_id', accountId);
      await harness.supabase.from('account_users').delete().eq('account_id', accountId);
      await harness.supabase.from('accounts').delete().eq('id', accountId);
      await harness.supabase.from('users').delete().eq('id', ownerUserId);
    },
  };
}

export async function launchDraftCampaign(
  harness: ClientApiDbHarness,
  campaignId: string,
  apiKey: string,
  lead: {
    email: string;
    first_name?: string;
    last_name?: string;
    custom_lead_data?: Record<string, unknown>;
  },
): Promise<void> {
  const leadCreate = await harness.request(`/v1/campaigns/${campaignId}/leads`, {
    method: 'POST',
    apiKey,
    body: lead,
  });
  assert.equal(leadCreate.status, 201);

  const launched = await harness.request(`/v1/campaigns/${campaignId}/launch`, {
    method: 'POST',
    apiKey,
    body: {},
  });
  assert.equal(launched.status, 200);
  const launchedBody = await launched.json() as { data: { status: string } };
  assert.equal(launchedBody.data.status, 'running');
}
