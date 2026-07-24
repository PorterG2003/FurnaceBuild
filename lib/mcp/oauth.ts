import { createHash, randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { hashToken } from './auth.js';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  issueUserSession,
  MCP_SCOPE,
  revokeUserSession,
  rotateUserSession,
} from './session.js';

/** Loose Hono context — avoids root vs Lambda hono version Context mismatches. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OAuthHonoContext = any;

export function buildProtectedResourceMetadata(mcpBaseUrl: string) {
  const base = mcpBaseUrl.replace(/\/$/, '');
  return {
    resource: base,
    authorization_servers: [base],
    scopes_supported: [MCP_SCOPE],
    bearer_methods_supported: ['header'],
    resource_documentation: `${base}/health`,
  };
}

export function oauthAuthorizationServerMetadata(mcpBaseUrl: string) {
  const base = mcpBaseUrl.replace(/\/$/, '');
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    revocation_endpoint: `${base}/oauth/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [MCP_SCOPE],
  };
}

type MemoryClient = {
  client_id: string;
  redirect_uris: string[];
  client_name?: string;
};

type MemoryAuthCode = {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  userId: string;
  allowedAccountIds: string[];
  expiresAt: number;
  consumed?: boolean;
};

/** In-memory fallback when Supabase is unavailable (local/unit). */
const memoryClients = new Map<string, MemoryClient>();
const memoryAuthCodes = new Map<string, MemoryAuthCode>();

/** Test/helper: clear in-memory OAuth state. */
export function __resetMcpOAuthMemoryForTests(): void {
  memoryClients.clear();
  memoryAuthCodes.clear();
}

/** Test/helper: inspect memory auth code (does not consume). */
export function __peekMemoryAuthCodeForTests(code: string): MemoryAuthCode | undefined {
  return memoryAuthCodes.get(code);
}

function getServiceClient() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function getAppOrigin(): string {
  const raw = (
    process.env.MCP_APP_ORIGIN?.trim() ||
    process.env.EXPO_PUBLIC_APP_ORIGIN?.trim() ||
    'https://build.getfurnace.io'
  ).replace(/\/$/, '');
  if (/^localhost(?::\d+)?$/i.test(raw) || /^127\.\d+\.\d+\.\d+(?::\d+)?$/.test(raw)) {
    return `http://${raw}`;
  }
  if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    return `https://${raw}`;
  }
  return raw;
}

function getPublicMcpBaseUrl(requestUrl: string): string {
  const fromEnv =
    process.env.MCP_BASE_URL?.trim() ||
    (process.env.MCP_DOMAIN_NAME?.trim()
      ? `https://${process.env.MCP_DOMAIN_NAME.trim().replace(/^https?:\/\//, '')}`
      : '');
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  try {
    const origin = new URL(requestUrl).origin;
    if (!/mcp\.internal/i.test(origin)) return origin;
  } catch {
    // fall through
  }
  return 'https://mcp.getfurnace.io';
}

async function loadRegisteredClient(
  clientId: string,
): Promise<MemoryClient | null> {
  const fromMemory = memoryClients.get(clientId);
  if (fromMemory) return fromMemory;

  const supabase = getServiceClient();
  if (!supabase) return null;
  const { data } = await supabase
    .from('mcp_oauth_clients')
    .select('client_id, redirect_uris, client_name')
    .eq('client_id', clientId)
    .maybeSingle();
  if (!data) return null;

  const redirectUris = Array.isArray(data.redirect_uris)
    ? (data.redirect_uris as string[])
    : typeof data.redirect_uris === 'string'
      ? (() => {
          try {
            const parsed = JSON.parse(data.redirect_uris);
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return [];
          }
        })()
      : [];

  const client: MemoryClient = {
    client_id: data.client_id,
    redirect_uris: redirectUris.map(String),
    client_name: data.client_name ?? undefined,
  };
  memoryClients.set(clientId, client);
  return client;
}

/**
 * Enforce redirect_uri in registered redirect_uris (exact match).
 * Unknown client or unmatched redirect -> invalid_request (caller must not redirect).
 */
export async function assertRegisteredRedirect(
  clientId: string,
  redirectUri: string,
): Promise<{ ok: true; client: MemoryClient } | { ok: false; error: string; description: string }> {
  if (!clientId || !redirectUri) {
    return {
      ok: false,
      error: 'invalid_request',
      description: 'client_id and redirect_uri are required',
    };
  }
  const client = await loadRegisteredClient(clientId);
  if (!client) {
    return {
      ok: false,
      error: 'invalid_request',
      description: 'Unknown client_id',
    };
  }
  if (!client.redirect_uris.includes(redirectUri)) {
    return {
      ok: false,
      error: 'invalid_request',
      description: 'redirect_uri is not registered for this client',
    };
  }
  return { ok: true, client };
}

