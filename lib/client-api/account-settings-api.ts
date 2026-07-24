import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { hashApiKey } from './auth.js';
import { invalidRequest, notFound } from './errors.js';
import { isValidHttpsWebhookUrl } from './webhooks/deliverWebhookPost.js';

const MAX_ACTIVE_API_KEYS = 10;

export function generateApiKeySecret(): string {
  return `f_${crypto.randomUUID().replace(/-/g, '')}${crypto.randomUUID().replace(/-/g, '')}`;
}

export async function listApiKeysForAccount(supabase: SupabaseClient, accountId: string) {
  const { data, error } = await supabase
    .from('account_api_keys')
    .select(
      'id, account_id, name, secret_prefix, expires_at, last_used_at, revoked_at, created_at, updated_at',
    )
    .eq('account_id', accountId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Failed to list API keys: ${error.message}`);
  return data ?? [];
}

export async function createApiKeyForAccount(
  supabase: SupabaseClient,
  params: {
    accountId: string;
    name: string;
    createdByUserId: string | null;
    expiresAt?: string | null;
  },
) {
  const name = params.name.trim();
  if (!name) invalidRequest('invalid_name', 'API key name is required');

  const { count, error: countError } = await supabase
    .from('account_api_keys')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', params.accountId)
    .is('revoked_at', null);
  if (countError) throw new Error(`Failed to count API keys: ${countError.message}`);
  if ((count ?? 0) >= MAX_ACTIVE_API_KEYS) {
    invalidRequest('api_key_limit', `API key limit reached (${MAX_ACTIVE_API_KEYS} active keys max)`);
  }

  const secret = generateApiKeySecret();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const row = {
    id,
    account_id: params.accountId,
    created_by_user_id: params.createdByUserId,
    name,
    key_hash: hashApiKey(secret),
    secret_prefix: secret.slice(0, 12),
    expires_at: params.expiresAt ?? null,
    revoked_at: null,
    created_at: now,
    updated_at: now,
  };
  const { data, error } = await supabase.from('account_api_keys').insert(row as never).select(
    'id, account_id, name, secret_prefix, expires_at, last_used_at, revoked_at, created_at, updated_at',
  ).single();
  if (error) throw new Error(`Failed to create API key: ${error.message}`);
  return { ...data, secret };
}

export async function revokeApiKeyForAccount(
  supabase: SupabaseClient,
  params: { accountId: string; keyId: string },
) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('account_api_keys')
    .update({ revoked_at: now, updated_at: now } as never)
    .eq('account_id', params.accountId)
    .eq('id', params.keyId)
    .is('revoked_at', null)
    .select(
      'id, account_id, name, secret_prefix, expires_at, last_used_at, revoked_at, created_at, updated_at',
    )
    .maybeSingle();
  if (error) throw new Error(`Failed to revoke API key: ${error.message}`);
  if (!data) notFound('api_key_not_found', 'API key not found');
  return data;
}

export async function getAccountWebhookSettings(supabase: SupabaseClient, accountId: string) {
  const { data, error } = await supabase
    .from('accounts')
    .select('webhook_url, webhook_signing_secret, webhook_enabled_events')
    .eq('id', accountId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load webhook settings: ${error.message}`);
  if (!data) notFound('account_not_found', 'Account not found');
  return {
    webhook_url: data.webhook_url,
    webhook_signing_secret: data.webhook_signing_secret,
    webhook_enabled_events: data.webhook_enabled_events ?? [],
  };
}

export async function updateAccountWebhookSettingsApi(
  supabase: SupabaseClient,
  accountId: string,
  body: {
    webhook_url?: string | null;
    webhook_signing_secret?: string | null;
    webhook_enabled_events?: string[] | null;
  },
) {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if ('webhook_url' in body) {
    const url = body.webhook_url?.trim() || null;
    if (url && !isValidHttpsWebhookUrl(url)) {
      invalidRequest('invalid_webhook_url', 'Webhook URL must be a public HTTPS URL');
    }
    patch.webhook_url = url;
  }
  if ('webhook_signing_secret' in body) {
    patch.webhook_signing_secret = body.webhook_signing_secret?.trim() || null;
  }
  if ('webhook_enabled_events' in body) {
    patch.webhook_enabled_events = Array.isArray(body.webhook_enabled_events)
      ? body.webhook_enabled_events
      : [];
  }
  const { data, error } = await supabase
    .from('accounts')
    .update(patch as never)
    .eq('id', accountId)
    .select('webhook_url, webhook_signing_secret, webhook_enabled_events')
    .single();
  if (error) throw new Error(`Failed to update webhook settings: ${error.message}`);
  return {
    webhook_url: data.webhook_url,
    webhook_signing_secret: data.webhook_signing_secret,
    webhook_enabled_events: data.webhook_enabled_events ?? [],
  };
}

export async function createMailboxConnectSession(
  supabase: SupabaseClient,
  params: { accountId: string; appOrigin: string },
) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('mailbox_connect_sessions')
    .insert({
      id,
      account_id: params.accountId,
      status: 'pending',
      created_at: now,
      updated_at: now,
      expires_at: expiresAt,
    } as never)
    .select('*')
    .single();
  if (error) throw new Error(`Failed to create mailbox connect session: ${error.message}`);
  const connectUrl = `${params.appOrigin.replace(/\/$/, '')}/senders?mailbox_connect_session=${id}`;
  return {
    id: data.id,
    status: data.status,
    expires_at: data.expires_at,
    mailbox_id: data.mailbox_id,
    connect_url: connectUrl,
  };
}

export async function getMailboxConnectSession(
  supabase: SupabaseClient,
  params: { accountId: string; sessionId: string; appOrigin: string },
) {
  const { data, error } = await supabase
    .from('mailbox_connect_sessions')
    .select('*')
    .eq('account_id', params.accountId)
    .eq('id', params.sessionId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load mailbox connect session: ${error.message}`);
  if (!data) notFound('connect_session_not_found', 'Mailbox connect session not found');
  return {
    id: data.id,
    status: data.status,
    expires_at: data.expires_at,
    mailbox_id: data.mailbox_id,
    connect_url: `${params.appOrigin.replace(/\/$/, '')}/senders?mailbox_connect_session=${data.id}`,
    error_message: data.error_message,
  };
}
