import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureEnv, envBool } from './lib/env.js';
import { loadSmokeConfig } from './lib/config.js';
import { runStage1 } from './stage1-serp/scrape.js';
import { resolveSerperApiKey } from './stage1-serp/serperClient.js';
import { runStage2 } from './stage2-linkedin/extract.js';
import { runStage3 } from './stage3-enrich/enrich.js';
import { runStage4 } from './stage4-contacts/filterAndFind.js';
import { CallCounter } from './lib/callCounter.js';

async function main(): Promise<void> {
  await ensureEnv();

  if (!envBool('ALLOW_PAID_SMOKE')) {
    console.error('Set ALLOW_PAID_SMOKE=1 to run the paid smoke test.');
    process.exit(1);
  }

  if (!resolveSerperApiKey()) {
    console.error('Paid smoke test requires SERPER_API_KEY for Stage 1 Serper searches.');
    process.exit(1);
  }

  const smoke = loadSmokeConfig();
  const tempDir = mkdtempSync(join(tmpdir(), 'webinar-smoke-'));
  const counter = new CallCounter();

  try {
    const stage1 = await runStage1({
      outputPath: join(tempDir, 'stage1.csv'),
      counter,
      smokeLimits: smoke,
    });
    if (stage1.rows.length < 1) {
      throw new Error('Smoke stage1: expected at least 1 LinkedIn post URL');
    }

    const stage2 = await runStage2({
      inputPath: stage1.outputPath,
      outputPath: join(tempDir, 'stage2.csv'),
      counter,
      smokeLimits: smoke,
    });
    if (stage2.stats.ok + stage2.stats.blocked < 1) {
      throw new Error('Smoke stage2: expected at least 1 ok or blocked extraction');
    }

    const stage3 = await runStage3({
      inputPath: stage2.outputPath,
      outputPath: join(tempDir, 'stage3.csv'),
      counter,
      smokeLimits: smoke,
    });
    if (stage3.stats.enriched + stage3.stats.partial < 1) {
      throw new Error('Smoke stage3: expected at least 1 enriched or partial entity');
    }

    const stage4 = await runStage4({
      inputPath: stage3.outputPath,
      stage2InputPath: stage2.outputPath,
      outputPath: join(tempDir, 'stage4.csv'),
      rejectedPath: join(tempDir, 'rejected.csv'),
      counter,
      smokeLimits: smoke,
    });

    console.log(
      JSON.stringify({
        smoke: 'pass',
        stage1_rows: stage1.rows.length,
        stage2: stage2.stats,
        stage3: stage3.stats,
        stage4: stage4.stats,
        api_calls: counter.snapshot(),
      }),
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
