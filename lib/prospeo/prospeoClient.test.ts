import test from 'node:test';
import assert from 'node:assert/strict';
import { enrichPerson, ProspeoError } from './prospeoClient';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('enrichPerson posts enrich-person with X-KEY and email', async () => {
  const calls: Array<{ url: string; body: unknown; headers: Record<string, string> }> = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      body: JSON.parse(String(init?.body)),
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    return jsonResponse({
      error: false,
      person: { first_name: 'Jane', email: { email: 'jane@acme.com', revealed: true } },
      company: { name: 'Acme' },
    });
  }) as unknown as typeof fetch;

  const result = await enrichPerson(
    { email: 'jane@acme.com', enrichMobile: true },
    { apiKey: 'test-key', fetchImpl },
  );

  assert.equal(result?.person?.first_name, 'Jane');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.prospeo.io/enrich-person');
  assert.equal(calls[0].headers['X-KEY'], 'test-key');
  assert.deepEqual(calls[0].body, {
    data: { email: 'jane@acme.com' },
    enrich_mobile: true,
  });
});

test('enrichPerson includes only_verified_mobile when requested', async () => {
  const calls: Array<{ body: unknown }> = [];
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    calls.push({ body: JSON.parse(String(init?.body)) });
    return jsonResponse({ error: false, person: { first_name: 'Jane' } });
  }) as unknown as typeof fetch;

  await enrichPerson(
    {
      linkedinUrl: 'https://linkedin.com/in/jane',
      enrichMobile: true,
      onlyVerifiedMobile: true,
    },
    { apiKey: 'k', fetchImpl },
  );

  assert.deepEqual(calls[0]?.body, {
    data: { linkedin_url: 'https://linkedin.com/in/jane' },
    enrich_mobile: true,
    only_verified_mobile: true,
  });
});

test('enrichPerson returns null on NO_MATCH', async () => {
  const fetchImpl = (async () =>
    jsonResponse({ error: true, error_code: 'NO_MATCH' }, 400)) as unknown as typeof fetch;
  const result = await enrichPerson({ email: 'nobody@acme.com' }, { apiKey: 'k', fetchImpl });
  assert.equal(result, null);
});

test('enrichPerson throws ProspeoError on INSUFFICIENT_CREDITS', async () => {
  const fetchImpl = (async () =>
    jsonResponse({ error: true, error_code: 'INSUFFICIENT_CREDITS' }, 400)) as unknown as typeof fetch;

  await assert.rejects(
    () => enrichPerson({ email: 'jane@acme.com' }, { apiKey: 'k', fetchImpl }),
    (err: unknown) =>
      err instanceof ProspeoError &&
      err.code === 'INSUFFICIENT_CREDITS' &&
      err.status === 400,
  );
});

test('enrichPerson requires minimum match keys', async () => {
  await assert.rejects(
    () => enrichPerson({}, { apiKey: 'k' }),
    /requires email, linkedinUrl, or name\+company/,
  );
});

test('enrichPerson retries on 429 then succeeds', async () => {
  let attempts = 0;
  const fetchImpl = (async () => {
    attempts += 1;
    if (attempts < 2) return jsonResponse({ error: true }, 429);
    return jsonResponse({ error: false, person: { first_name: 'Retry' } });
  }) as unknown as typeof fetch;

  const result = await enrichPerson(
    { email: 'jane@acme.com' },
    { apiKey: 'k', fetchImpl, baseDelayMs: 1 },
  );
  assert.equal(result?.person?.first_name, 'Retry');
  assert.equal(attempts, 2);
});

test('enrichPerson throws after exhausting 500 retries', async () => {
  let attempts = 0;
  const fetchImpl = (async () => {
    attempts += 1;
    return jsonResponse({ error: true }, 500);
  }) as unknown as typeof fetch;

  await assert.rejects(
    () =>
      enrichPerson(
        { email: 'jane@acme.com' },
        { apiKey: 'k', fetchImpl, maxAttempts: 2, baseDelayMs: 1 },
      ),
    (err: unknown) => err instanceof ProspeoError && err.status === 500,
  );
  assert.equal(attempts, 2);
});
