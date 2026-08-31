import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parseCliArgs } from '../lib/cli.js';
import { writeCsv } from '../lib/csv.js';
import { writeJsonl, readJsonl } from '../lib/jsonl.js';
import { ctxFromCli } from '../pipeline.js';
import { emptyCompany } from '../types.js';
import { STREET_PROSPECT_COLUMNS } from './streets.js';
import {
  classifyAskRole,
  friendlyHeadcountBand,
  pickAskFor,
  runContacts,
  type AskPerson,
  type ContactSidecarRow,
} from './contacts.js';

function person(overrides: AskPerson): AskPerson {
  return { id: overrides.id ?? overrides.title, ...overrides };
}

test('VP Marketing ranks above CEO; when both exist, one of each', () => {
  const picked = pickAskFor([
    person({ id: '1', first_name: 'Pat', last_name: 'Owner', title: 'CEO' }),
    person({ id: '2', first_name: 'Morgan', last_name: 'Lee', title: 'VP of Marketing' }),
  ]);
  assert.equal(picked.length, 2);
  assert.equal(picked[0]?.title, 'VP of Marketing');
  assert.equal(picked[0]?.role, 'marketing');
  assert.equal(picked[1]?.title, 'CEO');
  assert.equal(picked[1]?.role, 'executive');
});

test('CEO fills when there is no marketing hit', () => {
  const picked = pickAskFor([
    person({ id: '1', first_name: 'Sam', last_name: 'Founder', title: 'Founder & CEO' }),
    person({ id: '2', first_name: 'Alex', last_name: 'Other', title: 'Owner' }),
  ]);
  assert.equal(picked.length, 2);
  assert.equal(picked[0]?.title, 'Founder & CEO');
  assert.equal(picked[0]?.role, 'executive');
  assert.equal(picked[1]?.title, 'Owner');
});

test('never more than two, and never SDR or AE', () => {
  const picked = pickAskFor([
    person({ id: 'sdr', first_name: 'A', last_name: 'Rep', title: 'SDR' }),
    person({ id: 'ae', first_name: 'B', last_name: 'Closer', title: 'Account Executive' }),
    person({ id: 'coord', first_name: 'C', last_name: 'Coord', title: 'Marketing Coordinator' }),
    person({ id: 'cmo', first_name: 'D', last_name: 'Cmo', title: 'CMO' }),
    person({ id: 'ceo', first_name: 'E', last_name: 'Ceo', title: 'CEO' }),
    person({ id: 'founder', first_name: 'F', last_name: 'Founder', title: 'Founder' }),
  ]);
  assert.equal(picked.length, 2);
  assert.equal(picked[0]?.title, 'CMO');
  assert.equal(picked[1]?.title, 'CEO');
  assert.equal(classifyAskRole('SDR'), 'skip');
  assert.equal(classifyAskRole('Account Executive'), 'skip');
  assert.equal(classifyAskRole('Marketing Coordinator'), 'skip');
  assert.equal(classifyAskRole('Marketing Specialist'), 'skip');
});

test('second marketer fills only when there is no executive', () => {
  const picked = pickAskFor([
    person({ id: '1', first_name: 'A', last_name: 'One', title: 'CMO' }),
    person({ id: '2', first_name: 'B', last_name: 'Two', title: 'Director of Marketing' }),
  ]);
  assert.equal(picked.length, 2);
  assert.equal(picked[0]?.title, 'CMO');
  assert.equal(picked[1]?.title, 'Director of Marketing');
  assert.ok(picked.every((p) => p.role === 'marketing'));
});

