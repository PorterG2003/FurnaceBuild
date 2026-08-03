/**
 * Dry-run-first repair: fill email_messages.reference_message_ids from legacy
 * message_references / raw headers when unambiguous. Never reassigns thread_id
 * or rewrites delivered headers.
 *
 * Usage:
 *   npx tsx scripts/repair-email-reference-message-ids.ts
 *   APPLY=true npx tsx scripts/repair-email-reference-message-ids.ts
 *   LIMIT=500 APPLY=true npx tsx scripts/repair-email-reference-message-ids.ts
 *   SELF_RECOVERY_TARGET_ENV=prod npx tsx scripts/repair-email-reference-message-ids.ts
 */

import {
  loadSelfRecoveryEnv,
  resolveSelfRecoveryTargetEnv,
  resolveSupabaseUrlForTarget,
  resolveSecretParamPathForTarget,
  fetchSecretFromParameterStore,
} from './self-recovery-env.js';
import { createClient } from '@supabase/supabase-js';
import { parseMessageIds } from '../lib/email/threadHeaders.js';

loadSelfRecoveryEnv();

const APPLY = process.env.APPLY === 'true';
const LIMIT = Math.max(1, Number(process.env.LIMIT || '1000'));

type Row = {
  id: string;
  message_references: string | null;
  reference_message_ids: string[] | null;
  headers: Record<string, unknown> | null;
};

function extractReferencesFromHeaders(headers: Record<string, unknown> | null): string | null {
  if (!headers || typeof headers !== 'object') return null;
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== 'references') continue;
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.map(String).join(' ');
  }
  return null;
}

async function main() {
  const target = resolveSelfRecoveryTargetEnv();
  const url = resolveSupabaseUrlForTarget(target);
  const key = await fetchSecretFromParameterStore(resolveSecretParamPathForTarget(target, 'service_role'));
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const { data, error } = await supabase
    .from('email_messages')
    .select('id, message_references, reference_message_ids, headers')
    .is('reference_message_ids', null)
    .or('message_references.not.is.null,headers.not.is.null')
    .limit(LIMIT);

  if (error) {
    throw new Error(`Failed to load rows: ${error.message}`);
  }

  const rows = (data || []) as Row[];
  let wouldUpdate = 0;
  let ambiguous = 0;
  let skipped = 0;

  for (const row of rows) {
    if (row.reference_message_ids && row.reference_message_ids.length > 0) {
      skipped += 1;
      continue;
    }

    const fromColumn = row.message_references;
    const fromHeaders = extractReferencesFromHeaders(row.headers);
    const idsFromColumn = parseMessageIds(fromColumn);
    const idsFromHeaders = parseMessageIds(fromHeaders);

    let ids: string[] | null = null;
    if (idsFromColumn.length > 0 && idsFromHeaders.length > 0) {
      const a = idsFromColumn.join(' ');
      const b = idsFromHeaders.join(' ');
      if (a !== b) {
        ambiguous += 1;
        console.log(JSON.stringify({ status: 'ambiguous', id: row.id, idsFromColumn, idsFromHeaders }));
        continue;
      }
      ids = idsFromColumn;
    } else if (idsFromColumn.length > 0) {
      ids = idsFromColumn;
    } else if (idsFromHeaders.length > 0) {
      ids = idsFromHeaders;
    } else {
      skipped += 1;
      continue;
    }

    wouldUpdate += 1;
    console.log(JSON.stringify({ status: APPLY ? 'update' : 'dry_run', id: row.id, ids }));

    if (APPLY) {
      const { error: updateError } = await supabase
        .from('email_messages')
        .update({ reference_message_ids: ids })
        .eq('id', row.id)
        .is('reference_message_ids', null);
      if (updateError) {
        console.error(JSON.stringify({ status: 'error', id: row.id, error: updateError.message }));
      }
    }
  }

  console.log(
    JSON.stringify({
      target,
      apply: APPLY,
      scanned: rows.length,
      wouldUpdate,
      ambiguous,
      skipped,
    }),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
