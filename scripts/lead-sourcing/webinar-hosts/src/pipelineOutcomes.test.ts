import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fixturesDir } from './lib/env.js';
import { runStage2 } from './stage2-linkedin/extract.js';
import { runStage3 } from './stage3-enrich/enrich.js';
import { runStage4 } from './stage4-contacts/filterAndFind.js';

describe('pipelineOutcomes', () => {
  it('runs stages 2-4 on fixture csv with zero api cost', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'webinar-leads-'));
    try {
      const stage1Input = join(fixturesDir, 'csv/stage1-sample.csv');
      const stage2Output = join(tempDir, 'stage2.csv');
      const stage3Output = join(tempDir, 'stage3.csv');
      const stage4Output = join(tempDir, 'stage4.csv');

      const stage2 = await runStage2({
        inputPath: stage1Input,
        outputPath: stage2Output,
        runDir: tempDir,
        useFixtures: true,
      });
      assert.ok(stage2.stats.ok >= 2);
      assert.ok(stage2.stats.blocked >= 1);

      const stage3 = await runStage3({
        inputPath: stage2Output,
        outputPath: stage3Output,
        useFixtures: true,
        smokeLimits: { max_openrouter_calls: 1 },
      });
      assert.ok(stage3.rows.length >= 2);
      assert.ok(stage3.stats.enriched >= 1);

      const stage4 = await runStage4({
        inputPath: stage3Output,
        stage2InputPath: stage2Output,
        outputPath: stage4Output,
        rejectedPath: join(tempDir, 'rejected.csv'),
        useFixtures: true,
      });

      assert.ok(stage4.stats.icp_passed >= 1);
      assert.ok(stage4.leads.length >= 1);
      assert.ok(stage4.leads.every((lead) => lead.email.includes('@')));

      const emails = stage4.leads.map((l) => l.email);
      assert.equal(new Set(emails).size, emails.length);

      const tinyLead = stage4.leads.find((l) => l.company_name === 'Tiny Co');
      assert.ok(tinyLead, 'Tiny Co should pass pipeline filter and produce a lead via broad search');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