export async function handleAuthorize(c: OAuthHonoContext) {
  const url = new URL(c.req.url);
  const clientId = url.searchParams.get('client_id') || '';
  const redirectUri = url.searchParams.get('redirect_uri') || '';
  const state = url.searchParams.get('state') || '';
  const codeChallenge = url.searchParams.get('code_challenge') || '';
  const codeChallengeMethod = url.searchParams.get('code_challenge_method') || 'S256';
  const responseType = url.searchParams.get('response_type') || 'code';

  if (responseType !== 'code') {
    return c.json({ error: 'unsupported_response_type' }, 400);
  }
  if (!clientId || !redirectUri || !codeChallenge) {
    return c.json({ error: 'invalid_request', error_description: 'Missing required params' }, 400);
  }
  if (codeChallengeMethod !== 'S256') {
    return c.json({ error: 'invalid_request', error_description: 'Only S256 PKCE is supported' }, 400);
  }

  const registered = await assertRegisteredRedirect(clientId, redirectUri);
  if (!registered.ok) {
    return c.json(
      { error: registered.error, error_description: registered.description },
      400,
    );
  }

  const consent = new URL(`${getAppOrigin()}/mcp/oauth/consent`);
  consent.searchParams.set('client_id', clientId);
  consent.searchParams.set('redirect_uri', redirectUri);
  consent.searchParams.set('state', state);
  consent.searchParams.set('code_challenge', codeChallenge);
  consent.searchParams.set('code_challenge_method', codeChallengeMethod);
  consent.searchParams.set('response_type', responseType);
  consent.searchParams.set(
    'mcp_complete_url',
    `${getPublicMcpBaseUrl(c.req.url)}/oauth/complete`,
  );

  return c.redirect(consent.toString(), 302);
}

export async function handleRegisterClient(c: OAuthHonoContext) {
  let body: {
    client_name?: string;
    redirect_uris?: string[];
    token_endpoint_auth_method?: string;
  };
  try {
    body = (await c.req.json()) as {
      client_name?: string;
      redirect_uris?: string[];
      token_endpoint_auth_method?: string;
    };
  } catch {
    return c.json({ error: 'invalid_client_metadata' }, 400);
  }
  const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
  if (redirectUris.length === 0) {
    return c.json({ error: 'invalid_client_metadata', error_description: 'redirect_uris required' }, 400);
  }

  const clientId = `mcp_client_${randomBytes(12).toString('hex')}`;
  // Public + PKCE clients: do not issue client_secret.
  const client: MemoryClient = {
    client_id: clientId,
    redirect_uris: redirectUris,
    client_name: body.client_name,
  };
  memoryClients.set(clientId, client);

  const supabase = getServiceClient();
  if (supabase) {
    await supabase.from('mcp_oauth_clients').upsert({
      client_id: clientId,
      client_secret_hash: null,
      redirect_uris: redirectUris,
      client_name: body.client_name ?? null,
    });
  }

  return c.json(
    {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris: redirectUris,
      token_endpoint_auth_method: 'none',
    },
    201,
  );
}

/**
 * App-facing completion: authenticated Furnace user finishes consent.
 * Body: { client_id, redirect_uri, state, code_challenge, account_ids[] }
 * Header: Authorization Bearer <supabase user JWT> (required)
 */
