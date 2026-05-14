import test from 'node:test';
import assert from 'node:assert/strict';
import type { Mailbox } from '../types';
import { getMailboxOverviewUtcKeys, mergeMailboxOverviewData } from './mailboxes-core';

function createMailbox(overrides: Partial<Mailbox> & Pick<Mailbox, 'id' | 'email_address'>): Mailbox {
  return {
    id: overrides.id,
    account_id: overrides.account_id ?? 'account-1',
    user_id: overrides.user_id ?? 'user-1',
    email_address: overrides.email_address,
    display_name: overrides.display_name ?? null,
    signature: overrides.signature ?? null,
    provider: overrides.provider ?? 'custom',
    smtp_host: overrides.smtp_host ?? 'smtp.example.com',
    smtp_port: overrides.smtp_port ?? 587,
    smtp_username: overrides.smtp_username ?? overrides.email_address,
    smtp_password: overrides.smtp_password ?? 'secret',
    smtp_use_tls: overrides.smtp_use_tls ?? true,
    smtp_use_ssl: overrides.smtp_use_ssl ?? false,
    imap_host: overrides.imap_host ?? 'imap.example.com',
    imap_port: overrides.imap_port ?? 993,
    imap_username: overrides.imap_username ?? overrides.email_address,
    imap_password: overrides.imap_password ?? 'secret',
    imap_use_ssl: overrides.imap_use_ssl ?? true,
    status: overrides.status ?? 'connected',
    last_synced_at: overrides.last_synced_at ?? null,
    error_message: overrides.error_message ?? null,
    min_gap_seconds: overrides.min_gap_seconds ?? null,
    daily_limit: overrides.daily_limit ?? null,
    hourly_limit: overrides.hourly_limit ?? null,
    deleted_at: overrides.deleted_at ?? null,
    created_at: overrides.created_at ?? '2026-05-13T10:00:00.000Z',
    updated_at: overrides.updated_at ?? '2026-05-13T10:00:00.000Z',
  };
}

test('getMailboxOverviewUtcKeys returns UTC date and hour keys', () => {
  const keys = getMailboxOverviewUtcKeys(new Date('2026-05-13T19:45:00.000Z'));
  assert.deepEqual(keys, { date: '2026-05-13', hourKey: '19' });
});

test('mergeMailboxOverviewData merges throttle counts and active campaign counts', () => {
  const now = new Date('2026-05-13T19:45:00.000Z');
  const mailboxes = [
    createMailbox({
      id: 'mailbox-1',
      email_address: 'primary@example.com',
      daily_limit: 75,
      hourly_limit: 15,
      min_gap_seconds: 120,
    }),
    createMailbox({
      id: 'mailbox-2',
      email_address: 'secondary@example.com',
    }),
  ];

  const merged = mergeMailboxOverviewData(
    mailboxes,
    [
      {
        mailbox_id: 'mailbox-1',
        sent_count: '23',
        hourly_sent: { '19': '4', '18': 3 },
        last_sent_at: '2026-05-13T19:10:00.000Z',
      },
    ],
    [
      { mailbox_id: 'mailbox-1' },
      { mailbox_id: 'mailbox-1' },
      { mailbox_id: 'mailbox-2' },
    ],
    now
  );

  assert.equal(merged[0]?.effectiveDailyLimit, 75);
  assert.equal(merged[0]?.effectiveHourlyLimit, 15);
  assert.equal(merged[0]?.effectiveMinGapSeconds, 120);
  assert.equal(merged[0]?.throttleTodaySent, 23);
  assert.equal(merged[0]?.throttleThisHourSent, 4);
  assert.equal(merged[0]?.throttleLastSentAt, '2026-05-13T19:10:00.000Z');
  assert.equal(merged[0]?.activeCampaignCount, 2);

  assert.equal(merged[1]?.effectiveDailyLimit, 50);
  assert.equal(merged[1]?.effectiveHourlyLimit, 10);
  assert.equal(merged[1]?.effectiveMinGapSeconds, 180);
  assert.equal(merged[1]?.throttleTodaySent, 0);
  assert.equal(merged[1]?.throttleThisHourSent, 0);
  assert.equal(merged[1]?.throttleLastSentAt, null);
  assert.equal(merged[1]?.activeCampaignCount, 1);
});
