import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type ListAccountItem = {
  id: string;
  name: string;
  role: string;
  is_owner: boolean;
  billing_status: string | null;
  is_default: boolean;
};

export type GetAccountDetail = ListAccountItem & {
  plan_tier: string | null;
  member_count: number;
  campaign_count?: number;
  mailbox_count?: number;
};

function getServiceClient(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function planTierFromSnapshot(snapshot: unknown): string | null {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const tier = (snapshot as Record<string, unknown>).plan_tier;
  return typeof tier === 'string' ? tier : null;
}

/**
 * Lightweight account list for models. Intersects session grant with live
 * account_users for the session user_id (service client; must filter by both).
 */
export async function listAccountsForSession(params: {
  userId: string;
  allowedAccountIds: string[];
  supabase?: SupabaseClient | null;
}): Promise<ListAccountItem[]> {
  const supabase = params.supabase === undefined ? getServiceClient() : params.supabase;
  if (!supabase) return [];

  const granted = [...new Set(params.allowedAccountIds.filter(Boolean))];
  if (granted.length === 0) return [];

  const { data: memberships, error } = await supabase
    .from('account_users')
    .select('account_id, role, is_owner, accounts(id, name)')
    .eq('user_id', params.userId)
    .in('account_id', granted);

  if (error || !memberships) return [];

  const memberAccountIds = (memberships as any[])
    .map((row) => row.account_id as string)
    .filter((id) => granted.includes(id));

  const billingByAccount = new Map<string, string | null>();
  if (memberAccountIds.length > 0) {
    const { data: billingRows } = await supabase
      .from('account_billing')
      .select('account_id, billing_status')
      .in('account_id', memberAccountIds);
    for (const row of billingRows ?? []) {
      billingByAccount.set(
        (row as any).account_id,
        ((row as any).billing_status as string | undefined) ?? null,
      );
    }
  }

  const isDefault = granted.length === 1;
  const items: ListAccountItem[] = [];

  for (const row of memberships as any[]) {
    const accountId = row.account_id as string;
    if (!granted.includes(accountId)) continue;
    const account = Array.isArray(row.accounts) ? row.accounts[0] : row.accounts;
    items.push({
      id: accountId,
      name: (account?.name as string | undefined)?.trim() || 'Untitled workspace',
      role: (row.role as string) || 'member',
      is_owner: Boolean(row.is_owner),
      billing_status: billingByAccount.get(accountId) ?? null,
      is_default: isDefault,
    });
  }

  return items;
}

/**
 * Fuller detail for one granted+member account. Rejects ungranted/removed.
 */
export async function getAccountForSession(params: {
  userId: string;
  allowedAccountIds: string[];
  accountId: string;
  supabase?: SupabaseClient | null;
}): Promise<{ ok: true; account: GetAccountDetail } | { ok: false; message: string }> {
  const supabase = params.supabase === undefined ? getServiceClient() : params.supabase;
  if (!supabase) {
    return { ok: false, message: 'Account lookup unavailable' };
  }

  const granted = [...new Set(params.allowedAccountIds.filter(Boolean))];
  if (!granted.includes(params.accountId)) {
    return {
      ok: false,
      message: `account_id ${params.accountId} is not in this session's grant.`,
    };
  }

  const { data: membership, error } = await supabase
    .from('account_users')
    .select('account_id, role, is_owner, accounts(id, name)')
    .eq('user_id', params.userId)
    .eq('account_id', params.accountId)
    .maybeSingle();

  if (error) {
    return { ok: false, message: `Failed to load account: ${error.message}` };
  }
  if (!membership) {
    return {
      ok: false,
      message: `You are no longer a member of account ${params.accountId}.`,
    };
  }

  const row = membership as any;
  const account = Array.isArray(row.accounts) ? row.accounts[0] : row.accounts;

  const { data: billing } = await supabase
    .from('account_billing')
    .select('billing_status, proposal_snapshot_json')
    .eq('account_id', params.accountId)
    .maybeSingle();

  const [{ count: memberCount }, { count: campaignCount }, { count: mailboxCount }] =
    await Promise.all([
      supabase
        .from('account_users')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', params.accountId),
      supabase
        .from('campaigns')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', params.accountId),
      supabase
        .from('mailboxes')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', params.accountId),
    ]);

  return {
    ok: true,
    account: {
      id: params.accountId,
      name: (account?.name as string | undefined)?.trim() || 'Untitled workspace',
      role: (row.role as string) || 'member',
      is_owner: Boolean(row.is_owner),
      billing_status: ((billing as any)?.billing_status as string | undefined) ?? null,
      is_default: granted.length === 1,
      plan_tier: planTierFromSnapshot((billing as any)?.proposal_snapshot_json),
      member_count: memberCount ?? 0,
      campaign_count: campaignCount ?? 0,
      mailbox_count: mailboxCount ?? 0,
    },
  };
}

export const LIST_ACCOUNTS_TOOL = {
  name: 'listAccounts',
  description:
    'List Furnace workspaces granted to this MCP session that you are still a member of. Call this before writes when multiple accounts may be granted, then pass account_id on subsequent tools.',
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
} as const;

export const GET_ACCOUNT_TOOL = {
  name: 'getAccount',
  description:
    'Get details for one granted Furnace workspace (name, role, billing/plan, member and resource counts). Confirm the workspace before destructive or write operations.',
  inputSchema: {
    type: 'object',
    properties: {
      account_id: {
        type: 'string',
        format: 'uuid',
        description: 'Workspace (account) id from listAccounts.',
      },
    },
    required: ['account_id'],
    additionalProperties: false,
  },
} as const;

export const SYNTHETIC_MCP_TOOL_NAMES = [LIST_ACCOUNTS_TOOL.name, GET_ACCOUNT_TOOL.name] as const;
