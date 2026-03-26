/** Row from Sunbiz Entity Name List after search */
export type FloridaSearchHit = {
  entityName: string;
  documentNumber: string;
  status: string;
  /** Path + query, e.g. /Inquiry/CorporationSearch/SearchResultDetail?... */
  detailHref: string;
};

export type FloridaPersonRole = {
  title: string;
  name: string;
  source: 'authorized_person' | 'officer' | 'registered_agent';
};

export type FloridaEntityDetailParsed = {
  documentNumber: string;
  entityName: string;
  /** First line under corporationName, e.g. "Florida Limited Liability Company" */
  entityTypeLabel?: string;
  status?: string;
  /** Raw registered agent line when present */
  registeredAgentName?: string;
  people: FloridaPersonRole[];
};
