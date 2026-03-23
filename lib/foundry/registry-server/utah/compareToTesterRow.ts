import { normalizePersonName } from './normalizeName.js';
import type { CompareOutcome, TesterCompareResult } from './types.js';

function tokenSet(s: string): Set<string> {
  return new Set(
    normalizePersonName(s)
      .split(' ')
      .filter((t) => t.length > 1),
  );
}

/**
 * Compare Utah registry Member name(s) to CSV enrichment "Name - People - Results".
 */
export function compareToTesterRow(
  memberNames: string[],
  expectedPeopleName: string,
): TesterCompareResult {
  const exp = expectedPeopleName?.trim() ?? '';
  if (!exp) {
    return {
      outcome: 'skipped',
      reason: 'no_expected_name_in_csv',
      memberNamesFound: memberNames,
      expectedNormalized: '',
    };
  }

  const expectedNorm = normalizePersonName(exp);
  const expectedTokens = tokenSet(exp);

  if (memberNames.length === 0) {
    return {
      outcome: 'no_match',
      reason: 'no_member_principals',
      memberNamesFound: [],
      expectedNormalized: expectedNorm,
    };
  }

  let best: { outcome: CompareOutcome; reason: string } = {
    outcome: 'no_match',
    reason: 'no_token_overlap',
  };

  for (const m of memberNames) {
    const mn = normalizePersonName(m);
    if (mn === expectedNorm) {
      return {
        outcome: 'match',
        reason: 'exact_normalized',
        memberNamesFound: memberNames,
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
        memberNamesFound: memberNames,
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
    memberNamesFound: memberNames,
    expectedNormalized: expectedNorm,
  };
}