export async function handleOAuthComplete(c: OAuthHonoContext) {
  let body: {
    client_id?: string;
    redirect_uri?: string;
    state?: string;
    code_challenge?: string;
    account_ids?: unknown;
    account_id?: string;
    api_key?: string;
  };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json({ error: 'invalid_request' }, 400);
  }

  const clientId = body.client_id?.trim() || '';
  const redirectUri = body.redirect_uri?.trim() || '';
  const codeChallenge = body.code_challenge?.trim() || '';
  const state = body.state ?? '';

  let accountIds: string[] = [];
  if (Array.isArray(body.account_ids)) {
    accountIds = body.account_ids
      .filter((v): v is string => typeof v === 'string')
      .map((v) => v.trim())
      .filter(Boolean);
  } else if (typeof body.account_id === 'string' && body.account_id.trim()) {
    accountIds = [body.account_id.trim()];
  }
  accountIds = [...new Set(accountIds)];

  if (!clientId || !redirectUri || !codeChallenge) {
    return c.json({ error: 'invalid_request', error_description: 'Missing fields' }, 400);
  }
  if (accountIds.length === 0) {
    return c.json(
      { error: 'invalid_request', error_description: 'account_ids must be a non-empty array' },
      400,
    );
  }
  if (body.api_key) {
    return c.json(
      {
        error: 'invalid_request',
        error_description: 'api_key is no longer accepted; MCP uses user-scoped sessions',
      },
      400,
    );
  }

  const userJwt = c.req.header('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!userJwt) {
    return c.json({ error: 'access_denied', error_description: 'User session required' }, 401);
  }

  const supabase = getServiceClient();
  if (!supabase) {
    return c.json(
      { error: 'server_error', error_description: 'Auth validation unavailable' },
      500,
    );
  }

  const { data: userData, error: userError } = await supabase.auth.getUser(userJwt);
  if (userError || !userData.user) {
    return c.json({ error: 'access_denied', error_description: 'Invalid user session' }, 401);
  }
  const userId = userData.user.id;

  const registered = await assertRegisteredRedirect(clientId, redirectUri);
  if (!registered.ok) {
    return c.json(
      { error: registered.error, error_description: registered.description },
      400,
    );
  }

  const { data: memberships, error: membershipError } = await supabase
    .from('account_users')
    .select('account_id')
    .eq('user_id', userId)
    .in('account_id', accountIds);
  if (membershipError) {
    return c.json(
      { error: 'server_error', error_description: membershipError.message },
      500,
    );
  }
  const memberSet = new Set((memberships ?? []).map((m: { account_id: string }) => m.account_id));
  const missing = accountIds.filter((id) => !memberSet.has(id));
  if (missing.length > 0) {
    return c.json(
      {
        error: 'access_denied',
        error_description: `Not a member of account(s): ${missing.join(', ')}`,
      },
      403,
    );
  }

  const code = randomBytes(24).toString('hex');
  memoryAuthCodes.set(code, {
    clientId,
    redirectUri,
    codeChallenge,
    userId,
    allowedAccountIds: accountIds,
    expiresAt: Date.now() + 10 * 60 * 1000,
  });

  await supabase.from('mcp_oauth_auth_codes').insert({
    code_hash: hashToken(code),
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    user_id: userId,
    allowed_account_ids: accountIds,
    account_id: accountIds[0] ?? null,
    api_key_secret: null,
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  });

  const redirect = new URL(redirectUri);
  redirect.searchParams.set('code', code);
  if (state) redirect.searchParams.set('state', state);
  return c.json({ redirect_to: redirect.toString() });
}

function verifyPkce(verifier: string, challenge: string): boolean {
  const digest = createHash('sha256').update(verifier).digest('base64url');
  return digest === challenge;
}

async function exchangeAuthorizationCode(params: {
  code: string;
  redirectUri: string;
  codeVerifier: string;
  clientId: string;
}): Promise<
  | { ok: true; accessToken: string; refreshToken: string; expiresIn: number; scope: string }
  | { ok: false; error: string; description?: string; status: number }
> {
  const { code, redirectUri, codeVerifier, clientId } = params;

  let memory = memoryAuthCodes.get(code);
  if (memory) {
    if (memory.consumed) {
      return { ok: false, error: 'invalid_grant', status: 400 };
    }
    if (memory.expiresAt < Date.now()) {
      return { ok: false, error: 'invalid_grant', status: 400 };
    }
    if (memory.clientId !== clientId || memory.redirectUri !== redirectUri) {
      return { ok: false, error: 'invalid_grant', status: 400 };
    }
    if (!verifyPkce(codeVerifier, memory.codeChallenge)) {
      return {
        ok: false,
        error: 'invalid_grant',
        description: 'PKCE verification failed',
        status: 400,
      };
    }
    memory.consumed = true;
    memoryAuthCodes.delete(code);

    try {
      const issued = await issueUserSession({
        userId: memory.userId,
        clientId,
        allowedAccountIds: memory.allowedAccountIds,
      });
      return {
        ok: true,
        accessToken: issued.accessToken,
        refreshToken: issued.refreshToken,
        expiresIn: issued.expiresIn,
        scope: issued.scope,
      };
    } catch (err) {
      return {
        ok: false,
        error: 'server_error',
        description: err instanceof Error ? err.message : 'Failed to issue session',
        status: 500,
      };
    }
  }

  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, error: 'invalid_grant', status: 400 };
  }

  const codeHash = hashToken(code);
  const { data: row } = await supabase
    .from('mcp_oauth_auth_codes')
    .select('*')
    .eq('code_hash', codeHash)
    .maybeSingle();

  if (!row || row.consumed_at) {
    return { ok: false, error: 'invalid_grant', status: 400 };
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { ok: false, error: 'invalid_grant', status: 400 };
  }
  if (row.client_id !== clientId || row.redirect_uri !== redirectUri) {
    return { ok: false, error: 'invalid_grant', status: 400 };
  }
  if (!verifyPkce(codeVerifier, row.code_challenge)) {
    return {
      ok: false,
      error: 'invalid_grant',
      description: 'PKCE verification failed',
      status: 400,
    };
  }

  const registered = await assertRegisteredRedirect(clientId, redirectUri);
  if (!registered.ok) {
    return {
      ok: false,
      error: registered.error,
      description: registered.description,
      status: 400,
    };
  }

  const userId = row.user_id as string | null;
  const allowedAccountIds = Array.isArray(row.allowed_account_ids)
    ? (row.allowed_account_ids as string[])
    : [];
  if (!userId || allowedAccountIds.length === 0) {
    return {
      ok: false,
      error: 'invalid_grant',
      description: 'Auth code is not a user grant',
      status: 400,
    };
  }

  const { data: consumed, error: consumeError } = await supabase
    .from('mcp_oauth_auth_codes')
    .update({ consumed_at: new Date().toISOString() })
    .eq('code_hash', codeHash)
    .is('consumed_at', null)
    .select('code_hash')
    .maybeSingle();

  if (consumeError || !consumed) {
    return { ok: false, error: 'invalid_grant', status: 400 };
  }

  try {
    const issued = await issueUserSession({
      userId,
      clientId,
      allowedAccountIds,
      supabase,
    });
    return {
      ok: true,
      accessToken: issued.accessToken,
      refreshToken: issued.refreshToken,
      expiresIn: issued.expiresIn,
      scope: issued.scope,
    };
  } catch (err) {
    return {
      ok: false,
      error: 'server_error',
      description: err instanceof Error ? err.message : 'Failed to issue session',
      status: 500,
    };
  }
}

