import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyCopyRenderingBackfillJob } from './backfillCopyRenderings';

test('eligibility classifier partitions jobs without overlap', () => {
  const inbox = classifyCopyRenderingBackfillJob({
    messageType: 'inbox_reply',
    mappedContentId: 'content-1',
    parseStatus: 'done',
    occurrenceCount: 2,
    copyRenderingId: null,
  });
  const stamped = classifyCopyRenderingBackfillJob({
    messageType: 'campaign',
    mappedContentId: 'content-1',
    parseStatus: 'done',
    occurrenceCount: 2,
    copyRenderingId: 'rendering-1',
  });
  const unmapped = classifyCopyRenderingBackfillJob({
    messageType: 'campaign',
    mappedContentId: null,
    parseStatus: 'done',
    occurrenceCount: 2,
    copyRenderingId: null,
  });
  const unparsed = classifyCopyRenderingBackfillJob({
    messageType: 'campaign',
    mappedContentId: 'content-1',
    parseStatus: 'queued',
    occurrenceCount: 0,
    copyRenderingId: null,
  });
  const eligible = classifyCopyRenderingBackfillJob({
    messageType: 'campaign',
    mappedContentId: 'content-1',
    parseStatus: 'done',
    occurrenceCount: 1,
    copyRenderingId: null,
  });

  assert.deepEqual(
    [inbox, stamped, unmapped, unparsed, eligible],
    ['inbox', 'already_stamped', 'unmapped', 'unparsed', 'eligible'],
  );
  assert.equal(new Set([inbox, stamped, unmapped, unparsed, eligible]).size, 5);
});
