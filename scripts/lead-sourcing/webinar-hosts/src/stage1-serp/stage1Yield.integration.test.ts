import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runStage1 } from './scrape.js';

describe('stage1 yield integration', () => {
  it('stops pagination when fixture page adds no new urls on second fetch', async () => {
    const runDir = mkdtempSync(join(tmpdir(), 'stage1-yield-'));
    try {
      const result = await runStage1({
        runDir,
        useFixtures: true,
        smokeLimits: { max_queries: 1, max_pages: 5 },
      });
      assert.ok(result.stats.deduped >= 1);
      assert.equal(result.stats.queriesRun, 1);
    } finally {
      rmSync(runDir, { recursive: true, force: true });
    }
  });

  it('resumes from checkpoint without rerunning completed phrase', async () => {
    const runDir = mkdtempSync(join(tmpdir(), 'stage1-resume-'));
    try {
      await runStage1({
        runDir,
        useFixtures: true,
        smokeLimits: { max_queries: 1, max_pages: 1 },
      });

      const { loadCheckpoint } = await import('./stage1Checkpoint.js');
      const midCheckpoint = loadCheckpoint(runDir);
      assert.equal(midCheckpoint.next_phrase_index, 1);
      assert.equal(midCheckpoint.status, 'in_progress');

      const resumed = await runStage1({
        resumeRunDir: runDir,
        useFixtures: true,
        smokeLimits: { max_queries: 2, max_pages: 1 },
      });

      assert.equal(resumed.stats.queriesRun, 2);
      const finalCheckpoint = loadCheckpoint(runDir);
      assert.equal(finalCheckpoint.next_phrase_index, 2);
    } finally {
      rmSync(runDir, { recursive: true, force: true });
    }
  });
});
