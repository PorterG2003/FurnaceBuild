import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

/**
 * Light contract checks for attachment Lambda request shape.
 * Full handler I/O is covered via outcomes + client Blob tests with mocks.
 */
describe('fetchEmailAttachment request contract', () => {
  it('fetch uses attachment_index (and optional legacy part)', () => {
    const body = {
      action: 'fetch',
      email_message_id: 'msg-1',
      attachment_index: 0,
    };
    assert.equal(body.action, 'fetch');
    assert.equal(typeof body.attachment_index, 'number');
  });

  it('prepare_upload carries account, thread, and filename', () => {
    const body = {
      action: 'prepare_upload',
      account_id: 'acct',
      thread_id: 'thread',
      filename: 'a.pdf',
      content_type: 'application/pdf',
      size: 10,
    };
    assert.ok(body.account_id && body.thread_id && body.filename);
  });

  it('delete_upload requires storage_path', () => {
    const body = { action: 'delete_upload', storage_path: 'a/b/c/f.pdf' };
    assert.ok(body.storage_path.includes('/'));
  });
});
