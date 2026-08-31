import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixturesDir } from './lib/env.js';
import { readCsv } from './lib/csv.js';
import { prepWonDistricts } from './prep.js';
import { matchWonToCcd } from './match.js';
import { loadCcdUniverse } from './ioCcd.js';
import { fillWithApollo } from './apolloSchools.js';
import { fillWithMoltsets } from './moltsets.js';
import { importQuickEnrichContacts } from './quickenrich.js';
import { fillAllSchools } from './schoolContacts.js';
import { buildSchoolUniverse } from './schoolUniverse.js';

describe('won-district school contact pipeline', () => {
  it('lists schools, excludes exact closed-won matches, and fills three role slots from the waterfall', async () => {
    const runDir = mkdtempSync(join(tmpdir(), 'tm-schools-'));
    const universe = loadCcdUniverse(join(fixturesDir, 'ccd-universe.json'));
    prepWonDistricts({
      inputCsv: join(fixturesDir, 'closed-won-sample.csv'),
      avoidCsv: join(fixturesDir, 'avoid-list-sample.csv'),
      runDir,
    });
    matchWonToCcd({ runDir, universe });
    const built = buildSchoolUniverse({
      runDir,
      matchesPath: join(runDir, 'matches.csv'),
      schoolsPath: join(fixturesDir, 'ccd-schools.json'),
      closedWonCsv: join(fixturesDir, 'closed-won-sample.csv'),
    });

    const excluded = built.listed.filter((row) => row.excluded);
    assert.ok(excluded.some((row) => row.school_name === 'Palm Tree Elementary'));
    assert.ok(excluded.some((row) => row.school_name === 'Palmdale High'));
    assert.ok(excluded.some((row) => row.school_name === 'Heartland Charter School'));
    assert.equal(built.eligible.some((row) => row.school_name === 'Palm Tree Elementary'), false);
    assert.ok(built.eligible.some((row) => row.school_name === 'Tumbleweed Elementary'));
    assert.ok(built.eligible.some((row) => row.school_name === 'Newport Elementary'));
    assert.equal(built.eligible.some((row) => row.leaid === '0617100'), false);

    const imported = importQuickEnrichContacts(join(fixturesDir, 'quickenrich-result.csv'), built.eligible);
    const afterQe = fillAllSchools({ schools: built.eligible, contacts: imported.contacts });
    assert.equal(afterQe.picked.some((row) => /teacher/i.test(row.title)), false);
    assert.equal(afterQe.picked.some((row) => /google/i.test(row.company)), false);
    const newportQe = afterQe.picked.filter((row) => row.ncessch === '062721000001');
    assert.ok(newportQe.some((row) => row.role === 'curriculum'));
    assert.ok(newportQe.some((row) => row.role === 'assistant_principal'));

    const molt = await fillWithMoltsets({
      runDir,
      schools: built.eligible,
      picked: afterQe.picked,
      live: false,
      dryRun: false,
      fixtures: true,
    });
    const afterMolt = fillAllSchools({
      schools: built.eligible,
      contacts: [...imported.contacts, ...molt.contacts],
    });
    const tumbleweedMolt = afterMolt.picked.filter((row) => row.ncessch === '062964000003');
    assert.ok(tumbleweedMolt.some((row) => row.role === 'assistant_principal' && row.provider === 'moltsets'));

    const apollo = await fillWithApollo({
      runDir,
      schools: built.eligible,
      picked: afterMolt.picked,
      live: false,
      dryRun: false,
      fixtures: true,
    });
    const filled = fillAllSchools({
      schools: built.eligible,
      contacts: [...imported.contacts, ...molt.contacts, ...apollo.contacts],
    });
    const bySchool = new Map<string, number>();
    for (const contact of filled.picked) {
      bySchool.set(contact.ncessch, (bySchool.get(contact.ncessch) ?? 0) + 1);
    }
    assert.ok([...bySchool.values()].every((count) => count <= 3));
    assert.equal(filled.picked.some((row) => row.ncessch === '062964000001'), false);

    const tumbleweed = filled.picked.filter((row) => row.ncessch === '062964000003');
    assert.equal(tumbleweed.length, 3);
    assert.deepEqual(
      tumbleweed.map((row) => row.role).sort(),
      ['assistant_principal', 'curriculum', 'principal'],
    );
    assert.equal(tumbleweed.find((row) => row.role === 'curriculum')?.provider, 'quickenrich');
    assert.equal(tumbleweed.find((row) => row.role === 'assistant_principal')?.provider, 'moltsets');
    assert.equal(tumbleweed.find((row) => row.role === 'principal')?.provider, 'apollo');

    const review = readCsv(join(runDir, 'won_school_match_review.csv'));
    assert.ok(Array.isArray(review));
    const eligibleCsv = readCsv(join(runDir, 'eligible_schools.csv'));
    assert.equal(eligibleCsv.some((row) => row.school_name === 'Palm Tree Elementary'), false);
    JSON.parse(readFileSync(join(runDir, 'school_universe_summary.json'), 'utf8'));
  });
});
