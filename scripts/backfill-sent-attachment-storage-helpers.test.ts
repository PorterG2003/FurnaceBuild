import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  matchJobAttachmentByFilename,
  patchMessageAttachmentsWithStoragePaths,
  planDryRunWrites,
  stripJobAttachmentContent,
} from './backfill-sent-attachment-storage-helpers';

describe('backfill-sent-attachment-storage helpers', () => {
  it('matches job attachments by filename case-insensitively', () => {
    const job = matchJobAttachmentByFilename(
      [{ filename: 'AI-Readiness Checklist ZSH.pdf', content: 'abc' }],
      'ai-readiness checklist zsh.pdf'
    );
    assert.ok(job);
    assert.equal(job?.content, 'abc');
  });

  it('patches message attachments with storagePath when job has content', () => {
    const { next, changed } = patchMessageAttachmentsWithStoragePaths(
      [{ filename: 'note.txt', contentType: 'text/plain', size: 2 }],
      [{ filename: 'note.txt', content: Buffer.from('hi').toString('base64') }],
      (filename, index) => `acct/thread/msg/${index}-${filename}`
    );
    assert.equal(changed, true);
    assert.equal(next[0].storagePath, 'acct/thread/msg/0-note.txt');
  });

  it('is idempotent when storagePath already present', () => {
    const { next, changed } = patchMessageAttachmentsWithStoragePaths(
      [{ filename: 'note.txt', storagePath: 'already/there', size: 2 }],
      [{ filename: 'note.txt', content: 'xx' }],
      () => 'new/path'
    );
    assert.equal(changed, false);
    assert.equal(next[0].storagePath, 'already/there');
  });

  it('strips content from job attachments', () => {
    const stripped = stripJobAttachmentContent([
      { filename: 'a.pdf', contentType: 'application/pdf', content: 'base64data', size: 10 },
    ]);
    assert.equal(stripped[0].filename, 'a.pdf');
    assert.equal((stripped[0] as { content?: string }).content, undefined);
  });

  it('dry-run plan reports zero writes', () => {
    assert.deepEqual(
      planDryRunWrites({ wouldUpload: true, wouldPatchMessage: true, wouldStripJob: true }),
      { writes: 0 }
    );
  });
});
