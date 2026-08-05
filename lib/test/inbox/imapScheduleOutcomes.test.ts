import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyMailboxImapFailureUpdate,
  applyMailboxImapSuccessUpdate,
} from '../../mailbox/connectionErrors.ts';
import { buildMailboxImapRestoreUpdate } from '../../mailbox/imapSchedule.ts';
import { loadCampaignHarnessEnv } from '../campaign/harness.ts';
import { createCampaignTestNamespace } from '../campaign/fixtures.ts';
import { ImapScheduleHarness } from './imapScheduleHarness.ts';

test('imap fair schedule: claim order, backoff, promote, recovery, success cadence, permanent demotion', async () => {
  // Ensure env is loadable (same as campaign outcomes).
  loadCampaignHarnessEnv();

  const harness = new ImapScheduleHarness(createCampaignTestNamespace('imap-sched'));
  const epoch = new Date('1970-01-01T00:00:00.000Z');
  const deadDue = new Date(epoch.getTime()).toISOString();
  const healthyADue = new Date(epoch.getTime() + 60_000).toISOString();
  const healthyBDue = new Date(epoch.getTime() + 120_000).toISOString();
  // Wall-clock: claim_mailboxes_to_check compares imap_next_check_at to Postgres NOW().
  const now = new Date().toISOString();

  let deadId = '';
  let healthyAId = '';
  let healthyBId = '';

  try {
    await harness.setupAccount();
    deadId = await harness.createMailbox({ key: 'dead', nextCheckAt: deadDue });
    healthyAId = await harness.createMailbox({ key: 'healthy-a', nextCheckAt: healthyADue });
    healthyBId = await harness.createMailbox({ key: 'healthy-b', nextCheckAt: healthyBDue });

    // 1-2: fair due order among our mailboxes (epoch dues put us at the front of the global queue).
    const firstClaim = await harness.claimHot(2);
    assert.deepEqual(
      firstClaim.map((row) => row.id),
      [deadId, healthyAId],
      'claim should return due mailboxes in imap_next_check_at order',
    );

    // 3: transient failure on dead advances schedule (backoff).
    await harness.applyUpdate(
      deadId,
      applyMailboxImapFailureUpdate('transient', 'IMAP connection failed', {
        consecutiveFailures: 0,
        errorCode: 'ECONNREFUSED',
        now,
      }),
    );
    const deadAfterTransient = await harness.loadMailbox(deadId);
    assert.equal(deadAfterTransient.status, 'connected');
    assert.equal(deadAfterTransient.imap_consecutive_failures, 1);
    assert.ok(deadAfterTransient.imap_next_check_at);
    assert.ok(new Date(deadAfterTransient.imap_next_check_at!).getTime() > Date.parse(now));
    assert.ok(
      Date.parse(deadAfterTransient.imap_next_check_at!) > Date.now(),
      'backoff next_check must be after wall clock so claim RPC excludes it',
    );

    // Release healthyA claim so later claims are not blocked by lock timeout semantics in assertions.
    await harness.releaseClaim(healthyAId);

    // 4: dead is absent; healthyB (still due) is claimable.
    const secondClaim = await harness.claimHot(50);
    const secondIds = new Set(secondClaim.map((row) => row.id));
    assert.equal(secondIds.has(deadId), false, 'dead mailbox must leave hot path during backoff');
    assert.equal(secondIds.has(healthyBId), true, 'healthy due mailbox must be claimable');

    // 5: promote after sustained transients.
    let streak = 1;
    while (streak < 5) {
      await harness.applyUpdate(
        deadId,
        applyMailboxImapFailureUpdate('transient', 'IMAP connection failed', {
          consecutiveFailures: streak,
          errorCode: 'ECONNREFUSED',
          now,
        }),
      );
      streak += 1;
    }
    const deadPromoted = await harness.loadMailbox(deadId);
    assert.equal(deadPromoted.status, 'error');
    assert.equal(deadPromoted.imap_consecutive_failures, 5);
    assert.equal(deadPromoted.imap_next_check_at, null);

    // 6: hot claim never returns dead.
    await harness.releaseClaim(healthyAId);
    await harness.releaseClaim(healthyBId);
    const hotAfterPromote = await harness.claimHot(50);
    assert.equal(hotAfterPromote.some((row) => row.id === deadId), false);

    // 7: recovery claim returns dead.
    const recoveryClaim = await harness.claimRecovery(100);
    assert.equal(recoveryClaim.some((row) => row.id === deadId), true);

    // 8: recovery restore re-enters hot path.
    await harness.applyUpdate(deadId, {
      ...buildMailboxImapRestoreUpdate(now),
      // Keep due-time at epoch so this mailbox stays ahead of pre-existing fleet backlog.
      imap_next_check_at: deadDue,
    });
    const deadRestored = await harness.loadMailbox(deadId);
    assert.equal(deadRestored.status, 'connected');
    assert.equal(deadRestored.imap_consecutive_failures, 0);
    assert.equal(Date.parse(deadRestored.imap_next_check_at!), Date.parse(deadDue));

    // 9: hot claim returns dead again.
    await harness.releaseClaim(healthyAId);
    await harness.releaseClaim(healthyBId);
    const hotAfterRestore = await harness.claimHot(50);
    assert.equal(hotAfterRestore.some((row) => row.id === deadId), true);

    // 10: success advances cadence.
    await harness.applyUpdate(deadId, applyMailboxImapSuccessUpdate(now));
    const deadSuccess = await harness.loadMailbox(deadId);
    assert.equal(Date.parse(deadSuccess.last_synced_at!), Date.parse(now));
    assert.equal(deadSuccess.imap_consecutive_failures, 0);
    assert.ok(deadSuccess.imap_next_check_at);
    assert.ok(new Date(deadSuccess.imap_next_check_at!).getTime() > Date.parse(now));

    // 11: not due while next_check is future.
    await harness.releaseClaim(healthyAId);
    await harness.releaseClaim(healthyBId);
    const hotAfterSuccess = await harness.claimHot(50);
    assert.equal(hotAfterSuccess.some((row) => row.id === deadId), false);

    // 12: permanent demotion is immediate.
    await harness.applyUpdate(
      healthyBId,
      applyMailboxImapFailureUpdate('permanent', 'Command failed — NO Authentication failed', {
        consecutiveFailures: 0,
        now,
      }),
    );
    const healthyBFinal = await harness.loadMailbox(healthyBId);
    assert.equal(healthyBFinal.status, 'error');
    assert.equal(healthyBFinal.imap_consecutive_failures, 1);
    assert.equal(healthyBFinal.imap_next_check_at, null);

    await harness.releaseClaim(healthyAId);
    const hotAfterPermanent = await harness.claimHot(50);
    assert.equal(hotAfterPermanent.some((row) => row.id === healthyBId), false);
  } finally {
    // Best-effort release before delete.
    for (const id of [deadId, healthyAId, healthyBId]) {
      if (id) {
        try {
          await harness.releaseClaim(id);
        } catch {
          // ignore
        }
      }
    }
    await harness.cleanup();
  }
});
