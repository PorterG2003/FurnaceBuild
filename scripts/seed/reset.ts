/**
 * Seed reset CLI — deletes known dev seed slices from Supabase.
 * Full docs: ./README.md in this folder.
 *
 * Summary: requires service role key; loads `.env` then `.env.local`.
 * Requires SEED_ACCOUNT_ID and explicit confirmation for destructive runs.
 */

import { assertProjectRefIfSet, getSupabaseUrl, loadSeedEnv } from './env';
import { createSeedContext } from './seedContext';
import {
  collectScopeCounts,
  resetScopePlan,
  resolveScopePlans,
  type ResetScope,
} from './resetHelpers';

loadSeedEnv();

type ResetScopeArg = ResetScope | 'all' | null;

interface ResetCliOptions {
  dryRun: boolean;
  help: boolean;
  scope: ResetScopeArg;
}

function parseArgs(argv: string[]): ResetCliOptions {
  const opts: ResetCliOptions = {
    dryRun: false,
    help: false,
    scope: null,
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      opts.help = true;
    } else if (a === '--dry-run') {
      opts.dryRun = true;
    } else if (a.startsWith('--scope=')) {
      opts.scope = normalizeScope(a.slice('--scope='.length));
    } else if (a === '--scope') {
      const next = argv[++i];
      if (!next) {
        throw new Error('--scope requires a value');
      }
      opts.scope = normalizeScope(next);
    } else {
      throw new Error(`Unknown argument: ${a} (try --help)`);
    }
  }

  return opts;
}

function normalizeScope(value: string): ResetScopeArg {
  const v = value.trim();
  if (v === 'campaign-smoke' || v === 'ooo-mixed-inbox' || v === 'all') {
    return v;
  }
  throw new Error(`Invalid --scope value: ${value}`);
}

function printHelp() {
  console.log(`Usage: tsx scripts/seed/reset.ts [options]

Options:
  --scope=<name>    campaign-smoke | ooo-mixed-inbox | all
  --scope <name>
  --dry-run         Preview what would be deleted
  --help, -h        Show this help

Required env:
  SUPABASE_URL or EXPO_PUBLIC_SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY
  SEED_ACCOUNT_ID

Safety:
  SEED_PROJECT_REF=<ref>       Optional project-ref guard
  SEED_RESET_CONFIRM=1         Required for destructive runs
  SEED_WIPE_CONFIRM=1          Also accepted for destructive runs

Notes:
  If --scope is omitted, reset infers targets from SEED_CAMPAIGN_ID / SEED_OOO_CAMPAIGN_ID.
  Scope all uses known seed campaign ids for both built-in scenarios.
`);
}

function requireResetConfirmation(dryRun: boolean) {
  if (dryRun) return;
  const confirmed =
    process.env.SEED_RESET_CONFIRM === '1' || process.env.SEED_WIPE_CONFIRM === '1';
  if (!confirmed) {
    console.error(
      '[seed:reset] destructive reset requires SEED_RESET_CONFIRM=1 (or SEED_WIPE_CONFIRM=1).'
    );
    process.exit(1);
  }
}

async function main() {
  let opts: ResetCliOptions;
  try {
    opts = parseArgs(process.argv);
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
    return;
  }

  if (opts.help) {
    printHelp();
    return;
  }

  requireResetConfirmation(opts.dryRun);

  const accountId = process.env.SEED_ACCOUNT_ID?.trim();
  if (!accountId) {
    console.error('[seed:reset] Missing SEED_ACCOUNT_ID');
    process.exit(1);
    return;
  }

  const url = getSupabaseUrl();
  if (!url) {
    console.error('[seed:reset] Missing SUPABASE_URL or EXPO_PUBLIC_SUPABASE_URL');
    process.exit(1);
    return;
  }
  assertProjectRefIfSet(url);

  const ctx = createSeedContext({
    scenarioId: 'seed:reset',
    wipe: false,
    dryRun: opts.dryRun,
  });

  const plans = resolveScopePlans(accountId, opts.scope);
  ctx.log(
    `starting reset dryRun=${opts.dryRun} scopes=${plans
      .map((plan) => `${plan.scope}:${plan.campaignId}`)
      .join(',')}`
  );

  for (const plan of plans) {
    const counts = await collectScopeCounts(ctx, plan);
    ctx.log(
      `scope=${plan.scope} preview ` +
        `campaign=${counts.campaignExists} mailboxes=${counts.mailboxes} ` +
        `campaign_mailboxes=${counts.campaignMailboxes} leads=${counts.leads} ` +
        `enrollments=${counts.enrollments} message_jobs=${counts.messageJobs} ` +
        `email_threads=${counts.emailThreads} email_messages=${counts.emailMessages}`
    );

    if (opts.dryRun) {
      continue;
    }

    const deleted = await resetScopePlan(ctx, plan);
    ctx.log(
      `scope=${plan.scope} deleted ` +
        `campaign=${deleted.campaignExists} mailboxes=${deleted.mailboxes} ` +
        `campaign_mailboxes=${deleted.campaignMailboxes} leads=${deleted.leads} ` +
        `enrollments=${deleted.enrollments} message_jobs=${deleted.messageJobs} ` +
        `email_threads=${deleted.emailThreads} email_messages=${deleted.emailMessages}`
    );
  }

  ctx.log('done');
}

main().catch((err) => {
  console.error('[seed:reset] fatal:', err);
  process.exit(1);
});
