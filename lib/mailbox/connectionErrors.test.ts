import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyMailboxImapFailureUpdate,
  applyMailboxImapSuccessUpdate,
  applyMailboxSmtpFailureUpdate,
  classifyImapError,
  classifySmtpError,
  formatImapError,
} from './connectionErrors.js';

test('classifyImapError treats Exchange LSUB BAD as transient', () => {
  const result = classifyImapError({
    message: 'Command failed',
    responseStatus: 'BAD',
    responseText: 'Command Argument Error. 12',
    executedCommand: '5 LSUB "" "INBOX"',
  });

  assert.equal(result.kind, 'transient');
});

test('classifyImapError treats Command failed NO responses as permanent', () => {
  const result = classifyImapError({
    message: 'Command failed',
    responseStatus: 'NO',
    responseText: 'Authentication failed',
    executedCommand: 'LOGIN',
  });

  assert.equal(result.kind, 'permanent');
  assert.match(result.message, /Command failed/);
});

test('classifyImapError treats ENOTFOUND as permanent', () => {
  const result = classifyImapError({
    message: 'getaddrinfo ENOTFOUND imap.example.com',
    code: 'ENOTFOUND',
  });

  assert.equal(result.kind, 'permanent');
});

test('classifyImapError treats ETIMEDOUT as transient', () => {
  const result = classifyImapError({
    message: 'Connection timed out',
    code: 'ETIMEDOUT',
  });

  assert.equal(result.kind, 'transient');
});

test('classifyImapError treats ImapFlow socket timeout as transient', () => {
  const result = classifyImapError({
    message: 'Socket timeout',
    code: 'ETIMEOUT',
  });

  assert.equal(result.kind, 'transient');
});

test('classifyImapError treats TLS bad record mac as transient', () => {
  const result = classifyImapError({
    message: '4842488BAB7F0000:error:0A000119:SSL routines:ssl3_get_record:decryption failed or bad record mac',
  });

  assert.equal(result.kind, 'transient');
});

test('classifySmtpError treats EAUTH as permanent', () => {
  const result = classifySmtpError({
    message: 'Invalid login',
    code: 'EAUTH',
  });

  assert.equal(result.kind, 'permanent');
});

test('formatImapError includes response context in the message', () => {
  const formatted = formatImapError(
    {
      message: 'Command failed',
      responseStatus: 'NO',
      responseText: 'Authentication failed',
      executedCommand: 'LOGIN',
    },
    {
      stage: 'connect',
      host: 'imap.example.com',
      port: 993,
      secure: true,
      sameHostAsSmtp: false,
      samePortAsSmtp: false,
    },
  );

  assert.equal(formatted.details?.responseStatus, 'NO');
  assert.equal(formatted.details?.executedCommand, 'LOGIN');
  assert.match(formatted.error, /Authentication failed/);
});

test('applyMailboxImapSuccessUpdate clears stale IMAP errors after a good check', () => {
  const syncedAt = '2026-07-09T23:00:00.000Z';
  assert.deepEqual(applyMailboxImapSuccessUpdate(syncedAt), {
    last_synced_at: syncedAt,
    imap_claimed_at: null,
    error_message: null,
  });
});

test('mailbox failure patch helpers only disable permanent failures', () => {
  assert.deepEqual(applyMailboxImapFailureUpdate('permanent', 'bad creds'), {
    status: 'error',
    error_message: 'bad creds',
    imap_claimed_at: null,
  });
  assert.deepEqual(applyMailboxImapFailureUpdate('transient', 'timeout'), {
    error_message: 'timeout',
    imap_claimed_at: null,
  });
  assert.deepEqual(applyMailboxSmtpFailureUpdate('permanent', 'bad creds'), {
    smtp_status: 'error',
    error_message: 'bad creds',
  });
  assert.equal(applyMailboxSmtpFailureUpdate('transient', 'timeout'), null);
});
