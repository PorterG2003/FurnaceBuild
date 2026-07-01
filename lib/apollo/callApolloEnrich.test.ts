import test from 'node:test';
import assert from 'node:assert/strict';
import { callApolloEnrich, type CallApolloEnrichDeps } from './callApolloEnrich';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const baseDeps = (
  fetchImpl: typeof fetch,
  overrides: Partial<CallApolloEnrichDeps> = {},
): CallApolloEnrichDeps => ({
  getUrl: () => 'https://lambda.example/apollo',
  getToken: async () => 'jwt-token',
  fetchImpl,
  ...overrides,
});

test('callApolloEnrich returns a match result with suggestion + credits + session', async () => {
  let sentBody: unknown;
  let sentAuth: string | undefined;
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    sentBody = JSON.parse(String(init?.body));
    sentAuth = (init?.headers as Record<string, string>)?.Authorization;
    return jsonResponse({
      ok: true,
      match: true,
      sessionId: 'sess-1',
      phonePending: true,
      suggestion: { name: 'Jane Doe', first_name: 'Jane' },
      creditsRemaining: 98,
      creditLimit: 100,
    });
  }) as unknown as typeof fetch;

  const result = await callApolloEnrich(
    { accountId: 'acc-1', globalLeadId: 'lead-1' },
    baseDeps(fetchImpl),
  );

  assert.equal(result.ok, true);
  assert.ok(result.ok && 'match' in result && result.match);
  if (result.ok && 'match' in result && result.match) {
    assert.equal(result.suggestion.name, 'Jane Doe');
    assert.equal(result.sessionId, 'sess-1');
    assert.equal(result.phonePending, true);
    assert.equal(result.creditsRemaining, 98);
    assert.equal(result.creditLimit, 100);
  }
  assert.deepEqual(sentBody, { accountId: 'acc-1', globalLeadId: 'lead-1' });
  assert.equal(sentAuth, 'Bearer jwt-token');
});

test('callApolloEnrich returns pending resume on 409 PHONE_ENRICH_PENDING', async () => {
  const fetchImpl = (async () =>
    jsonResponse(
      {
        ok: false,
        error: 'An enrichment is already in progress for this lead.',
        code: 'PHONE_ENRICH_PENDING',
        sessionId: 'sess-pending',
      },
      409,
    )) as unknown as typeof fetch;

  const result = await callApolloEnrich(
    { accountId: 'acc-1', globalLeadId: 'lead-1' },
    baseDeps(fetchImpl),
  );
  assert.ok(result.ok && 'pending' in result && result.pending);
  if (result.ok && 'pending' in result && result.pending) {
    assert.equal(result.sessionId, 'sess-pending');
  }
});

test('callApolloEnrich returns a no-match result without a suggestion', async () => {
  const fetchImpl = (async () =>
    jsonResponse({ ok: true, match: false, creditsRemaining: 50, creditLimit: 100 })) as unknown as typeof fetch;

  const result = await callApolloEnrich(
    { accountId: 'acc-1', globalLeadId: 'lead-1' },
    baseDeps(fetchImpl),
  );
  assert.ok(result.ok && !result.match);
  if (result.ok && !result.match) {
    assert.equal(result.creditsRemaining, 50);
  }
});

test('callApolloEnrich surfaces Apollo upstream errors with credits', async () => {
  const fetchImpl = (async () =>
    jsonResponse(
      {
        ok: false,
        error: 'Contact lookup failed',
        code: 'APOLLO_UPSTREAM',
        creditsRemaining: 100,
        creditLimit: 100,
      },
      502,
    )) as unknown as typeof fetch;

  const result = await callApolloEnrich(
    { accountId: 'acc-1', globalLeadId: 'lead-1' },
    baseDeps(fetchImpl),
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, 'APOLLO_UPSTREAM');
    assert.equal(result.status, 502);
    assert.equal(result.creditsRemaining, 100);
    assert.equal(result.creditLimit, 100);
  }
});

test('callApolloEnrich surfaces server errors with code + credits', async () => {
  const fetchImpl = (async () =>
    jsonResponse(
      { ok: false, error: 'No enrichment credits remaining this month.', code: 'NO_CREDITS', creditsRemaining: 0 },
      402,
    )) as unknown as typeof fetch;

  const result = await callApolloEnrich(
    { accountId: 'acc-1', globalLeadId: 'lead-1' },
    baseDeps(fetchImpl),
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, 'NO_CREDITS');
    assert.equal(result.status, 402);
    assert.equal(result.creditsRemaining, 0);
  }
});

test('callApolloEnrich fails fast when the URL is not configured', async () => {
  const fetchImpl = (async () => jsonResponse({})) as unknown as typeof fetch;
  const result = await callApolloEnrich(
    { accountId: 'acc-1', globalLeadId: 'lead-1' },
    baseDeps(fetchImpl, { getUrl: () => undefined }),
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.message, /not configured/);
});

test('callApolloEnrich fails when there is no auth token', async () => {
  const fetchImpl = (async () => jsonResponse({})) as unknown as typeof fetch;
  const result = await callApolloEnrich(
    { accountId: 'acc-1', globalLeadId: 'lead-1' },
    baseDeps(fetchImpl, { getToken: async () => null }),
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.message, /signed in/);
});
