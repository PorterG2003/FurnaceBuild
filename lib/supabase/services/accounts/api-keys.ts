import { supabase } from '../../client';
import type { AccountApiKey, Account } from '../../types';

export interface AccountApiKeyWithSecret extends Omit<AccountApiKey, 'key_hash'> {
  secret: string;
}

type RpcAccountApiKeyRow = Omit<AccountApiKey, 'key_hash'> & {
  secret?: string;
};

function mapRpcRow(row: RpcAccountApiKeyRow): AccountApiKeyWithSecret | AccountApiKey {
  if (typeof row.secret === 'string') {
    return {
      id: row.id,
      account_id: row.account_id,
      created_by_user_id: row.created_by_user_id,
      name: row.name,
      secret_prefix: row.secret_prefix,
      expires_at: row.expires_at,
      last_used_at: row.last_used_at,
      revoked_at: row.revoked_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
      secret: row.secret,
    };
  }
  return {
    id: row.id,
    account_id: row.account_id,
    created_by_user_id: row.created_by_user_id,
    name: row.name,
    secret_prefix: row.secret_prefix,
    expires_at: row.expires_at,
    last_used_at: row.last_used_at,
    revoked_at: row.revoked_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    key_hash: '',
  };
}

export async function listAccountApiKeys(accountId: string): Promise<AccountApiKey[]> {
  const { data, error } = await supabase.rpc('list_account_api_keys', {
    p_account_id: accountId,
  });
  if (error) {
    throw new Error(`Failed to list API keys: ${error.message}`);
  }
  return ((data ?? []) as RpcAccountApiKeyRow[]).map((row) => mapRpcRow(row) as AccountApiKey);
}

export async function createAccountApiKey(params: {
  accountId: string;
  name: string;
  expiresAt?: string | null;
}): Promise<AccountApiKeyWithSecret> {
  const { data, error } = await supabase.rpc('create_account_api_key', {
    p_account_id: params.accountId,
    p_name: params.name,
    p_expires_at: params.expiresAt ?? null,
  });
  if (error) {
    throw new Error(`Failed to create API key: ${error.message}`);
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.id || typeof row.secret !== 'string') {
    throw new Error('Failed to create API key: missing secret');
  }
  return mapRpcRow(row as RpcAccountApiKeyRow) as AccountApiKeyWithSecret;
}

export async function renameAccountApiKey(params: {
  accountId: string;
  keyId: string;
  name: string;
}): Promise<AccountApiKey> {
  const { data, error } = await supabase.rpc('rename_account_api_key', {
    p_account_id: params.accountId,
    p_key_id: params.keyId,
    p_name: params.name,
  });
  if (error) {
    throw new Error(`Failed to rename API key: ${error.message}`);
  }
  if (!data?.id) {
    throw new Error('Failed to rename API key: no row returned');
  }
  return {
    ...(data as RpcAccountApiKeyRow),
    key_hash: '',
  } as AccountApiKey;
}

export async function revokeAccountApiKey(params: {
  accountId: string;
  keyId: string;
}): Promise<AccountApiKey> {
  const { data, error } = await supabase.rpc('revoke_account_api_key', {
    p_account_id: params.accountId,
    p_key_id: params.keyId,
  });
  if (error) {
    throw new Error(`Failed to revoke API key: ${error.message}`);
  }
  if (!data?.id) {
    throw new Error('Failed to revoke API key: no row returned');
  }
  return {
    ...(data as RpcAccountApiKeyRow),
    key_hash: '',
  } as AccountApiKey;
}

export async function updateAccountWebhookSettings(
  accountId: string,
  updates: Pick<
    Account,
    'webhook_url' | 'webhook_signing_secret' | 'webhook_enabled_events' | 'webhook_url_verified_at'
  >
): Promise<Account> {
  const { data, error } = await supabase
    .from('accounts')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', accountId)
    .select()
    .single();
  if (error) {
    throw new Error(`Failed to update account webhook settings: ${error.message}`);
  }
  return data as Account;
}
