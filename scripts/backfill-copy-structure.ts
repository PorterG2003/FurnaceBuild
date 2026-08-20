import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });
config();

type Args = {
  live: boolean;
  register: boolean;
  reparse: boolean;
  maxRows: number | null;
  accountId: string | null;
};

function parseArgs(argv: string[]): Args {
  let maxRows: number | null = null;
  let accountId: string | null = null;
  for (const arg of argv) {
    if (arg.startsWith('--max-rows=')) maxRows = Number(arg.slice('--max-rows='.length));
    if (arg.startsWith('--account-id=')) accountId = arg.slice('--account-id='.length);
  }
  return {
    live: argv.includes('--live'),
    register: argv.includes('--register') || argv.includes('--live'),
    reparse: argv.includes('--reparse'),
    maxRows: Number.isInteger(maxRows) && Number(maxRows) > 0 ? Number(maxRows) : null,
    accountId,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
  const serviceKey =
    process.env.SUPABASE_SECRET_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    '';
  if (!supabaseUrl || !serviceKey) {
    throw new Error('SUPABASE URL and service-role key are required');
  }
  if (args.live && args.maxRows == null) {
    throw new Error('Live parsing requires an explicit --max-rows=N cap');
  }

  const db = createClient(supabaseUrl, serviceKey);
  const accountFilter = args.accountId ? { account_id: args.accountId } : null;
  let versionsQuery = db
    .from('campaign_flow_versions')
    .select('id', { count: 'exact', head: true })
    .is('copy_registered_at', null);
  if (accountFilter) versionsQuery = versionsQuery.eq('account_id', accountFilter.account_id);
  const { count: unregistered, error: versionsError } = await versionsQuery;
  if (versionsError) throw versionsError;

  let queueQuery = db
    .from('copy_contents')
    .select('id', { count: 'exact', head: true })
    .in('parse_status', ['queued', 'processing']);
  if (accountFilter) queueQuery = queueQuery.eq('account_id', accountFilter.account_id);
  const { count: queuedBefore, error: queueError } = await queueQuery;
  if (queueError) throw queueError;

  console.log(
    JSON.stringify(
      {
        mode: args.live ? 'live' : args.register ? 'register-only' : 'dry-run',
        account_id: args.accountId,
        unregistered_versions: unregistered ?? 0,
        queued_contents: queuedBefore ?? 0,
        max_rows: args.maxRows,
      },
      null,
      2,
    ),
  );

  if (!args.register) {
    console.log('Dry run only. Add --register for the free registration phase.');
    return;
  }

  let registeredVersions = 0;
  while (true) {
    const { data, error } = await db.rpc('reconcile_copy_versions', {
      p_account_id: args.accountId,
      p_limit: 500,
    } as never);
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    registeredVersions += Number(
      (row as { registered_versions?: number } | null)?.registered_versions ?? 0,
    );
    const remaining = Number(
      (row as { remaining_versions?: number } | null)?.remaining_versions ?? 0,
    );
    if (remaining === 0) break;
  }
  console.log(`Registered ${registeredVersions} flow versions.`);

  if (args.reparse) {
    const { COPY_PARSE_PROMPT_VERSION } = await import(
      '../lib/copy/parseCopyStructure.ts'
    );
    let countQuery = db
      .from('copy_contents')
      .select('id', { count: 'exact', head: true })
      .eq('parse_status', 'done')
      .lt('parse_prompt_version', COPY_PARSE_PROMPT_VERSION);
    if (accountFilter) countQuery = countQuery.eq('account_id', accountFilter.account_id);
    const { count: eligible, error: countErr } = await countQuery;
    if (countErr) throw countErr;

    const reparseLimit = args.maxRows ?? (eligible ?? 0);
    if (reparseLimit > 0 && (eligible ?? 0) > 0) {
      let idsQuery = db
        .from('copy_contents')
        .select('id')
        .eq('parse_status', 'done')
        .lt('parse_prompt_version', COPY_PARSE_PROMPT_VERSION)
        .limit(reparseLimit);
      if (accountFilter) idsQuery = idsQuery.eq('account_id', accountFilter.account_id);
      const { data: rows, error: idsErr } = await idsQuery;
      if (idsErr) throw idsErr;
      const ids = (rows ?? []).map((r) => String((r as { id: string }).id));

      if (ids.length > 0) {
        const { error: updateErr } = await db
          .from('copy_contents')
          .update({
            parse_status: 'queued',
            parse_claimed_at: null,
            parse_next_attempt_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          } as never)
          .in('id', ids);
        if (updateErr) throw updateErr;
      }
      console.log(
        `Reparse: requeued ${ids.length} of ${eligible} contents with prompt_version < ${COPY_PARSE_PROMPT_VERSION}.`,
      );
    } else {
      console.log(
        `Reparse: 0 contents eligible (prompt_version < ${COPY_PARSE_PROMPT_VERSION}).`,
      );
    }
  }

  if (!args.live) {
    console.log('Registration complete. OpenRouter was not called.');
    return;
  }

  const openRouterApiKey = process.env.OPENROUTER_API_KEY ?? '';
  if (!openRouterApiKey) throw new Error('OPENROUTER_API_KEY is required for --live');
  const model =
    process.env.OPENROUTER_COPY_PARSE_MODEL?.trim() ||
    'google/gemini-2.5-flash-lite';
  const module = await import('../amplify/functions/copyStructureParse/handler.ts');
  const transportNamespace = await import('../lib/copy/openRouterCopyTransport.ts');
  const transportModule =
    (transportNamespace as { default?: typeof transportNamespace }).default ??
    transportNamespace;

  const accountIds = args.accountId
    ? [args.accountId]
    : await db
        .from('copy_contents')
        .select('account_id')
        .in('parse_status', ['queued', 'processing'])
        .then(({ data, error }) => {
          if (error) throw error;
          return [...new Set((data ?? []).map((row) => String(row.account_id)))];
        });

  let calls = 0;
  let processed = 0;
  let failed = 0;
  let remainingBudget = args.maxRows!;
  for (const accountId of accountIds) {
    if (remainingBudget <= 0) break;
    const result = await module.processCopyParseBatch({
      db,
      accountId,
      limit: remainingBudget,
      model,
      transport: async (prompt) => {
        calls += 1;
        return transportModule.callOpenRouterCopyParse({
          apiKey: openRouterApiKey,
          model,
          prompt,
        });
      },
    });
    processed += result.processed;
    failed += result.failed;
    remainingBudget -= result.processed + result.failed;
  }

  console.log(
    JSON.stringify(
      {
        registered_versions: registeredVersions,
        processed_contents: processed,
        failed_contents: failed,
        billable_calls: calls,
        cap: args.maxRows,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
