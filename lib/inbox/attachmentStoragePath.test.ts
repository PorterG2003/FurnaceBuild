import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildInboxAttachmentStoragePath,
  canDownloadAttachment,
  safeAttachmentFilename,
} from './attachmentStoragePath';

describe('attachmentStoragePath', () => {
  it('builds stable account/thread/upload/filename keys', () => {
    const path = buildInboxAttachmentStoragePath({
      accountId: 'acct-1',
      threadId: 'thread-1',
      uploadId: 'up-1',
      filename: 'AI-Readiness Checklist ZSH.pdf',
    });
    assert.equal(path, 'acct-1/thread-1/up-1/AI-Readiness_Checklist_ZSH.pdf');
  });

  it('sanitizes unsafe filename characters', () => {
    assert.equal(safeAttachmentFilename('../../etc/passwd'), '.._.._etc_passwd');
    assert.ok(safeAttachmentFilename('ok.pdf').endsWith('.pdf'));
  });
});

describe('canDownloadAttachment', () => {
  it('allows storagePath without IMAP fields', () => {
    assert.equal(
      canDownloadAttachment({
        filename: 'a.pdf',
        storagePath: 'acct/thread/up/a.pdf',
      }),
      true
    );
  });

  it('allows IMAP part with uid', () => {
    assert.equal(
      canDownloadAttachment({ filename: 'a.png', part: '2', imapUid: 10 }),
      true
    );
    assert.equal(
      canDownloadAttachment({ filename: 'a.png', part: '2' }, 99),
      true
    );
  });

  it('denies when neither locator present', () => {
    assert.equal(canDownloadAttachment({ filename: 'a.pdf', size: 1 }), false);
  });
});
