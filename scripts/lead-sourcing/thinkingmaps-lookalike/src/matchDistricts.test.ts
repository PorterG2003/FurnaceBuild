import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixturesDir } from './lib/env.js';
import { matchDistricts } from './matchDistricts.js';
import { parseWonAccountRow, rollupDistricts } from './rollup.js';
import { parse } from 'csv-parse/sync';
import type { CcdDistrict } from './types.js';

describe('matchDistricts', () => {
  it('matches sample closed-won names including NYC collapse', () => {
    const raw = parse(readFileSync(join(fixturesDir, 'closed-won-sample.csv'), 'utf8'), {
      columns: true,
      skip_empty_lines: true,
      bom: true,
    }) as Record<string, string>[];
    const won = rollupDistricts(raw.map(parseWonAccountRow));
    const universe = JSON.parse(readFileSync(join(fixturesDir, 'ccd-universe.json'), 'utf8')) as CcdDistrict[];
    const matches = matchDistricts(won, universe);
    const byName = Object.fromEntries(matches.map((m) => [m.district_name, m]));
    assert.equal(byName['Montebello USD']?.leaid, '0625470');
    assert.equal(byName['Newport-Mesa Unified School District']?.leaid, '0627210');
    assert.equal(byName['New York City Geographic District #10']?.leaid, '3620580');
    assert.equal(byName['New York City Geographic District #10']?.method, 'override');
    assert.equal(byName['Chandler Unified District #80 (4242)']?.leaid, '0401870');
    assert.equal(byName['Fayette County KY']?.leaid, '2101860');
    assert.ok(matches.every((m) => m.leaid || m.method === 'unmatched'));
  });
});
