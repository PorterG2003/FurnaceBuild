import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fixturesDir } from './lib/env.js';
import { readCsv } from './lib/csv.js';
import { loadJson } from './lib/io.js';
import { prepCompanies } from './prep.js';
import { resolveWebsites } from './resolve-websites.js';
import { classifyRoles } from './classify-role.js';
import { enrichSoc2 } from './enrich-soc2.js';
import { enrichFunding } from './enrich-funding.js';
import { mergeEnriched } from './merge.js';

describe('fixture pipeline', () => {
  it('resolves websites, labels platforms vs auditors/consultants, and enriches SOC2', async () => {
    const runDir = mkdtempSync(join(tmpdir(), 'bluemagma-enrich-'));
    try {
      prepCompanies({ inputCsv: join(fixturesDir, 'people.csv'), runDir });
      const companies = readCsv(join(runDir, 'companies.csv'));
      assert.equal(companies.length, 6);
      const unresolvable = readCsv(join(runDir, 'companies_unresolvable.csv'));
      assert.equal(unresolvable.length, 1);

      await resolveWebsites({ runDir, fixtures: true, acceptMedium: true });
      const withDomains = readCsv(join(runDir, 'companies_with_domains.csv'));
      const byName = Object.fromEntries(withDomains.map((r) => [r.company_name, r]));
      assert.equal(byName['ShipHero']?.company_domain, 'shiphero.com');
      assert.equal(byName['Acme Widgets']?.company_domain, 'acmewidgets.example');

      assert.equal(byName['ShipHero']?.total_funding, '25000000');
      assert.equal(byName['ShipHero']?.total_funding_printed, '25M');
      assert.equal(byName['ShipHero']?.latest_funding_stage, 'Series B');
      assert.equal(byName['ShipHero']?.latest_funding_round_date, '2021-06-15');
      const shEvents = JSON.parse(byName['ShipHero']?.funding_events ?? '[]');
      assert.equal(shEvents.length, 2);
      assert.equal(shEvents[0].type, 'Series B');
      assert.equal(byName['Acme Widgets']?.total_funding, '');
      assert.equal(byName['Acme Widgets']?.funding_events, '');

      await classifyRoles({ runDir, fixtures: true });
      const classified = readCsv(join(runDir, 'companies_classified.csv'));
      const roleByName = Object.fromEntries(classified.map((r) => [r.company_name, r.company_role]));
      assert.equal(roleByName['Dash ComplyOps'], 'compliance_platform');
      assert.equal(roleByName['Fine Point CPA'], 'auditor');
      assert.equal(roleByName['Managed Risk Partners'], 'consultant');
      assert.equal(roleByName['ShipHero'], 'prospect');
      assert.equal(roleByName['Speakeasy'], 'prospect');

      await enrichSoc2({ runDir, fixtures: true });
      const soc2 = readCsv(join(runDir, 'companies_soc2.csv'));
      const soc2ByName = Object.fromEntries(soc2.map((r) => [r.company_name, r]));
      assert.equal(soc2ByName['ShipHero']?.has_soc2, 'yes');
      assert.equal(soc2ByName['ShipHero']?.soc2_method, 'trust_page');
      assert.equal(soc2ByName['Speakeasy']?.has_soc2, 'no');
      assert.equal(soc2ByName['Acme Widgets']?.has_soc2, 'no');

      await enrichFunding({ runDir, fixtures: true });
      const funding = readCsv(join(runDir, 'companies_funding.csv'));
      const fundByName = Object.fromEntries(funding.map((r) => [r.company_name, r]));
      assert.equal(fundByName['Speakeasy']?.total_funding, '68000000');
      assert.equal(fundByName['Speakeasy']?.latest_funding_stage, 'Series B');
      assert.equal(fundByName['Acme Widgets']?.total_funding, '');

      const merged = mergeEnriched(runDir);
      assert.equal(merged.dropped, 1);
      const outreach = readCsv(join(runDir, 'outreach_enriched.csv'));
      assert.ok(outreach.every((r) => r.company_role !== 'compliance_platform'));
      assert.ok(outreach.some((r) => r.company === 'Fine Point CPA' && r.company_role === 'auditor'));

      const shPerson = outreach.find((r) => r.company === 'ShipHero');
      assert.ok(shPerson, 'ShipHero person should be in outreach');
      assert.equal(shPerson?.total_funding_printed, '25M');
      assert.equal(shPerson?.latest_funding_stage, 'Series B');
      const shPersonEvents = JSON.parse(shPerson?.funding_events ?? '[]');
      assert.equal(shPersonEvents.length, 2);

      const acmePerson = outreach.find((r) => r.company === 'Acme Widgets');
      assert.ok(acmePerson, 'Acme Widgets person should be in outreach');
      assert.equal(acmePerson?.total_funding, '');
      assert.equal(acmePerson?.funding_events, '');

      const summary = loadJson<{
        unique_companies: number;
        dropped_platform_people: number;
        with_funding: number;
      }>(join(runDir, 'summary.json'));
      assert.equal(summary?.unique_companies, 6);
      assert.equal(summary?.dropped_platform_people, 1);
      assert.ok((summary?.with_funding ?? 0) >= 2, `Expected at least 2 funded companies, got ${summary?.with_funding}`);
    } finally {
      rmSync(runDir, { recursive: true, force: true });
    }
  });
});