test('COO fills after CEO; GM counts; CTO and product owner skipped', () => {
  const withCoo = pickAskFor([
    person({ id: '1', first_name: 'Pat', last_name: 'Owner', title: 'CEO' }),
    person({ id: '2', first_name: 'Casey', last_name: 'Ops', title: 'COO' }),
  ]);
  assert.equal(withCoo[0]?.title, 'CEO');
  assert.equal(withCoo[1]?.title, 'COO');
  assert.equal(withCoo[1]?.role, 'ops');

  const gmOnly = pickAskFor([person({ id: '3', first_name: 'Lee', last_name: 'Shop', title: 'General Manager' })]);
  assert.equal(gmOnly[0]?.title, 'General Manager');

  const marketingAndCeo = pickAskFor([
    person({ id: 'm', first_name: 'Mo', last_name: 'Mkt', title: 'CMO' }),
    person({ id: 'c', first_name: 'Pat', last_name: 'Owner', title: 'CEO' }),
    person({ id: 'o', first_name: 'Casey', last_name: 'Ops', title: 'Chief Operating Officer' }),
  ]);
  assert.equal(marketingAndCeo.length, 2);
  assert.equal(marketingAndCeo[0]?.title, 'CMO');
  assert.equal(marketingAndCeo[1]?.title, 'CEO');

  assert.equal(classifyAskRole('CTO'), 'skip');
  assert.equal(classifyAskRole('Senior Product Owner'), 'skip');
});

test('friendly headcount band', () => {
  assert.equal(friendlyHeadcountBand('11,20'), '11-20');
  assert.equal(friendlyHeadcountBand('21,50'), '21-50');
});

test('--stage contacts parses', () => {
  const cli = parseCliArgs(['--stage', 'contacts', '--cities', 'Orem,Provo']);
  assert.equal(cli.stage, 'contacts');
});

test('contacts stage writes walk CSV people without calling email reveal', async () => {
  const runDir = mkdtempSync(join(tmpdir(), 'wasatch-contacts-'));
  const cli = parseCliArgs(['--fixtures', '--run-dir', runDir, '--cities', 'Orem,Provo']);
  const ctx = ctxFromCli(runDir, cli, true);

  writeJsonl(join(runDir, 'enrichment', 'companies.jsonl'), [
    emptyCompany({
      company_id: 'dom:flexsim.test',
      name: 'FlexSim',
      domain: 'flexsim.test',
      apollo_org_id: 'org_flex',
      city: 'Orem',
      query_city: 'Orem',
      search_employee_band: '21,50',
      street: '1577 N Technology Way',
    }),
    emptyCompany({
      company_id: 'dom:only-ceo.test',
      name: 'Only Ceo Co',
      domain: 'only-ceo.test',
      apollo_org_id: 'org_ceo',
      city: 'Provo',
      query_city: 'Provo',
      search_employee_band: '11,20',
      street: '100 W Center St',
    }),
  ]);

  writeCsv(
    join(runDir, 'output', 'orem-provo', 'prospects.csv'),
    [
      {
        rank: '1',
        company: 'FlexSim',
        city: 'Orem',
        street: '1577 N Technology Way',
        domain: 'flexsim.test',
        search_employee_band: '21,50',
      },
      {
        rank: '2',
        company: 'Only Ceo Co',
        city: 'Provo',
        street: '100 W Center St',
        domain: 'only-ceo.test',
        search_employee_band: '11,20',
      },
    ],
    STREET_PROSPECT_COLUMNS,
  );

  const result = await runContacts(ctx, {
    skipOrgEnrich: true,
    search: async (company) => {
      if (company.domain === 'flexsim.test') {
        return [
          person({ id: 'ceo', first_name: 'Chris', last_name: 'Haddock', title: 'CEO' }),
          person({ id: 'cmo', first_name: 'Jordan', last_name: 'Pike', title: 'VP of Marketing' }),
          person({ id: 'sdr', first_name: 'Skip', last_name: 'Me', title: 'SDR' }),
        ];
      }
      return [person({ id: 'owner', first_name: 'Riley', last_name: 'Stone', title: 'Founder' })];
    },
  });

  const sidecar = readJsonl<ContactSidecarRow>(result.sidecarPath);
  const flex = sidecar.find((r) => r.name === 'FlexSim');
  assert.equal(flex?.person_1_title, 'VP of Marketing');
  assert.equal(flex?.person_1_name, 'Jordan Pike');
  assert.equal(flex?.person_2_title, 'CEO');
  assert.equal(flex?.headcount_band, '21-50');
  const onlyCeo = sidecar.find((r) => r.name === 'Only Ceo Co');
  assert.equal(onlyCeo?.person_1_title, 'Founder');
  assert.equal(onlyCeo?.person_2_name, '');
  assert.equal(result.with_person, 2);
});
