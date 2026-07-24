import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { app } from '../../../amplify/functions/clientApi/app.js';
import { hashApiKey } from '../../client-api/auth.js';
import { hashToken } from '../../mcp/auth.js';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  MCP_SCOPE,
  MCP_USER_TOKEN_PREFIX,
  REFRESH_TOKEN_TTL_SECONDS,
} from '../../mcp/session.js';
import {
  CampaignDbHarness,
  loadCampaignHarnessEnv,
  type CampaignHarnessEnv,
} from '../campaign/harness.js';

type CreatedApiKey = {
  id: string;
  secret: string;
  name: string;
};

type RequestOptions = {
  apiKey?: string;
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
};

async function deleteRowsByIds(
  supabase: CampaignDbHarness['supabase'],
  table: string,
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase.from(table as any).delete().in('id', ids);
  if (error) {
    throw new Error(`client api harness: failed to delete ${table}: ${error.message}`);
  }
}

export function createClientApiTestNamespace(label: string): string {
  return `client-api-${label}-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 6)}`;
}

export class ClientApiDbHarness {
  readonly namespace: string;
  readonly env: CampaignHarnessEnv;
  readonly campaignHarness: CampaignDbHarness;
  readonly supabase: CampaignDbHarness['supabase'];
  readonly startedAt = new Date().toISOString();
  readonly createdApiKeys: CreatedApiKey[] = [];
  readonly trackedIdempotencyIds = new Set<string>();
  readonly trackedRateLimitIds = new Set<string>();
  readonly trackedWebhookEventIds = new Set<string>();
  readonly trackedWebhookDeliveryIds = new Set<string>();
  readonly trackedImportJobIds = new Set<string>();
  readonly trackedMemberUserIds = new Set<string>();
  readonly trackedSecondAccountIds = new Set<string>();
  readonly trackedMcpSessionIds = new Set<string>();
  readonly trackedMcpClientIds = new Set<string>();
  readonly trackedMcpAuthCodeHashes = new Set<string>();

  private ownerAccessToken: string | null = null;
  private memberAccessTokens = new Map<string, string>();

  constructor(params: { namespace: string; env?: CampaignHarnessEnv }) {
    this.namespace = params.namespace;
    this.env = params.env ?? loadCampaignHarnessEnv();
    this.campaignHarness = new CampaignDbHarness({
      namespace: params.namespace,
      env: this.env,
    });
    this.supabase = this.campaignHarness.supabase;
    process.env.SUPABASE_URL = this.env.supabaseUrl;
    process.env.EXPO_PUBLIC_SUPABASE_URL = this.env.supabaseUrl;
    process.env.SUPABASE_SECRET_KEY = this.env.serviceRoleKey;
    delete process.env.CLIENT_API_IMPORT_QUEUE_URL;
    delete process.env.CLIENT_API_WEBHOOK_QUEUE_URL;
  }

  get accountId(): string {
    return this.env.accountId;
  }

  get ownerUserId(): string {
    return this.env.ownerUserId;
  }

  ownerEmail(): string {
    return `campaign-test-${this.ownerUserId.slice(0, 8)}@furnace.test`;
  }

  ownerPassword(): string {
    return `CampaignTest!${this.ownerUserId.slice(0, 8)}`;
  }

  async ensureOwnerAuthUser(): Promise<void> {
    await this.campaignHarness.createCampaignGraph({
      name: 'Client API Auth Seed',
      status: 'draft',
      flowKind: 'emailOnly',
      leads: [],
    });

    const email = this.ownerEmail();
    const password = this.ownerPassword();
    const { data: existing } = await this.supabase.auth.admin.getUserById(this.ownerUserId);
    if (!existing.user) {
      const { error } = await this.supabase.auth.admin.createUser({
        id: this.ownerUserId,
        email,
        email_confirm: true,
        password,
      });
      if (error) {
        throw new Error(`client api harness: failed to create owner auth user: ${error.message}`);
      }
    }
  }

