/** Row from Iowa SOS business name / number search results */
export type IowaSearchHit = {
  /** Displayed business number (links to summary) */
  businessNumber: string;
  entityName: string;
  status: string;
  /** Name type code per Iowa help, e.g. L (Legal), DF (Domestic Fictitious) */
  nameType: string;
  /** Relative or absolute href from the Business No. link when present */
  summaryHref?: string;
};

/** One officer row from the Iowa officers grid */
export type IowaOfficerRow = {
  name: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  zip: string;
  /** Officer / member type column */
  officerType: string;
  /** Raw Director column (e.g. Yes / No) */
  directorFlag: string;
};

/**
 * Parsed Iowa entity after combining **summary** and **officers** HTML surfaces.
 * Mirrors the role of `UtahEntityDetailParsed` / `FloridaEntityDetailParsed` for persistence.
 */
export type IowaEntityDetailParsed = {
  businessNumber: string;
  legalName: string;
  status?: string;
  /** Domestic LLC / corporation label from summary when present */
  entityType?: string;
  /** Legal name type from names grid, e.g. L */
  nameType?: string;
  stateOfIncorporation?: string;
  chapter?: string;
  registeredAgentName?: string;
  /** Single-line principal office for raw_parsed convenience */
  principalOfficeLine?: string;
  officers: IowaOfficerRow[];
};
