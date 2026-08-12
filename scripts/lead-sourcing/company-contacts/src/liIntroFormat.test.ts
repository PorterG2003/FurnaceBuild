import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatLiIntroLine, parseDurationYears } from './liIntroFormat.js';

describe('parseDurationYears', () => {
  it('parses Clay-style durations', () => {
    assert.equal(parseDurationYears('4 yrs 7 mos'), 4);
    assert.equal(parseDurationYears('15 yrs 7 mos'), 15);
    assert.equal(parseDurationYears('1 yr 2 mos'), 1);
    assert.equal(parseDurationYears('0 yrs 8 mos'), 0);
  });

  it('returns null for empty/unparseable', () => {
    assert.equal(parseDurationYears(''), null);
    assert.equal(parseDurationYears(null), null);
    assert.equal(parseDurationYears('Present'), null);
  });
});

describe('formatLiIntroLine', () => {
  it('matches existing tenure openers', () => {
    assert.deepEqual(formatLiIntroLine('Managing Partner', '4 yrs 7 mos'), {
      li_time_in_role: '4 yrs 7 mos',
      li_intro_line: 'In your 4 years as Managing Partner',
      source: 'tenure',
    });
    assert.deepEqual(
      formatLiIntroLine('Co-Founder Chief of Music and Therapeutics', '15 yrs 7 mos'),
      {
        li_time_in_role: '15 yrs 7 mos',
        li_intro_line: 'In your 15 years as Co-Founder Chief of Music and Therapeutics',
        source: 'tenure',
      },
    );
  });

  it('uses singular year', () => {
    assert.equal(formatLiIntroLine('CEO', '1 yr 3 mos').li_intro_line, 'In your 1 year as CEO');
  });

  it('falls back under 1 year or missing duration', () => {
    assert.deepEqual(formatLiIntroLine('CEO', '0 yrs 8 mos'), {
      li_time_in_role: '0 yrs 8 mos',
      li_intro_line: 'As CEO',
      source: 'fallback',
    });
    assert.deepEqual(formatLiIntroLine('President', ''), {
      li_time_in_role: '',
      li_intro_line: 'As President',
      source: 'fallback',
    });
    assert.deepEqual(formatLiIntroLine('Founder', null), {
      li_time_in_role: '',
      li_intro_line: 'As Founder',
      source: 'fallback',
    });
  });
});
