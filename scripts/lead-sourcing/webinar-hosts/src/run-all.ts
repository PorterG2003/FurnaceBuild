import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureEnv, useFixtures, packageRoot } from './lib/env.js';
import { loadQueriesConfig, loadSmokeConfig } from './lib/config.js';
import { parseCliArgs, createRunDir } from './lib/cli.js';
import { CallCounter, estimateApiCalls, exceedsSmokeLimits } from './lib/callCounter.js';
import { runStage1, writeRunManifest } from './stage1-serp/scrape.js';
import { runStage2 } from './stage2-linkedin/extract.js';
import { runStage3 } from './stage3-enrich/enrich.js';
import { runStage4 } from './stage4-contacts/filterAndFind.js';

export type RunAllResult = {
  runDir: string;
  stage1Path: string;
  stage2Path: string;
  stage3Path: string;
  stage4Path: string;
  apiCalls: ReturnType<CallCounter['snapshot']>;
};

export async function runAll(options: {
  dryRun?: boolean;
  confirmScale?: boolean;
  fromStage?: number;
  maxRows?: number | null;
  useFixtures?: boolean;
  runDir?: string;
  resumeRunDir?: string;
} = {}): Promise<RunAllResult> {
  await ensureEnv();
  const cli = parseCliArgs();
  const dryRun = options.dryRun ?? cli.dryRun;
  const confirmScale = options.confirmScale ?? cli.confirmScale;
  const fromStage = options.fromStage ?? cli.fromStage;
  const maxRows = options.maxRows ?? cli.maxRows;
  const useFixtureMode = options.useFixtures ?? cli.fixtures ?? useFixtures();
  const smoke = loadSmokeConfig();
  const queries = loadQueriesConfig();
  const counter = new CallCounter();

  const runDir = cli.resume
    ? resolve(cli.resume)
    : options.resumeRunDir
      ? resolve(options.resumeRunDir)
      : cli.runDir
        ? resolve(cli.runDir)
        : options.runDir
          ? resolve(options.runDir)
          : resolve(packageRoot, createRunDir());
  mkdirSync(runDir, { recursive: true });

  const estimated = estimateApiCalls({
    queryCount: queries.phrases.length,
    pagesPerQuery: null,
    linkedinUrlCount: maxRows ?? 100,
    entityCount: maxRows ?? 50,
    openrouterEnabled: Boolean(process.env.OPENROUTER_API_KEY?.trim()),
  });

  if (dryRun) {
    console.log(
      JSON.stringify({
        dry_run: true,
        run_dir: runDir,
        from_stage: fromStage,
        max_rows: maxRows,
        use_fixtures: useFixtureMode,
        estimated_api_calls: estimated,
        smoke_limits: smoke,
      }),
    );
    return {
      runDir,
      stage1Path: '',
      stage2Path: '',
      stage3Path: '',
      stage4Path: '',
      apiCalls: estimated,
    };
  }

  if (!useFixtureMode && !confirmScale && exceedsSmokeLimits(estimated, smoke)) {
    throw new Error(
      `Estimated API calls exceed smoke limits. Re-run with --confirm-scale after passing tests. Estimate: ${JSON.stringify(estimated)}`,
    );
  }

  let stage1Path = join(runDir, 'stage1_linkedin_webinar_posts.csv');
  let stage2Path = join(runDir, 'stage2_linkedin_webinar_posts_extracted.csv');
  let stage3Path = join(runDir, 'stage3_webinar_host_entities.csv');
  let stage4Path = join(runDir, 'stage4_webinar_host_leads.csv');

  if (fromStage <= 1) {
    const stage1 = await runStage1({
      outputPath: stage1Path,
      runDir: cli.resume ? undefined : runDir,
      resumeRunDir: cli.resume ?? options.resumeRunDir,
      maxRows,
      counter,
      useFixtures: useFixtureMode,
      smokeLimits: useFixtureMode ? undefined : smoke,
    });
    stage1Path = stage1.outputPath;
  } else if (cli.input) {
    stage1Path = resolve(cli.input);
  }

  if (fromStage <= 2) {
    const stage2 = await runStage2({
      inputPath: stage1Path,
      outputPath: stage2Path,
      runDir: cli.resume ? undefined : runDir,
      resumeRunDir: cli.resume ?? options.resumeRunDir,
      maxRows,
      counter,
      useFixtures: useFixtureMode,
      smokeLimits: useFixtureMode ? undefined : smoke,
    });
    stage2Path = stage2.outputPath;
  }

  if (fromStage <= 3) {
    const stage3 = await runStage3({
      inputPath: stage2Path,
      outputPath: stage3Path,
      runDir: cli.resume ? undefined : runDir,
      resumeRunDir: cli.resume ?? options.resumeRunDir,
      counter,
      useFixtures: useFixtureMode,
      smokeLimits: useFixtureMode ? undefined : smoke,
      maxApolloCalls: cli.maxApolloCalls,
    });
    stage3Path = stage3.outputPath;
  }

  if (fromStage <= 4) {
    await runStage4({
      inputPath: stage3Path,
      stage2InputPath: stage2Path,
      outputPath: stage4Path,
      rejectedPath: join(runDir, 'stage4_rejected_entities.csv'),
      runDir: cli.resume ? undefined : runDir,
      resumeRunDir: cli.resume ?? options.resumeRunDir,
      counter,
      useFixtures: useFixtureMode,
      smokeLimits: useFixtureMode ? undefined : smoke,
    });
  }

  const apiCalls = counter.snapshot();
  writeRunManifest(runDir, {
    completed_at: new Date().toISOString(),
    from_stage: fromStage,
    max_rows: maxRows,
    use_fixtures: useFixtureMode,
    api_calls: apiCalls,
    outputs: {
      stage1: stage1Path,
      stage2: stage2Path,
      stage3: stage3Path,
      stage4: stage4Path,
    },
  });

  console.log(JSON.stringify({ run_dir: runDir, api_calls: apiCalls }));

  return { runDir, stage1Path, stage2Path, stage3Path, stage4Path, apiCalls };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  runAll().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
