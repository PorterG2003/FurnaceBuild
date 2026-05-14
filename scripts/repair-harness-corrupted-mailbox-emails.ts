/**
 * Repair mailboxes left with campaign harness synthetic failure emails
 * (`failure-<8 hex>@example.com`) after `email_address` was mutated for tests
 * but cleanup missed them (fixed in harness; this script fixes existing rows).
 *
 * For each active row matching that pattern:
 * - If `imap_username` is a non-synthetic email, set `email_address` to its trimmed
 *   lowercase form (matches how the harness seeds mailbox rows).
 * - Otherwise soft-disconnect the mailbox (`deleted_at`, `status = disconnected`)
 *   so workers stop claiming it.
 *
 * Usage (defaults to dry-run):
 *   npx tsx scripts/repair-harness-corrupted-mailbox-emails.ts
 *   APPLY=true npx tsx scripts/repair-harness-corrupted-mailbox-emails.ts
 *
 * Env resolution matches other repair scripts (see `scripts/self-recovery-env.ts`).
 */

import {
  fetchSecretFromParameterStore,
  loadSelfRecoveryEnv,
  resolveSecretParamPathForTarget,
  resolveSelfRecoveryTargetEnv,
  resolveSupabaseUrlForTarget,
} from './self-recovery-env.js';

loadSelfRecoveryEnv();

/** Same shape as `campaignLifecycleOutcomes.test.ts` synthetic failure update. */
const HARNESS_FAILURE_EMAIL = /^failure-[0-9a-f]{8}@example\.com$/i;

type MailboxRow = {
  id: string;
  email_address: string;
  imap_username: string | null;
  smtp_username: string | null;
  account_id: string;
  status: string;
  deleted_at: string | null;
};

function isHarnessCorruptedEmail(email: string | null | undefined): boolean {
  return typeof email === 'string' && HARNESS_FAILURE_EMAIL.test(email.trim());
}

function restoreEmailFromImap(imapUsername: string | null | undefined): string | null {
  if (!imapUsername?.trim()) {
    return null;
  }
  const u = imapUsername.trim().toLowerCase();
  if (HARNESS_FAILURE_EMAIL.test(u)) {
    return null;
  }
  if (!u.includes('@')) {
    return null;
  }
  return u;
}

async function main() {
  const targetEnv = resolveSelfRecoveryTargetEnv();
  const { url, source: urlSource } = resolveSupabaseUrlForTarget(targetEnv);
  const apply = process.env.APPLY === 'true';
  const awsRegion =
    process.env.AWS_REGION?.trim() ||
    process.env.CDK_DEFAULT_REGION?.trim() ||
    'us-west-2';

  let key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    null;

  const secretParamPath = resolveSecretParamPathForTarget(targetEnv);

  if (secretParamPath) {
    try {
      key = await fetchSecretFromParameterStore(secretParamPath, awsRegion);
      process.env.SUPABASE_SECRET_KEY = key;
    } catch (error) {
      if (!key) {
        throw error;
      }
      console.warn(
        `[repair-harness-corrupted-mailbox-emails] Failed to fetch ${secretParamPath}; falling back to existing secret env.`,
      );
    }
  }

  if (!url || !key) {
    console.error(
      'Missing Supabase URL or service role key. Set prod/dev URL vars and SSM prefix or SUPABASE_SERVICE_ROLE_KEY.',
    );
    process.exit(1);
  }

  console.log(`Target env: ${targetEnv}`);
  console.log(`Resolved SUPABASE_URL from ${urlSource}.`);
  console.log(`Mode: ${apply ? 'APPLY (writes enabled)' : 'dry-run (no writes)'}`);
  if (secretParamPath) {
    console.log(`Secret path: ${secretParamPath}`);
  }

  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(url, key);

  const { data: candidatesRaw, error: loadError } = await supabase
    .from('mailboxes')
    .select('id, email_address, imap_username, smtp_username, account_id, status, deleted_at')
    .is('deleted_at', null)
    .ilike('email_address', 'failure-%@example.com');

  if (loadError) {
    console.error('Failed to load mailboxes:', loadError.message);
    process.exit(1);
  }

  const candidates = ((candidatesRaw ?? []) as MailboxRow[]).filter((row) =>
    isHarnessCorruptedEmail(row.email_address),
  );

  if (candidates.length === 0) {
    console.log('No active mailboxes match harness failure email pattern; nothing to do.');
    return;
  }

  const restore: Array<{ row: MailboxRow; nextEmail: string }> = [];
  const disconnect: MailboxRow[] = [];

  for (const row of candidates) {
    const next = restoreEmailFromImap(row.imap_username) ?? restoreEmailFromImap(row.smtp_username);
    if (next) {
      restore.push({ row, nextEmail: next });
    } else {
      disconnect.push(row);
    }
  }

  console.log(`\nMatched ${candidates.length} mailbox(es) (strict harness pattern).\n`);

  for (const { row, nextEmail } of restore) {
    console.log(
      `RESTORE id=${row.id} account=${row.account_id}\n  ${row.email_address} -> ${nextEmail} (from imap/smtp username)`,
    );
  }
  for (const row of disconnect) {
    console.log(
      `DISCONNECT id=${row.id} account=${row.account_id}\n  email_address=${row.email_address} (no safe username to restore; soft-delete)`,
    );
  }

  if (!apply) {
    console.log('\nDry-run complete. Re-run with APPLY=true to execute updates.');
    return;
  }

  const timestamp = new Date().toISOString();

  for (const { row, nextEmail } of restore) {
    const { error } = await supabase
      .from('mailboxes')
      .update({
        email_address: nextEmail,
        error_message: null,
        status: 'connected',
        updated_at: timestamp,
      } as any)
      .eq('id', row.id)
      .is('deleted_at', null);
    if (error) {
      console.error(`Failed to restore mailbox ${row.id}:`, error.message);
      process.exit(1);
    }
  }

  for (const row of disconnect) {
    const { error } = await supabase
      .from('mailboxes')
      .update({
        deleted_at: timestamp,
        status: 'disconnected',
        error_message: null,
        updated_at: timestamp,
      } as any)
      .eq('id', row.id)
      .is('deleted_at', null);
    if (error) {
      console.error(`Failed to disconnect mailbox ${row.id}:`, error.message);
      process.exit(1);
    }
  }

  console.log(`\nApplied: restored ${restore.length}, disconnected ${disconnect.length}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
