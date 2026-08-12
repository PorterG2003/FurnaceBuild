import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { packageRoot } from '../lib/env.js';
import { runStage2 } from './extract.js';
import { loadCheckpoint } from './stage2Checkpoint.js';

describe('stage2Resume integration', () => {
  it('resumes from checkpoint without reprocessing completed rows', async () => {
    const runDir = mkdtempSync(join(tmpdir(), 'stage2-resume-'));
    const inputPath = join(runDir, 'stage1.csv');
    cpSync(join(packageRoot, 'fixtures/csv/stage1-sample.csv'), inputPath);

    try {
      await runStage2({
        inputPath,
        runDir,
        useFixtures: true,
        maxRows: 5,
        stopAfterRows: 2,
      });

      const mid = loadCheckpoint(runDir);
      assert.equal(mid.next_row_index, 2);
      assert.equal(mid.rows.length, 2);
      assert.equal(mid.status, 'in_progress');

      const resumed = await runStage2({
        inputPath,
        runDir,
        resumeRunDir: runDir,
        useFixtures: true,
        maxRows: 5,
      });

      assert.equal(resumed.stats.input, 5);
      assert.equal(resumed.rows.length, 5);
      const final = loadCheckpoint(runDir);
      assert.equal(final.status, 'completed');
      assert.equal(final.next_row_index, 5);
    } finally {
      rmSync(runDir, { recursive: true, force: true });
    }
  });
});