  async getOwnerAccessToken(): Promise<string> {
    if (this.ownerAccessToken) {
      return this.ownerAccessToken;
    }
    await this.ensureOwnerAuthUser();
    const publishableKey =
      process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
      process.env.SUPABASE_ANON_KEY?.trim();
    if (!publishableKey) {
      throw new Error(
        'client api harness: EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY is required for internal route tests',
      );
    }
    const anon = createClient(this.env.supabaseUrl, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await anon.auth.signInWithPassword({
      email: this.ownerEmail(),
      password: this.ownerPassword(),
    });
    if (error || !data.session?.access_token) {
      throw new Error(
        `client api harness: failed to sign in owner: ${error?.message ?? 'missing session'}`,
      );
    }
    this.ownerAccessToken = data.session.access_token;
    return this.ownerAccessToken;
  }

  async createMemberUser(): Promise<{ userId: string; accessToken: string }> {
    await this.ensureOwnerAuthUser();
    const userId = crypto.randomUUID();
    const email = `member-${this.namespace}@furnace.test`;
    const password = `MemberTest!${userId.slice(0, 8)}`;
    const timestamp = new Date().toISOString();

    const { error: userError } = await this.supabase.from('users').insert({
      id: userId,
      external_id: userId,
      email,
      name: 'Client API Member',
      created_at: timestamp,
      updated_at: timestamp,
    } as never);
    if (userError) {
      throw new Error(`client api harness: failed to insert member user: ${userError.message}`);
    }

    const { error: membershipError } = await this.supabase.from('account_users').insert({
      id: crypto.randomUUID(),
      account_id: this.accountId,
      user_id: userId,
      is_owner: false,
      role: 'member',
      created_at: timestamp,
      updated_at: timestamp,
    } as never);
    if (membershipError) {
      throw new Error(`client api harness: failed to insert member membership: ${membershipError.message}`);
    }

    const { error: authError } = await this.supabase.auth.admin.createUser({
      id: userId,
      email,
      email_confirm: true,
      password,
    });
    if (authError) {
      throw new Error(`client api harness: failed to create member auth user: ${authError.message}`);
    }

    const publishableKey =
      process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
      process.env.SUPABASE_ANON_KEY?.trim();
    if (!publishableKey) {
      throw new Error(
        'client api harness: EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY is required for internal route tests',
      );
    }
    const anon = createClient(this.env.supabaseUrl, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await anon.auth.signInWithPassword({ email, password });
    if (error || !data.session?.access_token) {
      throw new Error(
        `client api harness: failed to sign in member: ${error?.message ?? 'missing session'}`,
      );
    }

    this.trackedMemberUserIds.add(userId);
    this.memberAccessTokens.set(userId, data.session.access_token);
    return { userId, accessToken: data.session.access_token };
  }

  /** Second account + membership for the same owner (multi-account MCP tests). */
  async createSecondAccount(name = `Second ${this.namespace}`): Promise<string> {
    await this.ensureOwnerAuthUser();
    const accountId = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    const { error: accountError } = await this.supabase.from('accounts').insert({
      id: accountId,
      name,
      created_at: timestamp,
      updated_at: timestamp,
    } as never);
    if (accountError) {
      throw new Error(`client api harness: failed to create second account: ${accountError.message}`);
    }
    const { error: membershipError } = await this.supabase.from('account_users').insert({
      id: crypto.randomUUID(),
      account_id: accountId,
      user_id: this.ownerUserId,
      is_owner: true,
      role: 'owner',
      created_at: timestamp,
      updated_at: timestamp,
    } as never);
    if (membershipError) {
      throw new Error(
        `client api harness: failed to create second membership: ${membershipError.message}`,
      );
    }
    this.trackedSecondAccountIds.add(accountId);
    return accountId;
  }

  async issueMcpSession(params: {
    userId: string;
    allowedAccountIds: string[];
    clientId?: string | null;
    scopes?: string[];
    expiresAt?: Date;
    refreshExpiresAt?: Date;
  }): Promise<{ accessToken: string; refreshToken: string; sessionId: string }> {
    const accessToken = `${MCP_USER_TOKEN_PREFIX}${crypto.randomBytes(24).toString('base64url')}`;
    const refreshToken = `${MCP_USER_TOKEN_PREFIX}${crypto.randomBytes(24).toString('base64url')}`;
    const now = Date.now();
    const expiresAt =
      params.expiresAt ?? new Date(now + ACCESS_TOKEN_TTL_SECONDS * 1000);
    const refreshExpiresAt =
      params.refreshExpiresAt ?? new Date(now + REFRESH_TOKEN_TTL_SECONDS * 1000);
    const { data, error } = await this.supabase
      .from('mcp_oauth_sessions')
      .insert({
        user_id: params.userId,
        client_id: params.clientId ?? `test-client-${this.namespace}`,
        allowed_account_ids: params.allowedAccountIds,
        scopes: params.scopes ?? [MCP_SCOPE],
        token_hash: hashToken(accessToken),
        refresh_token_hash: hashToken(refreshToken),
        expires_at: expiresAt.toISOString(),
        refresh_expires_at: refreshExpiresAt.toISOString(),
      } as never)
      .select('id')
      .single();
    if (error || !data) {
      throw new Error(`client api harness: failed to issue MCP session: ${error?.message}`);
    }
    this.trackedMcpSessionIds.add(data.id);
    return { accessToken, refreshToken, sessionId: data.id };
  }

  async registerMcpClient(redirectUri: string): Promise<string> {
    const clientId = `mcp_client_${crypto.randomBytes(8).toString('hex')}`;
    const { error } = await this.supabase.from('mcp_oauth_clients').upsert({
      client_id: clientId,
      client_secret_hash: null,
      redirect_uris: [redirectUri],
      client_name: `test-${this.namespace}`,
    } as never);
    if (error) {
      throw new Error(`client api harness: failed to register MCP client: ${error.message}`);
    }
    this.trackedMcpClientIds.add(clientId);
    return clientId;
  }

  async requestAsOwner(
    path: string,
    options: Omit<RequestOptions, 'apiKey'> = {},
  ): Promise<Response> {
    const token = await this.getOwnerAccessToken();
    return this.request(path, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${token}`,
      },
    });
  }

  async requestAsUser(
    path: string,
    options: RequestOptions & { token: string; accountId?: string },
  ): Promise<Response> {
    const headers: Record<string, string> = {
      ...options.headers,
      Authorization: `Bearer ${options.token}`,
    };
    if (options.accountId) {
      headers['X-Furnace-Account-Id'] = options.accountId;
    }
    return this.request(path, {
      ...options,
      apiKey: undefined,
      headers,
    });
  }

  async createApiKey(name = `key-${this.namespace}`): Promise<CreatedApiKey> {
    const secret = `f_${crypto.randomUUID().replace(/-/g, '')}`;
    const { data, error } = await this.supabase
      .from('account_api_keys')
      .insert({
        account_id: this.accountId,
        created_by_user_id: this.ownerUserId,
        name,
        key_hash: hashApiKey(secret),
        secret_prefix: secret.slice(0, 8),
        expires_at: null,
        revoked_at: null,
      } as never)
      .select('id')
      .single();
    if (error) {
      throw new Error(`client api harness: failed to create api key: ${error.message}`);
    }
    const created = { id: data.id, secret, name };
    this.createdApiKeys.push(created);
    return created;
  }

  async request(path: string, options: RequestOptions = {}): Promise<Response> {
    const headers = new Headers(options.headers);
    if (options.apiKey) {
      headers.set('Authorization', `Bearer ${options.apiKey}`);
    }
    let body: BodyInit | undefined;
    if (options.body !== undefined) {
      headers.set('Content-Type', 'application/json');
      body = JSON.stringify(options.body);
    }
    const response = await app.fetch(
      new Request(`https://client-api.test${path}`, {
        method: options.method ?? 'GET',
        headers,
        body,
      })
    );
    await this.trackSideEffects();
    return response;
  }

