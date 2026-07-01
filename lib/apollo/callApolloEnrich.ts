import type { ApolloProfileSuggestion } from './mapApolloToProfile';
import { getApolloEnrichUrl } from './apolloEnrichUrl';

export interface ApolloEnrichMatch {
  ok: true;
  match: true;
  suggestion: ApolloProfileSuggestion;
  sessionId: string;
  phonePending: boolean;
  creditsRemaining: number;
  creditLimit: number;
}

export interface ApolloEnrichNoMatch {
  ok: true;
  match: false;
  sessionId?: string;
  creditsRemaining: number;
  creditLimit: number;
}

export interface ApolloEnrichPending {
  ok: true;
  pending: true;
  sessionId: string;
}

export interface ApolloEnrichError {
  ok: false;
  message: string;
  code?: string;
  status?: number;
  sessionId?: string;
  creditsRemaining?: number;
  creditLimit?: number;
}

export type ApolloEnrichResult =
  | ApolloEnrichMatch
  | ApolloEnrichNoMatch
  | ApolloEnrichPending
  | ApolloEnrichError;

/** Injectable dependencies — defaults wire up the real app; tests pass mocks. */
export interface CallApolloEnrichDeps {
  getUrl?: () => string | undefined;
  getToken?: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
}

async function defaultGetToken(): Promise<string | null> {
  const { getAccessToken } = await import('@/lib/services/auth-token');
  return getAccessToken();
}

/**
 * POST to the `apolloEnrich` Lambda with the current user's Supabase access token.
 * The Lambda performs the Apollo lookup, charges a credit on a match, and returns
 * normalized profile suggestions for the comparison UI.
 */
export async function callApolloEnrich(
  input: {
    accountId: string;
    globalLeadId: string;
  },
  deps: CallApolloEnrichDeps = {},
): Promise<ApolloEnrichResult> {
  const getUrl = deps.getUrl ?? getApolloEnrichUrl;
  const getToken = deps.getToken ?? defaultGetToken;
  const fetchImpl = deps.fetchImpl ?? fetch;

  const url = getUrl();
  if (!url) {
    return {
      ok: false,
      message:
        'Lead enrichment is not configured. Run `npx ampx sandbox` (or deploy), ensure `amplify_outputs.json` includes `custom.apolloEnrichUrl`, or set `EXPO_PUBLIC_APOLLO_ENRICH_URL`.',
    };
  }

  const token = await getToken();
  if (!token) {
    return { ok: false, message: 'You must be signed in.' };
  }

  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(input),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Network error';
    return { ok: false, message: msg };
  }

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  if (res.status === 409 && data.code === 'PHONE_ENRICH_PENDING') {
    const sessionId = typeof data.sessionId === 'string' ? data.sessionId : undefined;
    if (sessionId) {
      return { ok: true, pending: true, sessionId };
    }
  }

  if (!res.ok || data.ok !== true) {
    return {
      ok: false,
      message: typeof data.error === 'string' ? data.error : `Request failed (${res.status})`,
      code: typeof data.code === 'string' ? data.code : undefined,
      status: res.status,
      sessionId: typeof data.sessionId === 'string' ? data.sessionId : undefined,
      creditsRemaining: typeof data.creditsRemaining === 'number' ? data.creditsRemaining : undefined,
      creditLimit: typeof data.creditLimit === 'number' ? data.creditLimit : undefined,
    };
  }

  if (data.match === true) {
    return {
      ok: true,
      match: true,
      suggestion: data.suggestion as ApolloProfileSuggestion,
      sessionId: typeof data.sessionId === 'string' ? data.sessionId : '',
      phonePending: data.phonePending === true,
      creditsRemaining: typeof data.creditsRemaining === 'number' ? data.creditsRemaining : 0,
      creditLimit: typeof data.creditLimit === 'number' ? data.creditLimit : 0,
    };
  }

  return {
    ok: true,
    match: false,
    sessionId: typeof data.sessionId === 'string' ? data.sessionId : undefined,
    creditsRemaining: typeof data.creditsRemaining === 'number' ? data.creditsRemaining : 0,
    creditLimit: typeof data.creditLimit === 'number' ? data.creditLimit : 0,
  };
}
