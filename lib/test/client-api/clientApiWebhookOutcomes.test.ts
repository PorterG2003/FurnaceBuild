import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ClientApiDbHarness,
  createClientApiTestNamespace,
} from './harness.js';

function installWebhookVerifyFetchMock() {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith('https://webhook-verify.test/')) {
      const body = JSON.parse(String(init?.body ?? '{}')) as { type?: string; token?: string };
      if (url.includes('/no-echo')) {
        return new Response('verification failed', { status: 200 });
      }
      if (body.type === 'webhook.verify' && body.token) {
        return new Response(body.token, { status: 200 });
      }
      return new Response('missing token', { status: 200 });
    }
    return originalFetch(input, init);
  };
  return () => {
    globalThis.fetch = originalFetch;
  };
}

test('internal webhook verify succeeds when endpoint echoes the token', async (t) => {
  const restoreFetch = installWebhookVerifyFetchMock();
  t.after(restoreFetch);

  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('webhook-verify-ok'),
  });

  try {
    const response = await harness.requestAsOwner('/internal/webhook/verify', {
      method: 'POST',
      body: {
        accountId: harness.accountId,
        url: 'https://webhook-verify.test/echo',
      },
    });
    assert.equal(response.status, 200);
    const body = await response.json() as { data: { verified: boolean; status: number } };
    assert.equal(body.data.verified, true);
    assert.equal(body.data.status, 200);
  } finally {
    await harness.cleanup();
  }
});

test('internal webhook verify returns 422 when endpoint does not echo the token', async (t) => {
  const restoreFetch = installWebhookVerifyFetchMock();
  t.after(restoreFetch);

  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('webhook-verify-fail'),
  });

  try {
    const response = await harness.requestAsOwner('/internal/webhook/verify', {
      method: 'POST',
      body: {
        accountId: harness.accountId,
        url: 'https://webhook-verify.test/no-echo',
      },
    });
    assert.equal(response.status, 422);
    const body = await response.json() as { data: { verified: boolean } };
    assert.equal(body.data.verified, false);
  } finally {
    await harness.cleanup();
  }
});

test('internal webhook verify rejects api keys and non-admin members', async (t) => {
  const restoreFetch = installWebhookVerifyFetchMock();
  t.after(restoreFetch);

  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('webhook-verify-auth'),
  });

  try {
    await harness.ensureOwnerAuthUser();
    const apiKey = await harness.createApiKey();

    const apiKeyAttempt = await harness.request('/internal/webhook/verify', {
      method: 'POST',
      apiKey: apiKey.secret,
      body: {
        accountId: harness.accountId,
        url: 'https://webhook-verify.test/echo',
      },
    });
    assert.equal(apiKeyAttempt.status, 401);

    const member = await harness.createMemberUser();
    const memberAttempt = await harness.request('/internal/webhook/verify', {
      method: 'POST',
      headers: { Authorization: `Bearer ${member.accessToken}` },
      body: {
        accountId: harness.accountId,
        url: 'https://webhook-verify.test/echo',
      },
    });
    assert.equal(memberAttempt.status, 403);
    const memberBody = await memberAttempt.json() as { error: { code: string } };
    assert.equal(memberBody.error.code, 'account_admin_required');
  } finally {
    await harness.cleanup();
  }
});
