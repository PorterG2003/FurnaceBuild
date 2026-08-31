import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixturesDir } from './lib/env.js';
import { prepWonDistricts } from './prep.js';
import { matchWonToCcd } from './match.js';
import { profileRun } from './profile.js';
import { rankLookalikes, scoreUniverse } from './score.js';
import { scoredMatches } from './profileModel.js';
import { loadMatchesCsv } from './profile.js';
import { holdoutSplit } from './validate.js';
import type { CcdDistrict } from './types.js';

describe('fixture pipeline', () => {
  it('ranks lookalikes, excludes customers/avoid/missing enrollment, and holdout-splits', () => {
    const runDir = mkdtempSync(join(tmpdir(), 'tm-lookalike-'));
    const universe = JSON.parse(readFileSync(join(fixturesDir, 'ccd-universe.json'), 'utf8')) as CcdDistrict[];
    prepWonDistricts({
      inputCsv: join(fixturesDir, 'closed-won-sample.csv'),
      avoidCsv: join(fixturesDir, 'avoid-list-sample.csv'),
      runDir,
    });
    matchWonToCcd({ runDir, universe });
    const profile = profileRun({ runDir, universe });
    const matches = scoredMatches(loadMatchesCsv(join(runDir, 'matches.csv')));
    const wonLeaids = new Set(matches.map((m) => m.leaid));
    const scored = scoreUniverse({
      universe,
      profile,
      wonLeaids,
      avoidLeaids: new Set(['2502790', '0635850']),
      geoWon: universe.filter((d) => wonLeaids.has(d.leaid)),
    });
    const ranked = rankLookalikes(scored);
    assert.equal(ranked.some((r) => wonLeaids.has(r.leaid)), false);
    assert.equal(ranked.some((r) => r.leaid === '2502790'), false);
    assert.equal(ranked.some((r) => r.leaid === '0699999'), false);
    assert.ok(ranked.some((r) => r.leaid === '0617100'));
    assert.ok(ranked[0]!.score >= ranked[ranked.length - 1]!.score);

    const { train, holdout } = holdoutSplit(matches, 0.2, 42);
    assert.equal(train.length + holdout.length, matches.length);
    assert.ok(holdout.length >= 1);
  });
});
