/**
 * Seed CLI — loads demo data into Supabase (dev/staging only).
 * Full docs: ./README.md in this folder.
 *
 * Summary: requires service role key; supports --scenario, --wipe, --dry-run.
 * Loads `.env`, then `.env.local` with local overrides taking precedence.
 * Wipe requires SEED_WIPE_CONFIRM=1. Optional SEED_PROJECT_REF must match URL ref.
 */

import { createSeedContext } from './seedContext';
import { assertProjectRefIfSet, getSupabaseUrl, loadSeedEnv } from './env';
import { getScenarioModuleOrder } from './registry';
import { runWipe } from './wipe';
import type { SeedModule } from './types';

loadSeedEnv();

interface CliOptions {
  scenario: string;
  wipe: boolean;
  dryRun: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    scenario: 'dev-default',
    wipe: false,
    dryRun: false,
    help: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      opts.help = true;
    } else if (a === '--wipe') {
      opts.wipe = true;
    } else if (a === '--dry-run') {
      opts.dryRun = true;
    } else if (a.startsWith('--scenario=')) {
      opts.scenario = a.slice('--scenario='.length).trim() || opts.scenario;
    } else if (a === '--scenario') {
      const next = argv[++i];
      if (!next) {
        throw new Error('--scenario requires a value');
      }
      opts.scenario = next;
    } else {
      throw new Error(`Unknown argument: ${a} (try --help)`);
    }
  }
  return opts;
}

function printHelp() {
  console.log(`Usage: tsx scripts/seed/index.ts [options]

Options:
  --scenario=<id>   Scenario to run (default: dev-default)
  --scenario <id>
  --wipe            Run wipe step before seed (requires SEED_WIPE_CONFIRM=1)
  --dry-run         Log only; modules should skip writes
  --help, -h        Show this help

Environment:
  SUPABASE_URL or EXPO_PUBLIC_SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY  (not the anon/publishable key)

Optional:
  SEED_PROJECT_REF=<ref>   Must match project ref in https://<ref>.supabase.co
  SEED_WIPE_CONFIRM=1      Required when using --wipe

Scenarios: dev-default, campaign-smoke, bucket-insights-smoke, ooo-mixed-inbox, smart-handling-flow, categorizer-flow, platform-invite-preview, minimal (see README).

See scripts/seed/README.md for conventions and worker caveats.
`);
}

async function main() {
  let opts: CliOptions;
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

  if (opts.wipe && process.env.SEED_WIPE_CONFIRM !== '1') {
    console.error(
      '[seed] --wipe requires SEED_WIPE_CONFIRM=1 in the environment (prevents accidental data loss).'
    );
    process.exit(1);
  }

  const url = getSupabaseUrl();
  if (!url) {
    console.error('[seed] Missing SUPABASE_URL or EXPO_PUBLIC_SUPABASE_URL');
    process.exit(1);
  }
  assertProjectRefIfSet(url);

  let modules: SeedModule[];
  try {
    modules = getScenarioModuleOrder(opts.scenario);
  } catch (e) {
    console.error('[seed]', e instanceof Error ? e.message : e);
    process.exit(1);
    return;
  }

  const ctx = createSeedContext({
    scenarioId: opts.scenario,
    wipe: opts.wipe,
    dryRun: opts.dryRun,
  });

  ctx.log(`starting scenario=${opts.scenario} wipe=${opts.wipe} dryRun=${opts.dryRun}`);

  if (opts.wipe) {
    await runWipe(ctx);
  }
  for (const mod of modules) {
    ctx.log(`module ${mod.id}${mod.description ? ` — ${mod.description}` : ''}`);
    await mod.run(ctx);
  }

  ctx.log('done');
}

main().catch((err) => {
  console.error('[seed] fatal:', err);
  process.exit(1);
});
