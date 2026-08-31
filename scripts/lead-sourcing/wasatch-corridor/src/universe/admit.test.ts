import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parseCliArgs } from '../lib/cli.js';
import { ctxFromCli } from '../pipeline.js';
import { emptyCompany } from '../types.js';
import { admitUniverse } from './admit.js';

test('skip-geo admits domain-having companies without a street', async () => {
  const runDir = mkdtempSync(join(tmpdir(), 'wasatch-admit-'));
  const cli = parseCliArgs(['--fixtures', '--skip-geo', '--run-dir', runDir]);
  const ctx = ctxFromCli(runDir, cli, true);
  const companies = [
    emptyCompany({
      company_id: 'dom:droplet.test',
      name: 'Droplet',
      domain: 'droplet.test',
      street: '',
      city: '',
      query_city: 'Lehi',
      search_employee_band: '21,50',
    }),
    emptyCompany({
      company_id: 'name:no-site',
      name: 'No Site LLC',
      domain: null,
      street: '',
      query_city: 'Lehi',
    }),
  ];
  const result = await admitUniverse(ctx, companies);
  assert.equal(result.admitted.length, 1);
  assert.equal(result.admitted[0]?.name, 'Droplet');
  assert.equal(result.admitted[0]?.city, 'Lehi');
  assert.equal(result.admitted[0]?.universe_reason, 'search_location_unverified');
  assert.equal(result.review.some((r) => r.reason === 'no_operating_signal'), true);
  assert.equal(result.review.some((r) => r.reason === 'missing_address'), false);
});
