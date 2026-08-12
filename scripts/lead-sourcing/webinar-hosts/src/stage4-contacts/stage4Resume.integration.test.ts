import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { packageRoot } from '../lib/env.js';
import { runStage2 } from '../stage2-linkedin/extract.js';
import { runStage3 } from '../stage3-enrich/enrich.js';
import { runStage4 } from './filterAndFind.js';
import { contactLogPath, loadCheckpoint, STAGE4_CONTACT_LOG_FILE } from './stage4Checkpoint.js';

describe('stage4Resume integration', () => {
  it('resumes from checkpoint without reprocessing completed entities', async () => {
    const runDir = mkdtempSync(join(tmpdir(), 'stage4-resume-'));
    const stage1Input = join(runDir, 'stage1.csv');
    const stage2Output = join(runDir, 'stage2.csv');
    const stage3Output = join(runDir, 'stage3.csv');

    try {
      cpSync(join(packageRoot, 'fixtures/csv/stage1-sample.csv'), stage1Input);

      await runStage2({
        inputPath: stage1Input,
        outputPath: stage2Output,
        runDir,
        useFixtures: true,
      });

      await runStage3({
        inputPath: stage2Output,
        outputPath: stage3Output,
        runDir,
        useFixtures: true,
        smokeLimits: { max_openrouter_calls: 1 },
      });

      const stdoutLines: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => {
        stdoutLines.push(args.map(String).join(' '));
        origLog(...args);
      };

      try {
        await runStage4({
          inputPath: stage3Output,
          stage2InputPath: stage2Output,
          runDir,
          useFixtures: true,
          stopAfterEntities: 1,
        });
      } finally {
        console.log = origLog;
      }

      const mid = loadCheckpoint(runDir);
      assert.equal(mid.next_entity_index, 1);
      assert.equal(mid.status, 'in_progress');
      assert.ok(mid.leads.length >= 0);
      const midApollo = mid.api_calls.apollo_people_calls;

      const logContent = readFileSync(contactLogPath(runDir), 'utf8');
      assert.ok(logContent.includes('"entity_index":0'));
      assert.ok(stdoutLines.some((line) => line.includes('"stage4_entity"')));

      const resumed = await runStage4({
        inputPath: stage3Output,
        stage2InputPath: stage2Output,
        runDir,
        resumeRunDir: runDir,
        useFixtures: true,
      });

      assert.ok(resumed.leads.length >= mid.leads.length);
      const final = loadCheckpoint(runDir);
      assert.equal(final.status, 'completed');
      assert.equal(final.next_entity_index, final.total_entities);
      assert.ok(final.api_calls.apollo_people_calls >= midApollo);
    } finally {
      rmSync(runDir, { recursive: true, force: true });
    }
  });

  it('writes contact log file in run dir', async () => {
    const runDir = mkdtempSync(join(tmpdir(), 'stage4-log-'));
    const stage1Input = join(runDir, 'stage1.csv');
    const stage2Output = join(runDir, 'stage2.csv');
    const stage3Output = join(runDir, 'stage3.csv');

    try {
      cpSync(join(packageRoot, 'fixtures/csv/stage1-sample.csv'), stage1Input);

      await runStage2({
        inputPath: stage1Input,
        outputPath: stage2Output,
        runDir,
        useFixtures: true,
      });

      await runStage3({
        inputPath: stage2Output,
        outputPath: stage3Output,
        runDir,
        useFixtures: true,
        smokeLimits: { max_openrouter_calls: 1 },
      });

      await runStage4({
        inputPath: stage3Output,
        stage2InputPath: stage2Output,
        runDir,
        useFixtures: true,
      });

      const logPath = join(runDir, STAGE4_CONTACT_LOG_FILE);
      const lines = readFileSync(logPath, 'utf8').trim().split('\n');
      assert.ok(lines.length >= 1);
      const first = JSON.parse(lines[0]!);
      assert.equal(typeof first.company_name, 'string');
      assert.equal(typeof first.entity_index, 'number');
    } finally {
      rmSync(runDir, { recursive: true, force: true });
    }
  });
});
