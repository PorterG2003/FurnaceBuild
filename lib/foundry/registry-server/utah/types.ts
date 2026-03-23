/** Parsed row from Utah business search results grid */
export type UtahSearchHit = {
  /** Numeric id passed to GetBusinessSearchResultById */
  businessId: string;
  businessReservationNumber: string;
  /** Display name (first column link text) */
  entityName: string;
  /** e.g. 11672536-0160 */
  entityNumber: string;
  status: string;
  entityType: string;
};

export type UtahPrincipal = {
  title: string;
  name: string;
  address: string;
  lastUpdated: string;
};

export type UtahEntityDetailParsed = {
  entityNumber: string;
  entityName: string;
  /** From detail page "Entity Status" when parseable */
  entityStatus?: string;
  principals: UtahPrincipal[];
};

export type CompareOutcome = 'match' | 'partial' | 'no_match' | 'skipped';

export type TesterCompareResult = {
  outcome: CompareOutcome;
  reason: string;
  memberNamesFound: string[];
  expectedNormalized: string;
};
