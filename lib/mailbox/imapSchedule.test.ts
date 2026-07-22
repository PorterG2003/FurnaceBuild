import test from 'node:test';
import assert from 'node:assert/strict';
import {
  IMAP_CHECK_INTERVAL_MINUTES,
  IMAP_TRANSIENT_PROMOTE_AFTER,
  addMinutes,
  buildMailboxImapFailureUpdate,
  buildMailboxImapRestoreUpdate,
  buildMailboxImapSuccessUpdate,
  transientBackoffMinutes,
} from './imapSchedule.ts';

const NOW = '2026-07-22T15:00:00.000Z';

test('transientBackoffMinutes follows 1m → 5m → 15m → 60m and caps', () => {
  assert.equal(transientBackoffMinutes(1), 1);
  assert.equal(transientBackoffMinutes(2), 5);
  assert.equal(transientBackoffMinutes(3), 15);
  assert.equal(transientBackoffMinutes(4), 60);
  assert.equal(transientBackoffMinutes(99), 60);
});

test('buildMailboxImapSuccessUpdate advances schedule and clears errors', () => {
  assert.deepEqual(buildMailboxImapSuccessUpdate(NOW), {
    last_synced_at: NOW,
    imap_claimed_at: null,
    imap_last_attempt_at: NOW,
    imap_next_check_at: addMinutes(NOW, IMAP_CHECK_INTERVAL_MINUTES),
    imap_consecutive_failures: 0,
    imap_last_error_code: null,
    error_message: null,
  });
});

test('buildMailboxImapFailureUpdate keeps transient failures connected with backoff', () => {
  const update = buildMailboxImapFailureUpdate({
    kind: 'transient',
    message: 'IMAP connection failed',
    consecutiveFailures: 0,
    errorCode: 'ECONNREFUSED',
    now: NOW,
  });

  assert.equal(update.status, undefined);
  assert.equal(update.imap_consecutive_failures, 1);
  assert.equal(update.imap_last_error_code, 'ECONNREFUSED');
  assert.equal(update.imap_next_check_at, addMinutes(NOW, 1));
  assert.equal(update.imap_claimed_at, null);
});

test('buildMailboxImapFailureUpdate promotes sustained transients to error', () => {
  const update = buildMailboxImapFailureUpdate({
    kind: 'transient',
    message: 'IMAP connection failed',
    consecutiveFailures: IMAP_TRANSIENT_PROMOTE_AFTER - 1,
    errorCode: 'ECONNREFUSED',
    now: NOW,
  });

  assert.equal(update.status, 'error');
  assert.equal(update.imap_consecutive_failures, IMAP_TRANSIENT_PROMOTE_AFTER);
  assert.equal(update.imap_next_check_at, null);
});

test('buildMailboxImapFailureUpdate demotes permanent failures immediately', () => {
  const update = buildMailboxImapFailureUpdate({
    kind: 'permanent',
    message: 'bad creds',
    consecutiveFailures: 0,
    now: NOW,
  });

  assert.equal(update.status, 'error');
  assert.equal(update.imap_consecutive_failures, 1);
  assert.equal(update.imap_next_check_at, null);
});

test('buildMailboxImapRestoreUpdate re-enters hot path immediately', () => {
  assert.deepEqual(buildMailboxImapRestoreUpdate(NOW), {
    status: 'connected',
    error_message: null,
    imap_claimed_at: null,
    imap_consecutive_failures: 0,
    imap_last_error_code: null,
    imap_next_check_at: NOW,
    imap_last_recovery_at: NOW,
  });
});
