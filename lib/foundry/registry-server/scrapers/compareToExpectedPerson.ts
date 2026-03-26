import { normalizePersonName } from './normalizeNames.js';
import type { CompareOutcome, ExpectedPersonCompareResult } from './compareTypes.js';

function tokenSet(s: string): Set<string> {
  return new Set(
    normalizePersonName(s)
      .split(' ')
      .filter((t) => t.length > 1),
  );
}

/**
 * Compare scraped person name(s) to an expected display name (e.g. CSV "Name - People - Results").
 */
export function compareToExpectedPerson(
  scrapedNames: string[],
  expectedPeopleName: string,
): ExpectedPersonCompareResult {
  const exp = expectedPeopleName?.trim() ?? '';
  if (!exp) {
    return {
      outcome: 'skipped',
      reason: 'no_expected_name',
      namesFound: scrapedNames,
      expectedNormalized: '',
    };
  }

  const expectedNorm = normalizePersonName(exp);
  const expectedTokens = tokenSet(exp);

  if (scrapedNames.length === 0) {
    return {
      outcome: 'no_match',
      reason: 'no_names_extracted',
      namesFound: [],
      expectedNormalized: expectedNorm,
    };
  }

  let best: { outcome: CompareOutcome; reason: string } = {
    outcome: 'no_match',
    reason: 'no_token_overlap',
  };

  for (const m of scrapedNames) {
    const mn = normalizePersonName(m);
    if (mn === expectedNorm) {
      return {
        outcome: 'match',
        reason: 'exact_normalized',
        namesFound: scrapedNames,
        expectedNormalized: expectedNorm,
      };
    }
    const mTokens = tokenSet(m);
    let overlap = 0;
    for (const t of expectedTokens) {
      if (mTokens.has(t)) overlap += 1;
    }
    const minLen = Math.min(expectedTokens.size, mTokens.size);
    if (minLen > 0 && overlap >= minLen) {
      return {
        outcome: 'match',
        reason: 'all_tokens_overlap',
        namesFound: scrapedNames,
        expectedNormalized: expectedNorm,
      };
    }
    if (overlap >= Math.ceil(expectedTokens.size * 0.5) && expectedTokens.size >= 2) {
      best = { outcome: 'partial', reason: 'partial_token_overlap' };
    } else if (overlap > 0 && best.outcome === 'no_match') {
      best = { outcome: 'partial', reason: 'weak_token_overlap' };
    }
  }

  return {
    outcome: best.outcome,
    reason: best.reason,
    namesFound: scrapedNames,
    expectedNormalized: expectedNorm,
  };
}
