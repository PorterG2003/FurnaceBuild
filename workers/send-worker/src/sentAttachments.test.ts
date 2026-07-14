import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildSentAttachmentMetadata,
  resolveSendAttachments,
} from './sentAttachments.js';

function mockSupabase(opts: {
  downloadError?: string | null;
  downloadBytes?: Buffer;
}) {
  return {
    storage: {
      from() {
        return {
          async download() {
            if (opts.downloadError) {
              return { data: null, error: { message: opts.downloadError } };
            }
            const bytes = opts.downloadBytes ?? Buffer.from('hi');
            return {
              data: {
                arrayBuffer: async () =>
                  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
              },
              error: null,
            };
          },
        };
      },
    },
  } as any;
}

describe('resolveSendAttachments', () => {
  it('downloads by storagePath', async () => {
    const supabase = mockSupabase({ downloadBytes: Buffer.from('hello') });
    const resolved = await resolveSendAttachments(supabase, [
      {
        filename: 'a.txt',
        contentType: 'text/plain',
        size: 5,
        storagePath: 'acct/thread/up/a.txt',
      },
    ]);
    assert.equal(resolved.length, 1);
    assert.equal(resolved[0].storagePath, 'acct/thread/up/a.txt');
    assert.equal(Buffer.from(resolved[0].content, 'base64').toString(), 'hello');
  });

  it('falls back to legacy base64 content', async () => {
    const supabase = mockSupabase({});
    const content = Buffer.from('hi').toString('base64');
    const resolved = await resolveSendAttachments(supabase, [
      { filename: 'note.txt', contentType: 'text/plain', content },
    ]);
    assert.equal(resolved.length, 1);
    assert.equal(resolved[0].content, content);
    assert.equal(resolved[0].storagePath, undefined);
  });

  it('fails closed when Storage download misses', async () => {
    const supabase = mockSupabase({ downloadError: 'not found' });
    await assert.rejects(
      () =>
        resolveSendAttachments(supabase, [
          { filename: 'a.pdf', storagePath: 'acct/thread/up/a.pdf' },
        ]),
      /Failed to download attachment/
    );
  });
});

describe('buildSentAttachmentMetadata', () => {
  it('includes storagePath when present', () => {
    const meta = buildSentAttachmentMetadata([
      {
        filename: 'a.pdf',
        contentType: 'application/pdf',
        size: 10,
        storagePath: 'acct/t/u/a.pdf',
        content: 'aa',
      },
    ]);
    assert.deepEqual(meta, [
      {
        filename: 'a.pdf',
        contentType: 'application/pdf',
        size: 10,
        storagePath: 'acct/t/u/a.pdf',
      },
    ]);
  });
});
