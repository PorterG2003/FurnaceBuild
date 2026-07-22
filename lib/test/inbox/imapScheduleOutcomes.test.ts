import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  applyMailboxImapFailureUpdate,
  applyMailboxImapSuccessUpdate,
} from '../../mailbox/connectionErrors.ts';
import { buildMailboxImapRestoreUpdate } from '../../mailbox/imapSchedule.ts';
import {
  CampaignDbHarness,
  loadCampaignHarnessEnv,
} from '../campaign/harness.ts';
import { createCampaignTestNamespace } from '../campaign/fixtures.ts';

type MailboxRow = {
  id: string;
  email_address: string;
  status: string;
  imap_next_check_at: string | null;
  imap_consecutive_failures: number;
  imap_claimed_at: string | null;
  last_synced_at: string | null;
  error_message: string | null;
};

class ImapScheduleHarness {
  readonly namespace: string;
  readonly campaignHarness: CampaignDbHarness;
  readonly accountId: string;
  readonly ownerUserId: string;
  readonly mailboxIds: string[] = [];
  private accountCreated = false;

  constructor(namespace: string) {
    this.namespace = namespace;
    this.campaignHarness = new CampaignDbHarness({ namespace });
    this.accountId = randomUUID();
    this.ownerUserId = randomUUID();
  }

  get supabase() {
    return this.campaignHarness.supabase;
  }

  async setupAccount(): Promise<void> {
    const now = new Date().toISOString();
    const ownerEmail = `imap-sched-owner-${this.namespace}@furnace.test`;
    const { error: userError } = await this.supabase.from('users').insert({
      id: this.ownerUserId,
      external_id: this.ownerUserId,
      email: ownerEmail,
      name: 'IMAP Schedule Test Owner',
      created_at: now,
      updated_at: now,
    } as any);
    if (userError) throw new Error(`imap schedule harness: user insert failed: ${userError.message}`);

    const { error: accountError } = await this.supabase.from('accounts').insert({
      id: this.accountId,
      name: `IMAP Schedule ${this.namespace}`,
      created_at: now,
      updated_at: now,
    } as any);
    if (accountError) throw new Error(`imap schedule harness: account insert failed: ${accountError.message}`);
    this.accountCreated = true;

    const { error: membershipError } = await this.supabase.from('account_users').insert({
      id: randomUUID(),
      account_id: this.accountId,
      user_id: this.ownerUserId,
      is_owner: true,
      role: 'owner',
      created_at: now,
      updated_at: now,
    } as any);
    if (membershipError) {
      throw new Error(`imap schedule harness: membership insert failed: ${membershipError.message}`);
    }
  }

  async createMailbox(params: {
    key: string;
    nextCheckAt: string;
  }): Promise<string> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const email = `${params.key}-${this.namespace}@imap-sched.test`;
    const { error } = await this.supabase.from('mailboxes').insert({
      id,
      account_id: this.accountId,
      user_id: this.ownerUserId,
      email_address: email,
      display_name: params.key,
      provider: 'custom',
      smtp_host: 'smtp.example.com',
      smtp_port: 587,
      smtp_username: email,
      smtp_password: 'secret',
      smtp_use_tls: true,
      smtp_use_ssl: false,
      smtp_status: 'active',
      imap_host: `${params.key}.example.com`,
      imap_port: 993,
      imap_username: email,
      imap_password: 'secret',
      imap_use_ssl: true,
      status: 'connected',
      last_synced_at: null,
      imap_next_check_at: params.nextCheckAt,
      imap_last_attempt_at: null,
      imap_consecutive_failures: 0,
      imap_last_error_code: null,
      imap_claimed_at: null,
      error_message: null,
      created_at: now,
      updated_at: now,
    } as any);
    if (error) throw new Error(`imap schedule harness: mailbox insert failed: ${error.message}`);
    this.mailboxIds.push(id);
    return id;
  }

  async claimHot(batchSize = 50): Promise<MailboxRow[]> {
    const { data, error } = await this.supabase.rpc('claim_mailboxes_to_check', {
      p_batch_size: batchSize,
      p_check_interval_minutes: 5,
      p_processing_timeout_minutes: 10,
    });
    if (error) throw new Error(`claim_mailboxes_to_check failed: ${error.message}`);
    const ours = new Set(this.mailboxIds);
    return ((data ?? []) as MailboxRow[]).filter((row) => ours.has(row.id));
  }

  async claimRecovery(batchSize = 100): Promise<MailboxRow[]> {
    const { data, error } = await this.supabase.rpc('claim_mailboxes_for_imap_recovery', {
      p_batch_size: batchSize,
      p_cooldown_hours: 24,
      p_processing_timeout_minutes: 10,
    });
    if (error) throw new Error(`claim_mailboxes_for_imap_recovery failed: ${error.message}`);
    const ours = new Set(this.mailboxIds);
    return ((data ?? []) as MailboxRow[]).filter((row) => ours.has(row.id));
  }

  async applyUpdate(mailboxId: string, updates: Record<string, unknown>): Promise<void> {
    const { error } = await this.supabase
      .from('mailboxes')
      .update(updates as any)
      .eq('id', mailboxId);
    if (error) throw new Error(`mailbox update failed: ${error.message}`);
  }

  async loadMailbox(mailboxId: string): Promise<MailboxRow> {
    const { data, error } = await this.supabase
      .from('mailboxes')
      .select('id, email_address, status, imap_next_check_at, imap_consecutive_failures, imap_claimed_at, last_synced_at, error_message')
      .eq('id', mailboxId)
      .single();
    if (error || !data) throw new Error(`load mailbox failed: ${error?.message ?? 'missing'}`);
    return data as MailboxRow;
  }

  async releaseClaim(mailboxId: string): Promise<void> {
    await this.applyUpdate(mailboxId, { imap_claimed_at: null });
  }

  async cleanup(): Promise<void> {
    if (this.mailboxIds.length > 0) {
      await this.supabase.from('mailboxes').delete().in('id', this.mailboxIds);
    }
    if (this.accountCreated) {
      await this.supabase.from('account_users').delete().eq('account_id', this.accountId);
      await this.supabase.from('accounts').delete().eq('id', this.accountId);
    }
    await this.supabase.from('users').delete().eq('id', this.ownerUserId);
  }
}

test('imap fair schedule: claim order, backoff, promote, recovery, success cadence, permanent demotion', async () => {
  // Ensure env is loadable (same as campaign outcomes).
  loadCampaignHarnessEnv();

  const harness = new ImapScheduleHarness(createCampaignTestNamespace('imap-sched'));
  const epoch = new Date('1970-01-01T00:00:00.000Z');
  const deadDue = new Date(epoch.getTime()).toISOString();
  const healthyADue = new Date(epoch.getTime() + 60_000).toISOString();
  const healthyBDue = new Date(epoch.getTime() + 120_000).toISOString();
  const now = '2026-07-22T15:00:00.000Z';

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