export async function handleToken(c: OAuthHonoContext) {
  const contentType = c.req.header('content-type') || '';
  let params: Record<string, string> = {};
  if (contentType.includes('application/json')) {
    params = (await c.req.json()) as Record<string, string>;
  } else {
    const form = await c.req.parseBody();
    for (const [k, v] of Object.entries(form)) {
      if (typeof v === 'string') params[k] = v;
    }
  }

  const grantType = params.grant_type;

  if (grantType === 'refresh_token') {
    const refreshToken = params.refresh_token || '';
    if (!refreshToken) {
      return c.json({ error: 'invalid_request' }, 400);
    }
    const rotated = await rotateUserSession(refreshToken);
    if (!rotated) {
      return c.json({ error: 'invalid_grant' }, 400);
    }
    return c.json({
      access_token: rotated.accessToken,
      refresh_token: rotated.refreshToken,
      token_type: 'bearer',
      expires_in: rotated.expiresIn,
      scope: rotated.scope || MCP_SCOPE,
    });
  }

  if (grantType !== 'authorization_code') {
    return c.json({ error: 'unsupported_grant_type' }, 400);
  }

  const code = params.code || '';
  const redirectUri = params.redirect_uri || '';
  const codeVerifier = params.code_verifier || '';
  const clientId = params.client_id || '';

  if (!code || !redirectUri || !codeVerifier || !clientId) {
    return c.json({ error: 'invalid_request' }, 400);
  }

  const result = await exchangeAuthorizationCode({
    code,
    redirectUri,
    codeVerifier,
    clientId,
  });
  if (!result.ok) {
    return c.json(
      {
        error: result.error,
        ...(result.description ? { error_description: result.description } : {}),
      },
      result.status,
    );
  }

  return c.json({
    access_token: result.accessToken,
    refresh_token: result.refreshToken,
    token_type: 'bearer',
    expires_in: result.expiresIn || ACCESS_TOKEN_TTL_SECONDS,
    scope: result.scope || MCP_SCOPE,
  });
}

/**
 * RFC 7009 token revocation. Always returns 200 (unknown/already-revoked = no-op).
 */
export async function handleRevoke(c: OAuthHonoContext) {
  const contentType = c.req.header('content-type') || '';
  let params: Record<string, string> = {};
  if (contentType.includes('application/json')) {
    try {
      params = (await c.req.json()) as Record<string, string>;
    } catch {
      params = {};
    }
  } else {
    try {
      const form = await c.req.parseBody();
      for (const [k, v] of Object.entries(form)) {
        if (typeof v === 'string') params[k] = v;
      }
    } catch {
      params = {};
    }
  }

  const token = params.token || '';
  const hint = params.token_type_hint || '';
  if (token) {
    if (hint === 'refresh_token') {
      await revokeUserSession({ refreshToken: token });
    } else if (hint === 'access_token') {
      await revokeUserSession({ accessToken: token });
    } else {
      const byAccess = await revokeUserSession({ accessToken: token });
      if (!byAccess) {
        await revokeUserSession({ refreshToken: token });
      }
    }
  }
  return c.body(null, 200);
}