  async trackSideEffects(): Promise<void> {
    await Promise.all([
      this.trackTableIds('api_idempotency_keys', this.trackedIdempotencyIds),
      this.trackTableIds('api_rate_limit_buckets', this.trackedRateLimitIds),
      this.trackTableIds('webhook_events', this.trackedWebhookEventIds),
      this.trackTableIds('webhook_deliveries', this.trackedWebhookDeliveryIds),
      this.trackTableIds('api_import_jobs', this.trackedImportJobIds),
    ]);
  }

  private async trackTableIds(table: string, target: Set<string>): Promise<void> {
    const { data, error } = await this.supabase
      .from(table as any)
      .select('id')
      .eq('account_id', this.accountId)
      .gte('created_at', this.startedAt);
    if (error) {
      throw new Error(`client api harness: failed to track ${table}: ${error.message}`);
    }
    for (const row of data ?? []) {
      if (typeof row.id === 'string') {
        target.add(row.id);
      }
    }
  }

  async cleanup(): Promise<void> {
    for (const userId of this.trackedMemberUserIds) {
      await this.supabase.from('account_users').delete().eq('user_id', userId);
      await this.supabase.from('users').delete().eq('id', userId);
      await this.supabase.auth.admin.deleteUser(userId);
    }
    this.trackedMemberUserIds.clear();
    this.memberAccessTokens.clear();
    this.ownerAccessToken = null;

    await deleteRowsByIds(this.supabase, 'mcp_oauth_sessions', [...this.trackedMcpSessionIds]);
    this.trackedMcpSessionIds.clear();

    if (this.trackedMcpClientIds.size > 0) {
      await this.supabase
        .from('mcp_oauth_clients')
        .delete()
        .in('client_id', [...this.trackedMcpClientIds]);
      this.trackedMcpClientIds.clear();
    }

    if (this.trackedMcpAuthCodeHashes.size > 0) {
      await this.supabase
        .from('mcp_oauth_auth_codes')
        .delete()
        .in('code_hash', [...this.trackedMcpAuthCodeHashes]);
      this.trackedMcpAuthCodeHashes.clear();
    }

    for (const accountId of this.trackedSecondAccountIds) {
      await this.supabase.from('account_users').delete().eq('account_id', accountId);
      await this.supabase.from('accounts').delete().eq('id', accountId);
    }
    this.trackedSecondAccountIds.clear();

    await deleteRowsByIds(this.supabase, 'webhook_deliveries', [...this.trackedWebhookDeliveryIds]);
    await deleteRowsByIds(this.supabase, 'webhook_events', [...this.trackedWebhookEventIds]);
    await deleteRowsByIds(this.supabase, 'api_import_jobs', [...this.trackedImportJobIds]);
    await deleteRowsByIds(this.supabase, 'api_idempotency_keys', [...this.trackedIdempotencyIds]);
    await deleteRowsByIds(this.supabase, 'api_rate_limit_buckets', [...this.trackedRateLimitIds]);
    await deleteRowsByIds(
      this.supabase,
      'account_api_keys',
      this.createdApiKeys.map((apiKey) => apiKey.id),
    );
    await this.campaignHarness.cleanup();
  }
}
