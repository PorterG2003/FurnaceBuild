import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixturesDir } from './lib/env.js';
import { resetUrlMapCache } from './lib/http.js';
import { loadCcdSchools } from './ioSchools.js';
import { harvestStaffDirectories } from './directoryHarvest.js';
import { directoryLinkScore, matchSchoolHint, parseStaffDirectory } from './directoryParse.js';
import { loadDistrictDomainsCsv } from './seedDistrictDomains.js';
import { classifySchoolRole } from './schoolRoles.js';
import type { ListedSchool } from './types.js';

function palmdaleSchools(): ListedSchool[] {
  return loadCcdSchools(join(fixturesDir, 'ccd-schools.json'))
    .filter((row) => row.leaid === '0629640' || row.leaid === '0627210')
    .map((row) => ({
      ...row,
      lea_name: row.leaid === '0629640' ? 'Palmdale School District' : 'Newport-Mesa Unified',
      excluded: row.ncessch === '062964000001',
      exclude_reason: row.ncessch === '062964000001' ? 'closed_won_school' : '',
      won_account_id: '',
      won_account_name: '',
      match_confidence: '',
      match_score: '',
    }))
    .filter((row) => !row.excluded);
}

describe('directoryParse', () => {
  it('extracts school-tagged leadership emails and skips teachers', () => {
    const html = readFileSync(join(fixturesDir, 'pages/palmdale-staff.html'), 'utf8');
    const people = parseStaffDirectory(html, 'https://www.palmdalesd.org/staff-directory');
    assert.ok(people.some((row) => row.email === 'maya.chen@palmdalesd.org' && /instructional/i.test(row.title)));
    assert.ok(people.some((row) => row.email === 'elena.brooks@palmdalesd.org'));
    assert.ok(people.some((row) => row.email === 'dana.west@palmdalesd.org'));
    assert.equal(people.some((row) => /teacher/i.test(row.title)), false);
    assert.equal(
      people.find((row) => row.email === 'maya.chen@palmdalesd.org')?.school_hint.toLowerCase().includes('tumbleweed'),
      true,
    );
  });

  it('decodes Finalsite obfuscated emails and school locations', () => {
    const html = readFileSync(join(fixturesDir, 'pages/palmdale-finalsite.html'), 'utf8');
    const people = parseStaffDirectory(html, 'https://www.palmdalesd.org/directory');
    assert.equal(people.length, 3);
    assert.equal(people.find((row) => row.email === 'elena.brooks@palmdalesd.org')?.title, 'Assistant Principal');
    assert.equal(people.find((row) => row.email === 'maya.chen@palmdalesd.org')?.school_hint.toLowerCase().includes('tumbleweed'), true);
    assert.equal(people.some((row) => /helper/i.test(row.last_name)), false);
  });

  it('matches a heading to the NCES school in the same district', () => {
    const schools = palmdaleSchools().filter((row) => row.leaid === '0629640');
    const hit = matchSchoolHint('Tumbleweed Elementary', schools);
    assert.equal(hit?.ncessch, '062964000003');
    assert.equal(
      matchSchoolHint('Tumbleweed Elementary', schools, 'https://www.palmdalesd.org/staff-directory')?.ncessch,
      '062964000003',
    );
    assert.equal(directoryLinkScore('/staff-directory', 'Staff Directory') >= 5, true);
    assert.equal(directoryLinkScore('/directory', 'District Directory') >= 5, true);
    assert.equal(directoryLinkScore('/our-district/leadership/board-of-education', 'Board of Education') === 0, true);
    assert.equal(classifySchoolRole('Principal'), 'principal');
  });
});

describe('directoryHarvest', () => {
  it('follows a district homepage to the staff directory and tags NCES schools', async () => {
    resetUrlMapCache();
    const runDir = mkdtempSync(join(tmpdir(), 'tm-dir-'));
    const harvested = await harvestStaffDirectories({
      runDir,
      schools: palmdaleSchools(),
      domains: loadDistrictDomainsCsv(join(fixturesDir, 'district-domains.csv')),
      fixtures: true,
    });
    const tumbleweed = harvested.contacts.filter((row) => row.ncessch === '062964000003');
    assert.equal(tumbleweed.length, 3);
    assert.equal(tumbleweed.every((row) => row.provider === 'directory'), true);
    assert.equal(harvested.contacts.some((row) => row.ncessch === '062964000001'), false);
  });
});
