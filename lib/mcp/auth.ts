import { createHmac, timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { hashApiKey, isApiKeyExpired } from '../client-api/auth.js';
import {
  isMcpUserToken,
  resolveUserSession,
  type McpUserSession,
} from './session.js';

export type McpAuthSuccess = {
  ok: true;
  /** Authorization header value to forward to Client API. */
  authorizationHeader: string;
  accountId?: string;
  authKind: 'api_key' | 'oauth' | 'user';
  userId?: string;
  allowedAccountIds?: string[];
  session?: McpUserSession;
};

export type McpAuthFailure = {
  ok: false;
  message: string;
};

export type McpAuthResult = McpAuthSuccess | McpAuthFailure;

export function getBearerToken(header: string | undefined | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || null;
}

function getSigningSecret(): string {
  return (
    process.env.MCP_OAUTH_SIGNING_SECRET?.trim() ||
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    'dev-mcp-signing-secret'
  );
}

function getServiceClient() {
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const supabaseKey = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!supabaseUrl || !supabaseKey) return null;
  return createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** @deprecated Legacy HMAC tokens; prefer opaque mcpu_ user sessions. */
export function signMcpAccessToken(payload: {
  accountId: string;
  apiKey: string;
  exp: number;
}): string {
  const body = Buffer.from(
    JSON.stringify({
      account_id: payload.accountId,
      api_key: payload.apiKey,
      exp: payload.exp,
    }),
    'utf8',
  ).toString('base64url');
  const sig = createHmac('sha256', getSigningSecret()).update(body).digest('base64url');
  return `mcp_${body}.${sig}`;
}

/** @deprecated Legacy HMAC tokens. */
export function verifyMcpAccessToken(
  token: string,
): { accountId: string; apiKey: string } | null {
  if (!token.startsWith('mcp_') || token.startsWith('mcpu_')) return null;
  const raw = token.slice(4);
  const [body, sig] = raw.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', getSigningSecret()).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as {
      account_id?: string;
      api_key?: string;
      exp?: number;
    };
    if (!parsed.account_id || !parsed.api_key || !parsed.exp) return null;
    if (Date.now() / 1000 > parsed.exp) return null;
    return { accountId: parsed.account_id, apiKey: parsed.api_key };
  } catch {
    return null;
  }
}

async function validateFurnaceApiKey(token: string): Promise<McpAuthResult> {
  const supabase = getServiceClient();
  if (!supabase) {
    return {
      ok: false,
      message: 'Unauthorized: API key validation unavailable (missing SUPABASE_URL/SECRET)',
    };
  }

  const keyHash = hashApiKey(token);
  const { data, error } = await supabase
    .from('account_api_keys')
    .select('id, account_id, expires_at, revoked_at')
    .eq('key_hash', keyHash)
    .maybeSingle();

  if (error) {
    return { ok: false, message: 'Unauthorized: failed to validate API key' };
  }
  if (!data) {
    return { ok: false, message: 'Unauthorized: API key not recognized' };
  }
  if (data.revoked_at) {
    return { ok: false, message: 'Unauthorized: API key has been revoked' };
  }
  if (isApiKeyExpired(data.expires_at)) {
    return { ok: false, message: 'Unauthorized: API key has expired' };
  }

  return {
    ok: true,
    authorizationHeader: `Bearer ${token}`,
    accountId: data.account_id,
    authKind: 'api_key',
  };
}

/**
 * Resolve Authorization for MCP requests.
 * - `Bearer f_…` → account API key
 * - `Bearer mcpu_…` → user-scoped session (forwarded as-is to Client API)
 * - legacy `Bearer mcp_…` HMAC → deprecated account-pinned path
 */
export async function resolveMcpAuthorization(
  header: string | undefined | null,
): Promise<McpAuthResult> {
  const token = getBearerToken(header);
  if (!token) {
    return { ok: false, message: 'Unauthorized: Bearer token required' };
  }

  if (token.startsWith('f_')) {
    return validateFurnaceApiKey(token);
  }

  if (isMcpUserToken(token)) {
    const session = await resolveUserSession(token);
    if (!session) {
      return {
        ok: false,
        message: 'Unauthorized: invalid, expired, or revoked MCP user session',
      };
    }
    return {
      ok: true,
      authorizationHeader: `Bearer ${token}`,
      authKind: 'user',
      userId: session.userId,
      allowedAccountIds: session.allowedAccountIds,
      session,
    };
  }

  // Legacy HMAC mcp_ tokens (deprecated; dogfood reconnects once).
  const verified = verifyMcpAccessToken(token);
  if (verified) {
    const keyCheck = await validateFurnaceApiKey(verified.apiKey);
    if (!keyCheck.ok) return keyCheck;
    return {
      ok: true,
      authorizationHeader: `Bearer ${verified.apiKey}`,
      accountId: verified.accountId,
      authKind: 'oauth',
    };
  }

  return {
    ok: false,
    message: 'Unauthorized: invalid or expired token',
  };
}

export function hashToken(token: string): string {
  return createHmac('sha256', getSigningSecret()).update(token).digest('hex');
}
