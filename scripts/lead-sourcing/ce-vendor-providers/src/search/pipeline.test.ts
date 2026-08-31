import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { requireLiveForSerper } from '../lib/cli.js';
import { buildSearchQueries, estimateSerperCredits } from './queries.js';
import { loadQueriesConfig } from '../lib/config.js';
import { harvestSearch } from './harvest.js';
import { ingestDirectories } from '../directories/ingest.js';
import { classifyEntries } from '../classify/run.js';
import { resolveFit } from '../fit/run.js';
import { aggregateRun } from '../aggregate/run.js';
import { readCsv } from '../lib/csv.js';

describe('search gates and fixture pipeline', () => {
  it('throws before Serper when --live is missing', () => {
    assert.throws(
      () => requireLiveForSerper({ live: false, dryRun: false, fixtures: false }),
      /--live/,
    );
    assert.doesNotThrow(() => requireLiveForSerper({ live: false, dryRun: true, fixtures: false }));
    assert.doesNotThrow(() => requireLiveForSerper({ live: false, dryRun: false, fixtures: true }));
  });

  it('builds host queries as phrase plus credit term, not a 4-way cartesian', () => {
    const config = loadQueriesConfig();
    const queries = buildSearchQueries(config, 'host', 1);
    assert.ok(queries.length > 10);
    assert.ok(queries.length < 200);
    assert.ok(queries.some((q) => q.includes('upcoming webinar') && q.includes('CE')));
    const estimate = estimateSerperCredits(queries.length, 2);
    assert.equal(estimate.credits, queries.length * 2);
  });

  it('runs the fixture pipeline to a tier-1 prospects.csv', async () => {
    const runDir = mkdtempSync(join(tmpdir(), 'ce-vendor-'));
    await ingestDirectories({ runDir, fixtures: true });
    await classifyEntries({ runDir, fixtures: true });
    await resolveFit({ runDir, fixtures: true });
    await harvestSearch({ runDir, mode: 'host', fixtures: true, live: false, maxQueries: 3, maxPages: 1 });
    await harvestSearch({ runDir, mode: 'grant', fixtures: true, live: false, maxQueries: 3, maxPages: 1 });
    aggregateRun(runDir);

    const prospects = readCsv(join(runDir, 'prospects.csv'));
    const coverage = JSON.parse(
      (await import('node:fs')).readFileSync(join(runDir, 'coverage_report.json'), 'utf8'),
    ) as { banner: string; composition: { self_provided_share: number }; funnel: { tier_1: number } };

    const acme = prospects.find((p) => /acme windows/i.test(p.company_name));
    const ledger = prospects.find((p) => /ledgersoft/i.test(p.company_name));
    const therapy = prospects.find((p) => /therapymatch/i.test(p.company_name));
    const care = prospects.find((p) => /carebridge/i.test(p.company_name));
    const novo = prospects.find((p) => /novo/i.test(p.company_name));
    const hospital = prospects.find((p) => /county general/i.test(p.company_name));

    assert.equal(acme?.fit_tier, '1');
    assert.equal(acme?.audience_relationship, 'partner');
    assert.equal(acme?.has_live_online, 'true');
    assert.match(acme?.ce_formats ?? '', /live_online/);
    assert.equal(ledger?.fit_tier, '1');
    assert.equal(therapy?.fit_tier, '1');
    assert.equal(care?.fit_tier, '2');
    assert.equal(novo?.fit_tier, '2');
    assert.equal(hospital?.fit_tier, '0');
    assert.ok(coverage.funnel.tier_1 >= 1);
    assert.match(coverage.banner, /not a census/i);
    const hosts = readCsv(join(runDir, 'host_prospects.csv'));
    assert.equal(
      hosts.find((p) => /acme windows/i.test(p.company_name)),
      undefined,
    );
    assert.ok(hosts.some((p) => /ce_platform/.test(p.source_directories ?? '')));
  });
});
