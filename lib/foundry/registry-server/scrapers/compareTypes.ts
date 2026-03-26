export type CompareOutcome = 'match' | 'partial' | 'no_match' | 'skipped';

export type ExpectedPersonCompareResult = {
  outcome: CompareOutcome;
  reason: string;
  namesFound: string[];
  expectedNormalized: string;
};
