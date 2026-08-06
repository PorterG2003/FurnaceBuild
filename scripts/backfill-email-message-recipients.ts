/**
 * Backfill email_messages.to_emails / cc from already-stored headers (and
 * primary to_email fallback). No IMAP.
 *
 * Usage:
 *   npx tsx scripts/backfill-email-message-recipients.ts
 *   LIMIT=500 npx tsx scripts/backfill-email-message-recipients.ts
 *   ACCOUNT_ID=<uuid> APPLY=true npx tsx scripts/backfill-email-message-recipients.ts
 *   SELF_RECOVERY_TARGET_ENV=prod APPLY=true npx tsx scripts/backfill-email-message-recipients.ts
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { planRecipientBackfill } from './backfill-email-message-recipients-helpers.js';
import {
  fetchSecretFromParameterStore,
  loadSelfRecoveryEnv,
  resolveSecretParamPathForTarget,
  resolveSelfRecoveryTargetEnv,
  resolveSupabaseUrlForTarget,
} from './self-recovery-env.js';

loadSelfRecoveryEnv();

type MessageRow = {
  id: string;
  account_id: string;
  direction: 'sent' | 'received';
  to_email: string;
  to_emails: string[] | null;
  cc: string[] | null;
  headers: Record<string, unknown> | null;
};

type Stats = {
  scanned: number;
  toEmailsUpdated: number;
  ccUpdated: number;
  unchanged: number;
  errors: number;
};

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function sameStringArray(a: string[] | null | undefined, b: string[] | null | undefined): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

async function createSupabase(): Promise<{
  client: SupabaseClient;
  targetEnv: 'prod' | 'dev';
  url: string;
}> {
  const targetEnv = resolveSelfRecoveryTargetEnv();
  const { url, source } = resolveSupabaseUrlForTarget(targetEnv);
  if (!url) {
    throw new Error(`Missing Supabase URL for ${targetEnv} (source=${source})`);
  }

  const region =
    process.env.AWS_REGION?.trim() ||
    process.env.AWS_DEFAULT_REGION?.trim() ||
    process.env.CDK_DEFAULT_REGION?.trim() ||
    'us-west-2';

  let secretKey = '';
  const secretParamPath = resolveSecretParamPathForTarget(targetEnv);
  if (secretParamPath) {
    try {
      secretKey = await fetchSecretFromParameterStore(secretParamPath, region);
    } catch (error) {
      console.warn(
        `Failed to fetch ${secretParamPath}; falling back to env secret.`,
        error instanceof Error ? error.message : error
      );
    }
  }

  if (!secretKey) {
    secretKey =
      process.env.SUPABASE_SECRET_KEY?.trim() ||
      process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
      '';
  }

  if (!secretKey) {
    throw new Error(`Missing secret key for ${targetEnv} (SSM and env both empty)`);
  }

  const client = createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return { client, targetEnv, url };
}

async function fetchMissingToEmailsBatch(
  supabase: SupabaseClient,
  opts: {
    accountId: string | null;
    afterId: string | null;
    batchSize: number;
  }
): Promise<MessageRow[]> {
  let query = supabase
    .from('email_messages')
    .select('id, account_id, direction, to_email, to_emails, cc, headers')
    .is('to_emails', null)
    .order('id', { ascending: true })
    .limit(opts.batchSize);

  if (opts.accountId) query = query.eq('account_id', opts.accountId);
  if (opts.afterId) query = query.gt('id', opts.afterId);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as MessageRow[];
}

async function main(): Promise<void> {
  const apply = String(process.env.APPLY ?? 'false').toLowerCase() === 'true';
  const accountId = process.env.ACCOUNT_ID?.trim() || null;
  const limit = parsePositiveInteger(process.env.LIMIT, Number.MAX_SAFE_INTEGER);
  const batchSize = Math.min(parsePositiveInteger(process.env.BATCH_SIZE, 200), 500);

  const { client: supabase, targetEnv, url } = await createSupabase();
  console.log(
    JSON.stringify({
      targetEnv,
      urlHost: new URL(url).host,
      apply,
      accountId,
      limit: limit === Number.MAX_SAFE_INTEGER ? null : limit,
      batchSize,
    })
  );

  const stats: Stats = {
    scanned: 0,
    toEmailsUpdated: 0,
    ccUpdated: 0,
    unchanged: 0,
    errors: 0,
  };

  const samples: Array<{
    id: string;
    direction: string;
    toEmails: string[] | null;
    cc: string[] | null;
  }> = [];

  let afterId: string | null = null;

  while (stats.scanned < limit) {
    const remaining = limit - stats.scanned;
    const rows = await fetchMissingToEmailsBatch(supabase, {
      accountId,
      afterId,
      batchSize: Math.min(batchSize, remaining),
    });
    if (rows.length === 0) break;
    afterId = rows[rows.length - 1]!.id;

    const updates: Array<{
      id: string;
      patch: { to_emails?: string[] | null; cc?: string[] | null };
    }> = [];

    for (const row of rows) {
      stats.scanned += 1;

      const plan = planRecipientBackfill({
        toEmail: row.to_email,
        toEmails: row.to_emails,
        cc: row.cc,
        headers: row.headers,
      });

      const patch: { to_emails?: string[] | null; cc?: string[] | null } = {};
      if (plan.changedToEmails && !sameStringArray(row.to_emails, plan.toEmails)) {
        patch.to_emails = plan.toEmails;
      }
      if (plan.changedCc && !sameStringArray(row.cc, plan.cc)) {
        patch.cc = plan.cc;
      }

      if (Object.keys(patch).length === 0) {
        stats.unchanged += 1;
        continue;
      }

      if (samples.length < 15) {
        samples.push({
          id: row.id,
          direction: row.direction,
          toEmails: patch.to_emails ?? row.to_emails,
          cc: patch.cc ?? row.cc,
        });
      }

      if (!apply) {
        if (patch.to_emails !== undefined) stats.toEmailsUpdated += 1;
        if (patch.cc !== undefined) stats.ccUpdated += 1;
        continue;
      }

      updates.push({ id: row.id, patch });
    }

    if (apply && updates.length > 0) {
      const concurrency = 25;
      for (let i = 0; i < updates.length; i += concurrency) {
        const slice = updates.slice(i, i + concurrency);
        const results = await Promise.all(
          slice.map(async ({ id, patch }) => {
            const { error } = await supabase.from('email_messages').update(patch).eq('id', id);
            return { id, patch, error };
          })
        );
        for (const result of results) {
          if (result.error) {
            stats.errors += 1;
            console.error(`Update failed for ${result.id}: ${result.error.message}`);
            continue;
          }
          if (result.patch.to_emails !== undefined) stats.toEmailsUpdated += 1;
          if (result.patch.cc !== undefined) stats.ccUpdated += 1;
        }
      }
    }

    console.log(
      JSON.stringify({
        progress: {
          scanned: stats.scanned,
          toEmailsUpdated: stats.toEmailsUpdated,
          ccUpdated: stats.ccUpdated,
          unchanged: stats.unchanged,
          errors: stats.errors,
          afterId,
        },
      })
    );

    if (rows.length < Math.min(batchSize, remaining)) break;
  }

  console.log(JSON.stringify({ done: true, apply, stats, samples }, null, 2));
  if (!apply) {
    console.log('Dry run only. Re-run with APPLY=true to write.');
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
