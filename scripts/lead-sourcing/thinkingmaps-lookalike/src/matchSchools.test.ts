import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'csv-parse/sync';
import { fixturesDir } from './lib/env.js';
import { loadCcdSchools, schoolsByLeaid } from './ioSchools.js';
import { isSchoolAccount, matchSchoolInDistrict, matchWonSchools } from './matchSchools.js';
import { parseWonAccountRow } from './rollup.js';
import type { DistrictMatch } from './types.js';

describe('matchWonSchools', () => {
  it('matches child schools only inside the parent district', () => {
    const raw = parse(readFileSync(join(fixturesDir, 'closed-won-sample.csv'), 'utf8'), {
      columns: true,
      skip_empty_lines: true,
      bom: true,
    }) as Record<string, string>[];
    const accounts = raw.map(parseWonAccountRow);
    assert.equal(accounts.filter(isSchoolAccount).map((row) => row.account_name).includes('Palm Tree Elementary'), true);
    assert.equal(accounts.some((row) => row.account_name === 'Montebello USD' && isSchoolAccount(row)), false);

    const schools = loadCcdSchools(join(fixturesDir, 'ccd-schools.json'));
    const matches: DistrictMatch[] = [
      {
        district_key: 'palmdale|CA',
        district_name: 'Palmdale School District',
        state: 'CA',
        city: 'palmdale',
        zip: '93550',
        revenue: 1,
        account_count: 2,
        is_charter: false,
        is_nyc_subunit: false,
        leaid: '0629640',
        nces_name: 'Palmdale School District',
        nces_city: 'Palmdale',
        nces_state: 'CA',
        confidence: 'high',
        method: 'exact',
        score: 1,
        needs_review: false,
        review_reason: '',
      },
      {
        district_key: 'heartland charter|CA',
        district_name: 'Heartland Charter District',
        state: 'CA',
        city: 'bakersfield',
        zip: '93309',
        revenue: 1,
        account_count: 1,
        is_charter: true,
        is_nyc_subunit: false,
        leaid: '0601590',
        nces_name: 'Heartland Charter',
        nces_city: 'Bakersfield',
        nces_state: 'CA',
        confidence: 'high',
        method: 'exact',
        score: 1,
        needs_review: false,
        review_reason: '',
      },
    ];
    const schoolMatches = matchWonSchools({
      accounts,
      matches,
      byLeaid: schoolsByLeaid(schools),
    });
    const byName = Object.fromEntries(schoolMatches.map((row) => [row.account_name, row]));
    assert.equal(byName['Palm Tree Elementary']?.ncessch, '062964000001');
    assert.equal(byName['Palm Tree Elementary']?.confidence, 'high');
    assert.equal(byName['Palmdale High']?.ncessch, '062964000002');
    assert.equal(byName['Heartland Charter School']?.ncessch, '060159000001');
    assert.equal(byName['Montebello USD'], undefined);
  });

  it('leaves ambiguous same-name schools for review instead of excluding', () => {
    const schools = loadCcdSchools(join(fixturesDir, 'ccd-schools.json')).filter((row) => row.leaid === '0629640');
    const account = parseWonAccountRow({
      'Account Name': 'Lincoln Elementary',
      'Parent Account': 'Palmdale School District',
      ' Closed-Won Total ': '1',
      'Billing City': '',
      'Billing State': 'CA',
      'Billing ZIP': '',
    });
    const hit = matchSchoolInDistrict(account, schools);
    assert.equal(hit.unique, false);
    assert.ok(hit.reason.includes('ambiguous'));
  });
});
