import assert from 'node:assert/strict';
import test from 'node:test';
import {
  batchCompletionDedupeKey,
  batchCompletionEventType,
  buildBatchCompletionPayload,
  chunkStatsToCounts,
  isImportJobOperation,
  stableGlobalLeadIdsKey,
} from './batchCompletion.js';

test('batchCompletionEventType maps each operation to a completion event', () => {
  assert.equal(batchCompletionEventType('api_lead_import'), 'lead.bulk_import.completed');
  assert.equal(batchCompletionEventType('add_to_campaign'), 'lead.added_to_campaign.completed');
  assert.equal(batchCompletionEventType('remove_from_campaign'), 'lead.removed_from_campaign.completed');
  assert.equal(batchCompletionEventType('remove_from_all_campaigns'), 'lead.removed_from_all_campaigns.completed');
  assert.equal(batchCompletionEventType('pause_enrollments'), 'enrollment.pause_completed');
  assert.equal(batchCompletionEventType('resume_enrollments'), 'enrollment.resume_completed');
});

test('isImportJobOperation rejects unknown operations', () => {
  assert.equal(isImportJobOperation('add_to_campaign'), true);
  assert.equal(isImportJobOperation('job.completed'), false);
  assert.equal(isImportJobOperation(undefined), false);
});

test('buildBatchCompletionPayload includes optional global_lead_ids', () => {
  const payload = buildBatchCompletionPayload({
    jobId: 'job-1',
    source: 'async',
    campaignId: 'camp-1',
    operation: 'add_to_campaign',
    counts: { created: 2, enrolled: 2 },
    errors: [{ global_lead_id: 'abc', message: 'skipped' }],
    globalLeadIds: ['abc', 'def'],
  });
  assert.deepEqual(payload, {
    job_id: 'job-1',
    source: 'async',
    campaign_id: 'camp-1',
    operation: 'add_to_campaign',
    counts: { created: 2, enrolled: 2 },
    errors: [{ global_lead_id: 'abc', message: 'skipped' }],
    global_lead_ids: ['abc', 'def'],
  });
});

test('batchCompletionDedupeKey prefers job id then stable sync scope', () => {
  assert.equal(
    batchCompletionDedupeKey('lead.bulk_import.completed', 'job-1'),
    'lead.bulk_import.completed:job-1',
  );
  assert.equal(
    batchCompletionDedupeKey('enrollment.pause_completed', null, 'camp:abc,def'),
    'enrollment.pause_completed:sync:camp:abc,def',
  );
});

test('stableGlobalLeadIdsKey sorts ids for deterministic dedupe', () => {
  assert.equal(stableGlobalLeadIdsKey(['b', 'a', 'c']), 'a,b,c');
});

test('chunkStatsToCounts normalizes counts per operation', () => {
  assert.deepEqual(
    chunkStatsToCounts('remove_from_campaign', { removed: 3, skipped: 1, failed: 0, created: 99 }),
    { removed: 3, skipped: 1, failed: 0 },
  );
  assert.deepEqual(
    chunkStatsToCounts('pause_enrollments', { paused: 2, skipped: 0 }),
    { paused: 2, skipped: 0, failed: 0 },
  );
});
