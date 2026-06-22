import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMailboxConnectionHealthUpdate,
  mailboxToTestMailboxConnectionParams,
} from './connectionHealth.ts';

test('mailboxToTestMailboxConnectionParams maps stored mailbox credentials into test params', () => {
  const params = mailboxToTestMailboxConnectionParams({
    smtp_host: 'smtp.example.com',
    smtp_port: 587,
    smtp_username: 'smtp-user',
    smtp_password: 'smtp-pass',
    smtp_use_tls: true,
    smtp_use_ssl: false,
    imap_host: 'imap.example.com',
    imap_port: 993,
    imap_username: 'imap-user',
    imap_password: 'imap-pass',
    imap_use_ssl: true,
  } as any);

  assert.deepEqual(params, {
    smtp_host: 'smtp.example.com',
    smtp_port: 587,
    smtp_username: 'smtp-user',
    smtp_password: 'smtp-pass',
    smtp_use_tls: true,
    smtp_use_ssl: false,
    imap_host: 'imap.example.com',
    imap_port: 993,
    imap_username: 'imap-user',
    imap_password: 'imap-pass',
    imap_use_ssl: true,
  });
});

test('buildMailboxConnectionHealthUpdate marks both protocols healthy when test fully passes', () => {
  assert.deepEqual(
    buildMailboxConnectionHealthUpdate({
      success: true,
      message: 'Both SMTP and IMAP connections successful',
      smtp: { success: true },
      imap: { success: true },
    }),
    {
      status: 'connected',
      smtp_status: 'active',
      error_message: null,
    },
  );
});

test('buildMailboxConnectionHealthUpdate marks IMAP failures as mailbox error', () => {
  assert.deepEqual(
    buildMailboxConnectionHealthUpdate({
      success: false,
      message: 'Connection test failed: IMAP: bad creds',
      smtp: { success: true },
      imap: { success: false, error: 'bad creds' },
    }),
    {
      status: 'error',
      smtp_status: 'active',
      error_message: 'Connection test failed: IMAP: bad creds',
    },
  );
});

test('buildMailboxConnectionHealthUpdate marks SMTP failures without disconnecting IMAP', () => {
  assert.deepEqual(
    buildMailboxConnectionHealthUpdate({
      success: false,
      message: 'Connection test failed: SMTP: auth failed',
      smtp: { success: false, error: 'auth failed' },
      imap: { success: true },
    }),
    {
      status: 'connected',
      smtp_status: 'error',
      error_message: 'Connection test failed: SMTP: auth failed',
    },
  );
});
