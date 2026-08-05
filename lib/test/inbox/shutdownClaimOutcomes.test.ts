/**
 * Mailbox claim recoverability after interrupted inbox-checker work.
 *
 * Complements imapScheduleOutcomes: a stale imap_claimed_at (worker died mid-check)
 * must become eligible again after the processing timeout.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCampaignHarnessEnv } from '../campaign/harness.ts';
import { createCampaignTestNamespace } from '../campaign/fixtures.ts';
import { ImapScheduleHarness } from './imapScheduleHarness.ts';

test('stale imap mailbox claims become eligible again after processing timeout', async () => {
  loadCampaignHarnessEnv();

  const harness = new ImapScheduleHarness(createCampaignTestNamespace('imap-claim-reclaim'));
  const now = Date.now();
  // Epoch next_check keeps this mailbox ahead of shared-account fleet backlog in claim order.
  const nextCheckAt = new Date('1970-01-01T00:00:00.000Z').toISOString();
  const staleClaimedAt = new Date(now - 15 * 60_000).toISOString();

  try {
    await harness.setupAccount();
    const mailboxId = await harness.createMailbox({
      key: 'stale',
      nextCheckAt,
      claimedAt: staleClaimedAt,
    });

    const claimed = await harness.claimHot(50);
    assert.equal(
      claimed.some((row) => row.id === mailboxId),
      true,
      'stale imap claim must become eligible again after processing timeout',
    );
  } finally {
    await harness.cleanup();
  }
});
