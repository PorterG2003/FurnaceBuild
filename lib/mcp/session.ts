import { randomBytes } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { hashToken } from './auth.js';

export const MCP_USER_TOKEN_PREFIX = 'mcpu_';
export const MCP_SCOPE = 'furnace.mcp';

/** Access token TTL (1 hour). Clients refresh via grant_type=refresh_token. */
export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
/** Refresh token absolute max age (30 days). */
export const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;

export type McpUserSession = {
  id: string;
  userId: string;
  clientId: string | null;
  allowedAccountIds: string[];
  scopes: string[];
  expiresAt: string | null;
  refreshExpiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
};

export type IssuedUserSession = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scope: string;
  session: McpUserSession;
};

type MemorySessionRow = {
  id: string;
  user_id: string;
  client_id: string | null;
  allowed_account_ids: string[];
  scopes: string[];
  token_hash: string;
  refresh_token_hash: string | null;
  expires_at: string | null;
  refresh_expires_at: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
  created_at: string;
};

/** In-memory fallback when Supabase is unavailable (unit tests / local). */
const memorySessions = new Map<string, MemorySessionRow>();

export function __resetMcpSessionsMemoryForTests(): void {
  memorySessions.clear();
}

function getServiceClient(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function mintRawToken(): string {
  return `${MCP_USER_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
}

function mintSessionId(): string {
  return randomBytes(16).toString('hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
}

function mapSessionRow(row: {
  id: string;
  user_id: string;
  client_id: string | null;
  allowed_account_ids: string[] | null;
  scopes: string[] | null;
  expires_at: string | null;
  refresh_expires_at: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
  created_at: string;
}): McpUserSession {
  return {
    id: row.id,
    userId: row.user_id,
    clientId: row.client_id,
    allowedAccountIds: Array.isArray(row.allowed_account_ids) ? row.allowed_account_ids : [],
    scopes: Array.isArray(row.scopes) && row.scopes.length > 0 ? row.scopes : [MCP_SCOPE],
    expiresAt: row.expires_at,
    refreshExpiresAt: row.refresh_expires_at,
    revokedAt: row.revoked_at,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
  };
}

function isExpired(iso: string | null | undefined): boolean {
  if (!iso) return false;
  return Date.parse(iso) <= Date.now();
}

export function isMcpUserToken(token: string): boolean {
  return token.startsWith(MCP_USER_TOKEN_PREFIX);
}

export type IssueUserSessionInput = {
  userId: string;
  clientId?: string | null;
  allowedAccountIds: string[];
  scopes?: string[];
  /** Override access expiry (tests). */
  expiresAt?: Date;
  /** Override refresh expiry (tests). */
  refreshExpiresAt?: Date;
  supabase?: SupabaseClient | null;
};

/**
 * Issue an opaque DB-backed user session (access + refresh). Tokens are `mcpu_…`;
 * only hashes are stored.
 */
export async function issueUserSession(
  input: IssueUserSessionInput,
): Promise<IssuedUserSession> {
  const supabase = input.supabase === undefined ? getServiceClient() : input.supabase;
  if (!input.userId) throw new Error('userId is required');
  if (!Array.isArray(input.allowedAccountIds) || input.allowedAccountIds.length === 0) {
    throw new Error('allowedAccountIds must be a non-empty array');
  }

  const accessToken = mintRawToken();
  const refreshToken = mintRawToken();
  const now = Date.now();
  const expiresAt =
    input.expiresAt ?? new Date(now + ACCESS_TOKEN_TTL_SECONDS * 1000);
  const refreshExpiresAt =
    input.refreshExpiresAt ?? new Date(now + REFRESH_TOKEN_TTL_SECONDS * 1000);
  const scopes = input.scopes?.length ? input.scopes : [MCP_SCOPE];
  const tokenHash = hashToken(accessToken);
  const refreshHash = hashToken(refreshToken);

  if (!supabase) {
    const row: MemorySessionRow = {
      id: mintSessionId(),
      user_id: input.userId,
      client_id: input.clientId ?? null,
      allowed_account_ids: input.allowedAccountIds,
      scopes,
      token_hash: tokenHash,
      refresh_token_hash: refreshHash,
      expires_at: expiresAt.toISOString(),
      refresh_expires_at: refreshExpiresAt.toISOString(),
      revoked_at: null,
      last_used_at: null,
      created_at: new Date(now).toISOString(),
    };
    memorySessions.set(row.id, row);
    return {
      accessToken,
      refreshToken,
      expiresIn: Math.max(1, Math.floor((expiresAt.getTime() - now) / 1000)),
      scope: scopes.join(' '),
      session: mapSessionRow(row),
    };
  }

  const { data, error } = await supabase
    .from('mcp_oauth_sessions')
    .insert({
      user_id: input.userId,
      client_id: input.clientId ?? null,
      allowed_account_ids: input.allowedAccountIds,
      scopes,
      token_hash: tokenHash,
      refresh_token_hash: refreshHash,
      expires_at: expiresAt.toISOString(),
      refresh_expires_at: refreshExpiresAt.toISOString(),
    } as never)
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(`Failed to issue MCP user session: ${error?.message ?? 'no row'}`);
  }

  const session = mapSessionRow(data as never);
  return {
    accessToken,
    refreshToken,
    expiresIn: Math.max(1, Math.floor((expiresAt.getTime() - now) / 1000)),
    scope: scopes.join(' '),
    session,
  };
}

/**
 * Resolve an access token. Returns null when missing/expired/revoked.
 * Bumps last_used_at on success.
 */
export async function resolveUserSession(
  token: string,
  options?: { supabase?: SupabaseClient | null },
): Promise<McpUserSession | null> {
  if (!isMcpUserToken(token)) return null;
  const supabase = options?.supabase === undefined ? getServiceClient() : options.supabase;
  const tokenHash = hashToken(token);

  if (!supabase) {
    for (const row of memorySessions.values()) {
      if (row.token_hash !== tokenHash) continue;
      const session = mapSessionRow(row);
      if (session.revokedAt) return null;
      if (isExpired(session.expiresAt)) return null;
      row.last_used_at = new Date().toISOString();
      return mapSessionRow(row);
    }
    return null;
  }

  const { data, error } = await supabase
    .from('mcp_oauth_sessions')
    .select('*')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (error || !data) return null;
  const session = mapSessionRow(data as never);
  if (session.revokedAt) return null;
  if (isExpired(session.expiresAt)) return null;

  void supabase
    .from('mcp_oauth_sessions')
    .update({ last_used_at: new Date().toISOString() } as never)
    .eq('id', session.id);

  return session;
}

/**
 * Atomic refresh-token rotation. Concurrent rotates of the same refresh token
 * yield at most one winner (conditional update on refresh_token_hash).
 */
export async function rotateUserSession(
  refreshToken: string,
  options?: { supabase?: SupabaseClient | null },
): Promise<IssuedUserSession | null> {
  if (!isMcpUserToken(refreshToken)) return null;
  const supabase = options?.supabase === undefined ? getServiceClient() : options.supabase;

  const accessToken = mintRawToken();
  const newRefreshToken = mintRawToken();
  const now = Date.now();
  const expiresAt = new Date(now + ACCESS_TOKEN_TTL_SECONDS * 1000);
  const refreshHash = hashToken(refreshToken);

  if (!supabase) {
    for (const row of memorySessions.values()) {
      if (row.refresh_token_hash !== refreshHash) continue;
      if (row.revoked_at) return null;
      if (isExpired(row.refresh_expires_at)) return null;
      row.token_hash = hashToken(accessToken);
      row.refresh_token_hash = hashToken(newRefreshToken);
      row.expires_at = expiresAt.toISOString();
      row.last_used_at = new Date(now).toISOString();
      const session = mapSessionRow(row);
      return {
        accessToken,
        refreshToken: newRefreshToken,
        expiresIn: ACCESS_TOKEN_TTL_SECONDS,
        scope: session.scopes.join(' '),
        session,
      };
    }
    return null;
  }

  const { data, error } = await supabase
    .from('mcp_oauth_sessions')
    .update({
      token_hash: hashToken(accessToken),
      refresh_token_hash: hashToken(newRefreshToken),
      expires_at: expiresAt.toISOString(),
      last_used_at: new Date(now).toISOString(),
    } as never)
    .eq('refresh_token_hash', refreshHash)
    .is('revoked_at', null)
    .gt('refresh_expires_at', new Date(now).toISOString())
    .select('*')
    .maybeSingle();

  if (error || !data) return null;

  const session = mapSessionRow(data as never);
  return {
    accessToken,
    refreshToken: newRefreshToken,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    scope: session.scopes.join(' '),
    session,
  };
}

export async function revokeUserSession(params: {
  accessToken?: string;
  refreshToken?: string;
  sessionId?: string;
  userId?: string;
  supabase?: SupabaseClient | null;
}): Promise<boolean> {
  const supabase = params.supabase === undefined ? getServiceClient() : params.supabase;
  const now = new Date().toISOString();

  if (!supabase) {
    let matched = false;
    for (const row of memorySessions.values()) {
      if (row.revoked_at) continue;
      const byId =
        params.sessionId &&
        row.id === params.sessionId &&
        (!params.userId || row.user_id === params.userId);
      const byAccess =
        params.accessToken && row.token_hash === hashToken(params.accessToken);
      const byRefresh =
        params.refreshToken && row.refresh_token_hash === hashToken(params.refreshToken);
      if (byId || byAccess || byRefresh) {
        row.revoked_at = now;
        matched = true;
      }
    }
    return matched;
  }

  let query = supabase
    .from('mcp_oauth_sessions')
    .update({ revoked_at: now } as never)
    .is('revoked_at', null);

  if (params.sessionId) {
    query = query.eq('id', params.sessionId);
    if (params.userId) query = query.eq('user_id', params.userId);
  } else if (params.accessToken) {
    query = query.eq('token_hash', hashToken(params.accessToken));
  } else if (params.refreshToken) {
    query = query.eq('refresh_token_hash', hashToken(params.refreshToken));
  } else {
    return false;
  }

  const { data, error } = await query.select('id');
  if (error) return false;
  return Array.isArray(data) && data.length > 0;
}

/** List safe session fields for the signed-in user (never token hashes). */
export async function listUserSessions(
  userId: string,
  options?: { supabase?: SupabaseClient | null },
): Promise<
  Array<{
    id: string;
    client_id: string | null;
    allowed_account_ids: string[];
    scopes: string[];
    created_at: string;
    last_used_at: string | null;
    expires_at: string | null;
    refresh_expires_at: string | null;
  }>
> {
  const supabase = options?.supabase === undefined ? getServiceClient() : options.supabase;

  const mapSafe = (row: {
    id: string;
    client_id: string | null;
    allowed_account_ids: string[] | null;
    scopes: string[] | null;
    created_at: string;
    last_used_at: string | null;
    expires_at: string | null;
    refresh_expires_at: string | null;
  }) => ({
    id: row.id,
    client_id: row.client_id,
    allowed_account_ids: Array.isArray(row.allowed_account_ids) ? row.allowed_account_ids : [],
    scopes: Array.isArray(row.scopes) ? row.scopes : [MCP_SCOPE],
    created_at: row.created_at,
    last_used_at: row.last_used_at,
    expires_at: row.expires_at,
    refresh_expires_at: row.refresh_expires_at,
  });

  if (!supabase) {
    return [...memorySessions.values()]
      .filter((row) => row.user_id === userId && !row.revoked_at)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map(mapSafe);
  }

  const { data, error } = await supabase
    .from('mcp_oauth_sessions')
    .select(
      'id, client_id, allowed_account_ids, scopes, created_at, last_used_at, expires_at, refresh_expires_at',
    )
    .eq('user_id', userId)
    .is('revoked_at', null)
    .order('created_at', { ascending: false });

  if (error || !data) return [];
  return (data as never[]).map((row: any) => mapSafe(row));
}
