import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ctxFromCli } from './pipeline.js';
import { runAcquire, runAdmit, runDoors, runEnrich } from './pipeline.js';
import { readCsv } from './lib/csv.js';
import { parseCliArgs } from './lib/cli.js';

test('fixture pipeline produces ranked CSV and never drops excluded rows', async () => {
  const runDir = mkdtempSync(join(tmpdir(), 'wasatch-'));
  const cli = parseCliArgs(['--fixtures', '--run-dir', runDir]);
  const ctx = ctxFromCli(runDir, cli, true);

  await runAcquire(ctx);
  const { admitted, review, excluded } = await runAdmit(ctx);
  assert.ok(admitted.length >= 3, `expected admitted companies, got ${admitted.length}`);
  assert.ok(review.some((r) => r.reason === 'parked_or_shared_host'));
  assert.ok(excluded.some((c) => c.universe_reason === 'branch'));

  const enriched = await runEnrich(ctx, admitted);
  runDoors(ctx, enriched, review);

  const prospects = readCsv(join(runDir, 'output', 'prospects.csv'));
  assert.ok(prospects.length >= 1);
  assert.ok(prospects.some((r) => r.company === 'Acme Industrial'));
  const acme = prospects.find((r) => r.company === 'Acme Industrial');
  assert.equal(acme?.cold_email_qualified, 'true');
  assert.equal(acme?.sequencer_orphaned, 'true');

  const exclusions = readCsv(join(runDir, 'output', 'exclusions.csv'));
  assert.ok(exclusions.some((r) => r.exclusion_reason === 'outbound_shop'));

  const wce = prospects.find((r) => r.company === 'Wasatch CE Institute');
  assert.ok(wce);
  assert.equal(wce?.webinar_qualified, 'true');
  assert.equal(wce?.audience_is_ce_profession, 'true');
});
