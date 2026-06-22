import test from 'node:test';
import assert from 'node:assert/strict';
import { runImapRecoveryTick } from './imap-recovery.js';
import type { Mailbox } from './types.js';

type RecordedCall = {
  table: string;
  updates: Record<string, unknown> | null;
  filters: Array<{ op: string; column: string; value: unknown }>;
};

class MutationStub implements PromiseLike<{ data: any; error: any }> {
  constructor(
    private readonly call: RecordedCall,
    private readonly result: { data: any; error: any } = { data: null, error: null },
  ) {}

  update(payload: Record<string, unknown>) {
    this.call.updates = payload;
    return this;
  }

  eq(column: string, value: unknown) {
    this.call.filters.push({ op: 'eq', column, value });
    return this;
  }

  then<TResult1 = { data: any; error: any }, TResult2 = never>(
    onfulfilled?: ((value: { data: any; error: any }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onfulfilled ?? undefined, onrejected ?? undefined);
  }
}

class TrackingSupabase {
  readonly calls: RecordedCall[] = [];

  from(table: string) {
    const call: RecordedCall = {
      table,
      updates: null,
      filters: [],
    };
    this.calls.push(call);
    return new MutationStub(call);
  }
}

function createMailbox(overrides: Partial<Mailbox> = {}): Mailbox {
  return {
    id: 'mailbox-1',
    account_id: 'account-1',
    user_id: 'user-1',
    email_address: 'sender@example.com',
    display_name: 'Sender',
    provider: 'custom',
    smtp_host: 'smtp.example.com',
    smtp_port: 587,
    smtp_username: 'sender',
    smtp_password: 'secret',
    smtp_use_tls: true,
    smtp_use_ssl: false,
    imap_host: 'proxy.example.com',
    imap_port: 993,
    imap_username: 'sender',
    imap_password: 'secret',
    imap_use_ssl: true,
    status: 'error',
    last_synced_at: null,
    imap_last_recovery_at: null,
    error_message: 'old error',
    created_at: '2026-06-07T00:00:00.000Z',
    updated_at: '2026-06-07T00:00:00.000Z',
    ...overrides,
  };
}

test('runImapRecoveryTick restores healthy mailboxes to connected', async () => {
  const supabase = new TrackingSupabase();
  const mailbox = createMailbox();

  await runImapRecoveryTick({
    supabase: supabase as any,
    databaseClient: {
      async claimMailboxesForImapRecovery() {
        return [mailbox];
      },
    } as any,
    batchSize: 100,
    cooldownHours: 24,
    concurrency: 2,
    verifyMailbox: async () => {},
  });

  assert.equal(supabase.calls.length, 1);
  assert.deepEqual(supabase.calls[0].filters, [{ op: 'eq', column: 'id', value: 'mailbox-1' }]);
  assert.equal(supabase.calls[0].updates?.status, 'connected');
  assert.equal(supabase.calls[0].updates?.error_message, null);
  assert.equal(supabase.calls[0].updates?.imap_claimed_at, null);
  assert.ok(typeof supabase.calls[0].updates?.imap_last_recovery_at === 'string');
});

test('runImapRecoveryTick keeps auth failures quiet and leaves mailbox in error', async () => {
  const supabase = new TrackingSupabase();
  const criticalCalls: string[] = [];
  const mailbox = createMailbox();

  await runImapRecoveryTick({
    supabase: supabase as any,
    databaseClient: {
      async claimMailboxesForImapRecovery() {
        return [mailbox];
      },
    } as any,
    batchSize: 100,
    cooldownHours: 24,
    concurrency: 2,
    verifyMailbox: async () => {
      throw {
        message: 'Command failed',
        responseStatus: 'NO',
        responseText: 'Authentication failed',
      };
    },
    notifyCritical: (title, payload) => {
      criticalCalls.push(`${title}:${payload.error}`);
    },
  });

  assert.equal(supabase.calls.length, 1);
  assert.equal(supabase.calls[0].updates?.status, 'error');
  assert.match(String(supabase.calls[0].updates?.error_message), /Authentication failed/);
  assert.equal(supabase.calls[0].updates?.imap_claimed_at, null);
  assert.ok(typeof supabase.calls[0].updates?.imap_last_recovery_at === 'string');
  assert.deepEqual(criticalCalls, []);
});

test('runImapRecoveryTick notifies critical on systemic infra-wide failures', async () => {
  const supabase = new TrackingSupabase();
  const criticalCalls: string[] = [];
  const mailboxes = [
    createMailbox({ id: 'mailbox-1' }),
    createMailbox({ id: 'mailbox-2', email_address: 'sender2@example.com' }),
  ];

  await runImapRecoveryTick({
    supabase: supabase as any,
    databaseClient: {
      async claimMailboxesForImapRecovery() {
        return mailboxes;
      },
    } as any,
    batchSize: 100,
    cooldownHours: 24,
    concurrency: 2,
    verifyMailbox: async () => {
      throw {
        message: 'Connection timed out',
        code: 'ETIMEDOUT',
      };
    },
    notifyCritical: (title, payload) => {
      criticalCalls.push(`${title}:${payload.error}`);
    },
  });

  assert.equal(criticalCalls.length, 1);
  assert.match(criticalCalls[0], /systemic failure/i);
  assert.match(criticalCalls[0], /ETIMEDOUT/);
});
