import assert from 'node:assert/strict';
import test from 'node:test';

import { smartleadRequest } from './api';

test('smartleadRequest retries transient 500 responses before returning', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;

  globalThis.fetch = async () => {
    calls += 1;
    if (calls <= 2) {
      return new Response('temporary failure', { status: 500 });
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const res = await smartleadRequest({ url: 'https://server.smartlead.ai/api/v1/test' });
    assert.equal(res.status, 200);
    assert.equal(calls, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
