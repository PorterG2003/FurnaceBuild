import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parseCliArgs } from '../lib/cli.js';
import { fixturesDir } from '../lib/env.js';
import { readCsv } from '../lib/csv.js';
import { writeJsonl, readJsonl } from '../lib/jsonl.js';
import { ctxFromCli } from '../pipeline.js';
import { emptyCompany } from '../types.js';
import {
  censusPlaceAllowed,
  hasStreetNumber,
  hqQuery,
  needsSerper,
  parseHqFromSerper,
  parseStreetFromText,
  runStreets,
  type HqSerperResponse,
  type StreetSidecarRow,
} from './streets.js';

function qualified(overrides: Parameters<typeof emptyCompany>[0]) {
  return emptyCompany({
    company_id: overrides.company_id ?? 'dom:example.test',
    name: 'Example',
    domain: 'example.test',
    b2b_type: 'b2b',
    primary_buyer: 'business',
    customer_geo: 'us',
    employees: 40,
    revenue_est: 800_000,
    sdr_headcount: 2,
    live_site: true,
    city: 'Orem',
    query_city: 'Orem',
    ...overrides,
  });
}

function loadFixture(name: string): HqSerperResponse {
  return JSON.parse(readFileSync(join(fixturesDir, 'serper', name), 'utf8')) as HqSerperResponse;
}

test('parses Utah street + city from Serper snippets', () => {
  const kg = parseHqFromSerper(loadFixture('orem-hq.json'));
  assert.equal(kg?.street, '1577 N Technology Way');
  assert.equal(kg?.city, 'Orem');

  const snippet = parseHqFromSerper(loadFixture('provo-hq.json'));
  assert.equal(snippet?.street, '100 W Center St');
  assert.equal(snippet?.city, 'Provo');

  const grid = parseStreetFromText('Headquarters at 580 E 1400 N, Orem, UT 84097');
  assert.equal(grid?.street, '580 E 1400 N');
  assert.equal(grid?.city, 'Orem');

  assert.equal(parseStreetFromText('Software company based in Utah County'), null);
  assert.equal(parseHqFromSerper(loadFixture('empty.json')), null);
});

test('skips Serper when street or hq_address already has a street number', () => {
  assert.equal(hasStreetNumber('1577 N Technology Way'), true);
  assert.equal(hasStreetNumber('Orem, Utah'), false);
  assert.equal(needsSerper(qualified({ street: '100 W Center St, Provo, UT' })), false);
  assert.equal(needsSerper(qualified({ street: '', hq_address: '1577 N Technology Way, Orem, UT' })), false);
  assert.equal(needsSerper(qualified({ street: '', hq_address: '' })), true);
});

test('Orem/Provo Census place match', () => {
  const cities = ['Orem', 'Provo'];
  assert.equal(censusPlaceAllowed('Orem', cities), true);
  assert.equal(censusPlaceAllowed('Orem city', cities), true);
  assert.equal(censusPlaceAllowed('Provo', cities), true);
  assert.equal(censusPlaceAllowed('Lehi', cities), false);
  assert.equal(censusPlaceAllowed(null, cities), false);
});

test('streets stage skips Serper for known streets and keeps only Orem/Provo geocodes', async () => {
  const runDir = mkdtempSync(join(tmpdir(), 'wasatch-streets-'));
  const cli = parseCliArgs(['--fixtures', '--run-dir', runDir, '--cities', 'Orem,Provo']);
  const ctx = ctxFromCli(runDir, cli, true);

  writeJsonl(join(runDir, 'enrichment', 'companies.jsonl'), [
    qualified({
      company_id: 'dom:flexsim.test',
      name: 'FlexSim',
      domain: 'flexsim.test',
      street: '',
      city: 'Orem',
      query_city: 'Orem',
    }),
    qualified({
      company_id: 'dom:has-street.test',
      name: 'Has Street Inc',
      domain: 'has-street.test',
      street: '100 W Center St, Provo, UT',
      city: 'Provo',
      query_city: 'Provo',
    }),
    qualified({
      company_id: 'dom:wrong-city.test',
      name: 'Wrong City Co',
      domain: 'wrong-city.test',
      street: '',
      city: 'Orem',
      query_city: 'Orem',
    }),
    qualified({
      company_id: 'dom:no-hit.test',
      name: 'No Hit LLC',
      domain: 'no-hit.test',
      street: '',
      city: 'Orem',
      query_city: 'Orem',
    }),
    qualified({
      company_id: 'dom:slc.test',
      name: 'Salt Lake Shop',
      domain: 'slc.test',
      city: 'Salt Lake City',
      query_city: 'Salt Lake City',
    }),
    emptyCompany({
      company_id: 'dom:b2c.test',
      name: 'Consumer Co',
      domain: 'b2c.test',
      b2b_type: 'b2c',
      city: 'Orem',
      query_city: 'Orem',
    }),
  ]);

  const queries: string[] = [];
  const result = await runStreets(ctx, {
    search: async (query) => {
      queries.push(query);
      if (query.includes('FlexSim')) return loadFixture('orem-hq.json');
      if (query.includes('Wrong City')) return loadFixture('lehi-hq.json');
      return loadFixture('empty.json');
    },
  });

  assert.equal(queries.some((q) => q.includes('Has Street')), false);
  assert.ok(queries.some((q) => q.includes('FlexSim')));
  assert.ok(hqQuery({ name: 'FlexSim', domain: 'flexsim.test' }, true).includes('Orem OR Provo'));

  const sidecar = readJsonl<StreetSidecarRow>(result.sidecarPath);
  assert.equal(sidecar.find((r) => r.name === 'FlexSim')?.status, 'keep');
  assert.equal(sidecar.find((r) => r.name === 'Has Street Inc')?.status, 'keep');
  assert.equal(sidecar.find((r) => r.name === 'Has Street Inc')?.skipped_serper, true);
  assert.equal(sidecar.find((r) => r.name === 'Wrong City Co')?.reason, 'wrong_city');
  assert.equal(sidecar.find((r) => r.name === 'No Hit LLC')?.reason, 'missing_street');
  assert.equal(sidecar.some((r) => r.name === 'Salt Lake Shop'), false);
  assert.equal(sidecar.some((r) => r.name === 'Consumer Co'), false);

  const prospects = readCsv(result.csvPath);
  assert.equal(prospects.some((r) => r.company === 'FlexSim'), true);
  assert.equal(prospects.some((r) => r.company === 'Has Street Inc'), true);
  assert.equal(prospects.some((r) => r.company === 'Wrong City Co'), false);
  assert.ok(prospects.find((r) => r.company === 'FlexSim')?.street.includes('1577'));
});

test('--stage streets parses', () => {
  const cli = parseCliArgs(['--stage', 'streets', '--cities', 'Orem,Provo']);
  assert.equal(cli.stage, 'streets');
  assert.deepEqual(cli.cities, ['Orem', 'Provo']);
});
