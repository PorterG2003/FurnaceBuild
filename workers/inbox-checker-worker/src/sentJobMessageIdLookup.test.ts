import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FIND_SENT_JOBS_BY_MESSAGE_IDS_RPC,
  SENT_JOB_REPLY_SELECT,
} from './sentJobMessageIdLookup.js';

test('FIND_SENT_JOBS_BY_MESSAGE_IDS_RPC is the inbox lookup function name', () => {
  assert.equal(FIND_SENT_JOBS_BY_MESSAGE_IDS_RPC, 'find_sent_jobs_by_message_ids');
});

test('SENT_JOB_REPLY_SELECT stays a PK-hydrate shape, not nested *', () => {
  assert.equal(SENT_JOB_REPLY_SELECT.includes('enrollments(*)'), false);
  assert.match(SENT_JOB_REPLY_SELECT, /campaigns\(name\)/);
  assert.match(SENT_JOB_REPLY_SELECT, /leads\(email/);
  assert.match(SENT_JOB_REPLY_SELECT, /mailboxes\(account_id/);
});
