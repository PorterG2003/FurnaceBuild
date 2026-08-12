import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { packageRoot } from '../lib/env.js';
import { runStage2 } from '../stage2-linkedin/extract.js';
import { runStage3 } from './enrich.js';
import { loadCheckpoint } from './stage3Checkpoint.js';

describe('stage3Resume integration', () => {
  it('resumes from checkpoint without reprocessing completed groups', async () => {
    const runDir = mkdtempSync(join(tmpdir(), 'stage3-resume-'));
    const inputPath = join(runDir, 'stage2.csv');

    try {
      cpSync(join(packageRoot, 'fixtures/csv/stage1-sample.csv'), join(runDir, 'stage1.csv'));

      await runStage2({
        inputPath: join(runDir, 'stage1.csv'),
        outputPath: inputPath,
        runDir,
        useFixtures: true,
        maxRows: 5,
      });

      await runStage3({
        inputPath,
        runDir,
        useFixtures: true,
        stopAfterGroups: 2,
      });

      const mid = loadCheckpoint(runDir);
      assert.equal(mid.next_group_index, 2);
      assert.equal(mid.rows.length, 2);
      assert.equal(mid.status, 'in_progress');
      assert.ok(mid.shortlink_cache !== undefined);

      const resumed = await runStage3({
        inputPath,
        runDir,
        resumeRunDir: runDir,
        useFixtures: true,
      });

      assert.ok(resumed.rows.length >= 2);
      const final = loadCheckpoint(runDir);
      assert.equal(final.status, 'completed');
      assert.equal(final.next_group_index, final.total_groups);
    } finally {
      rmSync(runDir, { recursive: true, force: true });
    }
  });
});
