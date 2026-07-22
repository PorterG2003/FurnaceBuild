import { reportErrorToSlack } from '@furnace/slack-lib';
import {
  applyMailboxImapFailureUpdate,
  buildImapFlowOptions,
  buildMailboxImapRestoreUpdate,
  classifyImapError,
  createImapFlowErrorGuard,
  inferImapInfraFailureCode,
  isSystemicInfraFailure,
  verifyImapInboxAccess,
} from '@furnace/mailbox-lib';
import { SupabaseClient } from '@supabase/supabase-js';
import { ImapFlow } from 'imapflow';
import pLimit from 'p-limit';
import { DatabaseClient } from './database.js';
import type { Mailbox } from './types.js';

interface ImapRecoveryTickConfig {
  supabase: SupabaseClient;
  databaseClient: DatabaseClient;
  batchSize: number;
  cooldownHours: number;
  concurrency: number;
  verifyMailbox?: (mailbox: Mailbox) => Promise<void>;
  notifyCritical?: typeof reportErrorToSlack;
}

interface RecoveryFailureRecord {
  host: string;
  code: string | null;
  message: string;
}

export async function verifyMailboxImap(mailbox: Mailbox): Promise<void> {
  const client = new ImapFlow(
    buildImapFlowOptions({
      host: mailbox.imap_host,
      port: mailbox.imap_port,
      username: mailbox.imap_username,
      password: mailbox.imap_password,
      useSSL: mailbox.imap_use_ssl,
    }),
  );
  const guard = createImapFlowErrorGuard(client);

  try {
    await client.connect();
    guard.throwIfError();
    await verifyImapInboxAccess(client);
    guard.throwIfError();
  } finally {
    guard.dispose();
    try {
      await client.logout();
    } catch {
      // Ignore logout errors while probing mailbox health.
    }
  }
}

export async function runImapRecoveryTick(config: ImapRecoveryTickConfig): Promise<void> {
  const mailboxes = await config.databaseClient.claimMailboxesForImapRecovery(
    config.batchSize,
    config.cooldownHours,
  );

  if (mailboxes.length === 0) {
    console.log('[IMAP RECOVERY] No error-status mailboxes eligible for recovery');
    return;
  }

  console.log(
    `[IMAP RECOVERY] Claimed ${mailboxes.length} mailbox(es) for recovery (cooldown=${config.cooldownHours}h, concurrency=${config.concurrency})`,
  );

  let recovered = 0;
  let stillError = 0;
  const failures: RecoveryFailureRecord[] = [];
  const limit = pLimit(config.concurrency);

  await Promise.all(
    mailboxes.map((mailbox) =>
      limit(async () => {
        try {
          await (config.verifyMailbox ?? verifyMailboxImap)(mailbox);
          const { error } = await config.supabase
            .from('mailboxes')
            .update(buildMailboxImapRestoreUpdate())
            .eq('id', mailbox.id);
          if (error) {
            throw error;
          }
          recovered += 1;
        } catch (error) {
          const classified = classifyImapError(error);
          const code = inferImapInfraFailureCode({
            code: (error as { code?: string | null })?.code ?? null,
            message: classified.message,
          });

          failures.push({
            host: mailbox.imap_host,
            code,
            message: classified.message,
          });
          stillError += 1;

          const { error: updateError } = await config.supabase
            .from('mailboxes')
            .update({
              ...applyMailboxImapFailureUpdate(classified.kind, classified.message, {
                consecutiveFailures: mailbox.imap_consecutive_failures ?? 0,
                errorCode: code,
              }),
              // Recovery attempts always stamp cooldown; stay on error lane.
              status: 'error',
              imap_last_recovery_at: new Date().toISOString(),
            })
            .eq('id', mailbox.id);
          if (updateError) {
            throw updateError;
          }
        }
      }),
    ),
  );

  console.log(`[IMAP RECOVERY] recovered=${recovered}, still_error=${stillError}`);

  if (recovered === 0 && failures.length === mailboxes.length && isSystemicInfraFailure(failures)) {
    const code = failures[0]?.code ?? 'unknown';
    const host = failures[0]?.host ?? 'unknown';
    (config.notifyCritical ?? reportErrorToSlack)('Inbox-checker IMAP recovery systemic failure', {
      severity: 'critical',
      alertPolicy: 'critical_failure',
      error: `${failures.length} mailbox recovery attempts failed with ${code} against ${host}`,
      summaryFields: {
        worker: 'inbox-checker',
        imap_host: host,
        failure_code: code,
      },
    });
  }
}
