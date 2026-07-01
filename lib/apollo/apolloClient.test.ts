import test from 'node:test';
import assert from 'node:assert/strict';
import { enrichPerson, ApolloError } from './apolloClient';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('enrichPerson posts to people/match with the email and returns the person', async () => {
  const calls: Array<{ url: string; body: unknown; headers: Record<string, string> }> = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      body: JSON.parse(String(init?.body)),
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    return jsonResponse({ person: { first_name: 'Jane', email: 'jane@acme.com' } });
  }) as unknown as typeof fetch;

  const person = await enrichPerson(
    { email: 'jane@acme.com' },
    { apiKey: 'test-key', fetchImpl },
  );

  assert.equal(person?.first_name, 'Jane');
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/people\/match$/);
  assert.deepEqual(calls[0].body, { reveal_personal_emails: true, email: 'jane@acme.com' });
  assert.equal((calls[0].headers as Record<string, string>)['X-Api-Key'], 'test-key');
});

test('enrichPerson returns null when Apollo has no match', async () => {
  const fetchImpl = (async () => jsonResponse({ person: null })) as unknown as typeof fetch;
  const person = await enrichPerson({ email: 'nobody@acme.com' }, { apiKey: 'k', fetchImpl });
  assert.equal(person, null);
});

test('enrichPerson requires an email or linkedin url', async () => {
  await assert.rejects(
    () => enrichPerson({}, { apiKey: 'k' }),
    /requires an email or linkedinUrl/,
  );
});

test('enrichPerson retries on 429 then succeeds', async () => {
  let attempts = 0;
  const fetchImpl = (async () => {
    attempts += 1;
    if (attempts < 2) return jsonResponse({ error: 'rate limited' }, 429);
    return jsonResponse({ person: { first_name: 'Retry' } });
  }) as unknown as typeof fetch;

  const person = await enrichPerson(
    { linkedinUrl: 'https://linkedin.com/in/x' },
    { apiKey: 'k', fetchImpl, baseDelayMs: 1 },
  );
  assert.equal(person?.first_name, 'Retry');
  assert.equal(attempts, 2);
});

test('enrichPerson includes reveal_phone_number and webhook_url when requested', async () => {
  const calls: Array<{ body: unknown }> = [];
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    calls.push({ body: JSON.parse(String(init?.body)) });
    return jsonResponse({ person: { first_name: 'Jane' } });
  }) as unknown as typeof fetch;

  await enrichPerson(
    {
      email: 'jane@acme.com',
      revealPhoneNumber: true,
      webhookUrl: 'https://lambda.example/sessions/abc',
    },
    { apiKey: 'test-key', fetchImpl },
  );

  assert.deepEqual(calls[0]?.body, {
    reveal_personal_emails: true,
    email: 'jane@acme.com',
    reveal_phone_number: true,
    webhook_url: 'https://lambda.example/sessions/abc',
  });
});

test('enrichPerson requires webhookUrl when revealPhoneNumber is true', async () => {
  await assert.rejects(
    () => enrichPerson({ email: 'jane@acme.com', revealPhoneNumber: true }, { apiKey: 'k' }),
    /requires webhookUrl/,
  );
});

test('enrichPerson throws ApolloError after exhausting retries on 500', async () => {
  let attempts = 0;
  const fetchImpl = (async () => {
    attempts += 1;
    return jsonResponse({ error: 'boom' }, 500);
  }) as unknown as typeof fetch;

  await assert.rejects(
    () =>
      enrichPerson(
        { email: 'jane@acme.com' },
        { apiKey: 'k', fetchImpl, maxAttempts: 2, baseDelayMs: 1 },
      ),
    (err: unknown) => err instanceof ApolloError && err.status === 500,
  );
  assert.equal(attempts, 2);
});
