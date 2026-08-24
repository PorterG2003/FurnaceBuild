import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ClientApiDbHarness,
  createClientApiTestNamespace,
} from './harness.js';

function installWebhookTestFetchMock() {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith('https://webhook-test.test/')) {
      const body = JSON.parse(String(init?.body ?? '{}')) as { type?: string; data?: Record<string, unknown> };
      if (url.includes('/fail')) {
        return new Response('upstream error', { status: 502 });
      }
      if (url.includes('/http-only')) {
        return new Response('bad scheme', { status: 200 });
      }
      return new Response(JSON.stringify({ received: body.type, test: body.data?.test }), {
        status: 200,
      });
    }
    return originalFetch(input, init);
  };
  return () => {
    globalThis.fetch = originalFetch;
  };
}

test('internal webhook test succeeds and returns envelope metadata', async (t) => {
  const restoreFetch = installWebhookTestFetchMock();
  t.after(restoreFetch);

  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('webhook-test-ok'),
  });

  try {
    const response = await harness.requestAsOwner('/internal/webhook/test', {
      method: 'POST',
      body: {
        accountId: harness.accountId,
        url: 'https://webhook-test.test/ok',
        eventType: 'email.sent',
      },
    });
    assert.equal(response.status, 200);
    const body = await response.json() as {
      data: {
        success: boolean;
        status: number;
        event_type: string;
        request_body: {
          type: string;
          data: {
            test: boolean;
            email?: string;
            mailbox_email?: string;
            campaign_name?: string;
          };
        };
      };
    };
    assert.equal(body.data.success, true);
    assert.equal(body.data.status, 200);
    assert.equal(body.data.event_type, 'email.sent');
    assert.equal(body.data.request_body.type, 'email.sent');
    assert.equal(body.data.request_body.data.test, true);
    assert.equal(body.data.request_body.data.email, 'lead@example.com');
    assert.equal(body.data.request_body.data.mailbox_email, 'sender@example.com');
    assert.equal(body.data.request_body.data.campaign_name, 'Example campaign');
  } finally {
    await harness.cleanup();
  }
});

test('internal webhook test returns 422 when endpoint is not successful', async (t) => {
  const restoreFetch = installWebhookTestFetchMock();
  t.after(restoreFetch);

  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('webhook-test-fail'),
  });

  try {
    const response = await harness.requestAsOwner('/internal/webhook/test', {
      method: 'POST',
      body: {
        accountId: harness.accountId,
        url: 'https://webhook-test.test/fail',
        eventType: 'reply.received',
      },
    });
    assert.equal(response.status, 422);
    const body = await response.json() as { data: { success: boolean; status: number; event_type: string } };
    assert.equal(body.data.success, false);
    assert.equal(body.data.status, 502);
    assert.equal(body.data.event_type, 'reply.received');
  } finally {
    await harness.cleanup();
  }
});

test('internal webhook test rejects invalid event types and non-https urls', async (t) => {
  const restoreFetch = installWebhookTestFetchMock();
  t.after(restoreFetch);

  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('webhook-test-validate'),
  });

  try {
    const invalidEvent = await harness.requestAsOwner('/internal/webhook/test', {
      method: 'POST',
      body: {
        accountId: harness.accountId,
        url: 'https://webhook-test.test/ok',
        eventType: 'webhook.test',
      },
    });
    assert.equal(invalidEvent.status, 400);

    const invalidUrl = await harness.requestAsOwner('/internal/webhook/test', {
      method: 'POST',
      body: {
        accountId: harness.accountId,
        url: 'http://webhook-test.test/http-only',
      },
    });
    assert.equal(invalidUrl.status, 400);
  } finally {
    await harness.cleanup();
  }
});

test('internal webhook test rejects api keys and non-admin members', async (t) => {
  const restoreFetch = installWebhookTestFetchMock();
  t.after(restoreFetch);

  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('webhook-test-auth'),
  });

  try {
    await harness.ensureOwnerAuthUser();
    const apiKey = await harness.createApiKey();

    const apiKeyAttempt = await harness.request('/internal/webhook/test', {
      method: 'POST',
      apiKey: apiKey.secret,
      body: {
        accountId: harness.accountId,
        url: 'https://webhook-test.test/ok',
      },
    });
    assert.equal(apiKeyAttempt.status, 401);

    const member = await harness.createMemberUser();
    const memberAttempt = await harness.request('/internal/webhook/test', {
      method: 'POST',
      headers: { Authorization: `Bearer ${member.accessToken}` },
      body: {
        accountId: harness.accountId,
        url: 'https://webhook-test.test/ok',
      },
    });
    assert.equal(memberAttempt.status, 403);
    const memberBody = await memberAttempt.json() as { error: { code: string } };
    assert.equal(memberBody.error.code, 'account_admin_required');
  } finally {
    await harness.cleanup();
  }
});
