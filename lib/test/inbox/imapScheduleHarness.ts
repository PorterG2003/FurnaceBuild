import { randomUUID } from 'node:crypto';
import {
  CampaignDbHarness,
} from '../campaign/harness.ts';

export type ImapMailboxRow = {
  id: string;
  email_address: string;
  status: string;
  imap_next_check_at: string | null;
  imap_consecutive_failures: number;
  imap_claimed_at: string | null;
  last_synced_at: string | null;
  error_message: string | null;
};

/**
 * Isolated account + mailbox graph for IMAP claim/schedule outcome tests.
 * Filters claim RPC results to mailboxes created by this harness.
 */
export class ImapScheduleHarness {
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
    /** Defaults to null (unclaimed). Pass a stale ISO timestamp to simulate an interrupted check. */
    claimedAt?: string | null;
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
      imap_claimed_at: params.claimedAt ?? null,
      error_message: null,
      created_at: now,
      updated_at: now,
    } as any);
    if (error) throw new Error(`imap schedule harness: mailbox insert failed: ${error.message}`);
    this.mailboxIds.push(id);
    return id;
  }

  async claimHot(batchSize = 50): Promise<ImapMailboxRow[]> {
    const { data, error } = await this.supabase.rpc('claim_mailboxes_to_check', {
      p_batch_size: batchSize,
      p_check_interval_minutes: 5,
      p_processing_timeout_minutes: 10,
    });
    if (error) throw new Error(`claim_mailboxes_to_check failed: ${error.message}`);
    const ours = new Set(this.mailboxIds);
    return ((data ?? []) as ImapMailboxRow[]).filter((row) => ours.has(row.id));
  }

  async claimRecovery(batchSize = 100): Promise<ImapMailboxRow[]> {
    const { data, error } = await this.supabase.rpc('claim_mailboxes_for_imap_recovery', {
      p_batch_size: batchSize,
      p_cooldown_hours: 24,
      p_processing_timeout_minutes: 10,
    });
    if (error) throw new Error(`claim_mailboxes_for_imap_recovery failed: ${error.message}`);
    const ours = new Set(this.mailboxIds);
    return ((data ?? []) as ImapMailboxRow[]).filter((row) => ours.has(row.id));
  }

  async applyUpdate(mailboxId: string, updates: Record<string, unknown>): Promise<void> {
    const { error } = await this.supabase
      .from('mailboxes')
      .update(updates as any)
      .eq('id', mailboxId);
    if (error) throw new Error(`mailbox update failed: ${error.message}`);
  }

  async loadMailbox(mailboxId: string): Promise<ImapMailboxRow> {
    const { data, error } = await this.supabase
      .from('mailboxes')
      .select('id, email_address, status, imap_next_check_at, imap_consecutive_failures, imap_claimed_at, last_synced_at, error_message')
      .eq('id', mailboxId)
      .single();
    if (error || !data) throw new Error(`load mailbox failed: ${error?.message ?? 'missing'}`);
    return data as ImapMailboxRow;
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
