import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { fetchAttachment } from './attachments';

describe('fetchAttachment Blob normalization', () => {
  it('follows signed URL JSON responses to a Blob', async () => {
    const blobBytes = new Uint8Array([1, 2, 3]);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('lambda')) {
        return new Response(JSON.stringify({ url: 'https://storage.example/file' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(blobBytes, { status: 200 });
    }) as typeof fetch;

    try {
      const blob = await fetchAttachment('https://lambda.example', 'token', 'msg-1', 0);
      const buf = new Uint8Array(await blob.arrayBuffer());
      assert.deepEqual([...buf], [1, 2, 3]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('returns binary Lambda responses as Blob', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock.fn(async () => {
      return new Response(new Uint8Array([9, 9]), {
        status: 200,
        headers: { 'Content-Type': 'application/pdf' },
      });
    }) as typeof fetch;

    try {
      const blob = await fetchAttachment('https://lambda.example', 'token', 'msg-1', 0);
      const buf = new Uint8Array(await blob.arrayBuffer());
      assert.deepEqual([...buf], [9, 9]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
