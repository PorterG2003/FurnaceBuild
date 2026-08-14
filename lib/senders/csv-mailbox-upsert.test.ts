import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildExistingMailboxEmailIndex,
  partitionMailboxCsvRows,
  rowToMailboxInsert,
  rowToMailboxUpdate,
  type ExistingMailboxForUpsert,
} from './csv-mailbox-upsert';

function mailbox(
  overrides: Partial<ExistingMailboxForUpsert> & Pick<ExistingMailboxForUpsert, 'id' | 'email_address'>
): ExistingMailboxForUpsert {
  return {
    created_at: '2026-01-01T00:00:00.000Z',
    deleted_at: null,
    ...overrides,
  };
}

const fullRow = {
  from_email: 'new@example.com',
  from_name: 'Pat',
  user_name: 'smtp-user',
  password: 'smtp-pass',
  smtp_host: 'smtp.example.com',
  smtp_port: '587',
  imap_host: 'imap.example.com',
  imap_port: '993',
  max_email_per_day: '50',
  signature: 'Thanks',
  imap_user_name: 'imap-user',
  imap_password: 'imap-pass',
};

test('partitionMailboxCsvRows is case-insensitive on from_email', () => {
  const existing = [mailbox({ id: 'mb-1', email_address: 'Pat@Example.com' })];
  const { toCreate, toUpdate } = partitionMailboxCsvRows(
    [{ ...fullRow, from_email: 'pat@example.com' }],
    existing
  );
  assert.equal(toCreate.length, 0);
  assert.equal(toUpdate.length, 1);
  assert.equal(toUpdate[0]?.mailboxId, 'mb-1');
});

test('partitionMailboxCsvRows updates the oldest mailbox when emails collide', () => {
  const existing = [
    mailbox({ id: 'newer', email_address: 'a@example.com', created_at: '2026-06-01T00:00:00.000Z' }),
    mailbox({ id: 'older', email_address: 'a@example.com', created_at: '2026-01-01T00:00:00.000Z' }),
  ];
  const { toUpdate } = partitionMailboxCsvRows([{ ...fullRow, from_email: 'a@example.com' }], existing);
  assert.equal(toUpdate[0]?.mailboxId, 'older');
});

test('partitionMailboxCsvRows ignores soft-deleted mailboxes', () => {
  const existing = [
    mailbox({
      id: 'deleted',
      email_address: 'a@example.com',
      deleted_at: '2026-07-01T00:00:00.000Z',
    }),
  ];
  const { toCreate, toUpdate } = partitionMailboxCsvRows(
    [{ ...fullRow, from_email: 'a@example.com' }],
    existing
  );
  assert.equal(toUpdate.length, 0);
  assert.equal(toCreate.length, 1);
});

test('buildExistingMailboxEmailIndex skips deleted and keeps oldest', () => {
  const index = buildExistingMailboxEmailIndex([
    mailbox({
      id: 'deleted',
      email_address: 'a@example.com',
      created_at: '2025-01-01T00:00:00.000Z',
      deleted_at: '2026-01-01T00:00:00.000Z',
    }),
    mailbox({ id: 'newer', email_address: 'A@example.com', created_at: '2026-06-01T00:00:00.000Z' }),
    mailbox({ id: 'older', email_address: 'a@example.com', created_at: '2026-02-01T00:00:00.000Z' }),
  ]);
  assert.equal(index.get('a@example.com'), 'older');
});

test('partitionMailboxCsvRows sends unmatched emails to create', () => {
  const { toCreate, toUpdate } = partitionMailboxCsvRows(
    [fullRow, { ...fullRow, from_email: 'existing@example.com' }],
    [mailbox({ id: 'mb-1', email_address: 'existing@example.com' })]
  );
  assert.deepEqual(
    toCreate.map((row) => row.from_email),
    ['new@example.com']
  );
  assert.equal(toUpdate.length, 1);
  assert.equal(toUpdate[0]?.mailboxId, 'mb-1');
});

test('rowToMailboxInsert applies IMAP fallbacks and TLS defaults', () => {
  const insert = rowToMailboxInsert(
    {
      from_email: 'you@example.com',
      user_name: 'you@example.com',
      password: 'secret',
      smtp_host: 'smtp.example.com',
      smtp_port: '587',
      imap_host: 'imap.example.com',
      imap_port: '993',
    },
    'acct-1',
    'user-1'
  );
  assert.equal(insert.imap_username, 'you@example.com');
  assert.equal(insert.imap_password, 'secret');
  assert.equal(insert.smtp_use_tls, true);
  assert.equal(insert.smtp_use_ssl, false);
  assert.equal(insert.imap_use_ssl, true);
  assert.equal(insert.status, 'connected');
  assert.equal(insert.display_name, null);
  assert.equal(insert.daily_limit, null);
});

test('rowToMailboxUpdate omits blank optional fields', () => {
  const patch = rowToMailboxUpdate({
    from_email: 'you@example.com',
    from_name: '',
    signature: '  ',
    max_email_per_day: '',
    user_name: 'smtp-user',
    password: 'smtp-pass',
    smtp_host: 'smtp.example.com',
    smtp_port: '587',
    imap_host: 'imap.example.com',
    imap_port: '993',
    imap_user_name: '',
    imap_password: '',
  });
  assert.equal('display_name' in patch, false);
  assert.equal('signature' in patch, false);
  assert.equal('daily_limit' in patch, false);
  assert.equal('imap_username' in patch, false);
  assert.equal('imap_password' in patch, false);
  assert.equal(patch.smtp_username, 'smtp-user');
  assert.equal(patch.smtp_password, 'smtp-pass');
  assert.equal(patch.smtp_host, 'smtp.example.com');
  assert.equal(patch.smtp_port, 587);
  assert.equal(patch.imap_host, 'imap.example.com');
  assert.equal(patch.imap_port, 993);
});

test('rowToMailboxUpdate does not write status, TLS flags, or IMAP fallbacks', () => {
  const patch = rowToMailboxUpdate({
    from_email: 'you@example.com',
    user_name: 'smtp-user',
    password: 'smtp-pass',
    smtp_host: 'smtp.example.com',
    smtp_port: '587',
    imap_host: 'imap.example.com',
    imap_port: '993',
  });
  assert.equal('status' in patch, false);
  assert.equal('error_message' in patch, false);
  assert.equal('smtp_use_tls' in patch, false);
  assert.equal('smtp_use_ssl' in patch, false);
  assert.equal('imap_use_ssl' in patch, false);
  assert.equal('imap_username' in patch, false);
  assert.equal('imap_password' in patch, false);
  assert.equal('account_id' in patch, false);
  assert.equal('user_id' in patch, false);
  assert.equal('email_address' in patch, false);
  assert.equal('provider' in patch, false);
});

test('rowToMailboxUpdate includes non-blank optional fields without IMAP fallback', () => {
  const patch = rowToMailboxUpdate({
    ...fullRow,
    from_email: 'you@example.com',
  });
  assert.equal(patch.display_name, 'Pat');
  assert.equal(patch.signature, 'Thanks');
  assert.equal(patch.daily_limit, 50);
  assert.equal(patch.imap_username, 'imap-user');
  assert.equal(patch.imap_password, 'imap-pass');
  assert.notEqual(patch.imap_username, patch.smtp_username);
});
