import { compareToExpectedPerson } from '../scrapers/compareToExpectedPerson.js';
import type { TesterCompareResult } from './types.js';

/** Utah CSV column compares Member principals; same logic as compareToExpectedPerson. */
export function compareToTesterRow(
  memberNames: string[],
  expectedPeopleName: string,
): TesterCompareResult {
  const r = compareToExpectedPerson(memberNames, expectedPeopleName);
  const reason =
    r.reason === 'no_expected_name'
      ? 'no_expected_name_in_csv'
      : r.reason === 'no_expected_scrape_ok'
        ? 'no_expected_scrape_ok'
        : r.reason === 'no_names_extracted'
          ? 'no_member_principals'
          : r.reason;
  return {
    outcome: r.outcome,
    reason,
    memberNamesFound: r.namesFound,
    expectedNormalized: r.expectedNormalized,
  };
}
