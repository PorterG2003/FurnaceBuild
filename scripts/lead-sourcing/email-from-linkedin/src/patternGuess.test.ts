import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { acceptPatternResult, guessEmailPatterns } from './patternGuess.js';

describe('guessEmailPatterns', () => {
  it('builds common K-12 patterns', () => {
    const guesses = guessEmailPatterns('Mike', 'Roberts', 'heard.k12.ga.us');
    assert.deepEqual(
      guesses.map((g) => g.email),
      [
        'mike.roberts@heard.k12.ga.us',
        'mroberts@heard.k12.ga.us',
        'mikeroberts@heard.k12.ga.us',
        'mike_roberts@heard.k12.ga.us',
        'mike@heard.k12.ga.us',
      ],
    );
  });

  it('strips accents and punctuation from names', () => {
    const guesses = guessEmailPatterns('Joëlle', 'Doye-Smith', 'mp.k12.wi.us');
    assert.equal(guesses[0]?.email, 'joelle.doyesmith@mp.k12.wi.us');
  });
});

describe('acceptPatternResult', () => {
  it('accepts ok for any pattern', () => {
    assert.equal(acceptPatternResult('first', 'ok'), true);
  });

  it('accepts catch_all only for first.last and flast', () => {
    assert.equal(acceptPatternResult('first.last', 'catch_all'), true);
    assert.equal(acceptPatternResult('flast', 'catch_all'), true);
    assert.equal(acceptPatternResult('first', 'catch_all'), false);
    assert.equal(acceptPatternResult('firstlast', 'invalid'), false);
  });
});
