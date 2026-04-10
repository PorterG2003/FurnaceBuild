import type { SkipSherpaLookupPayload } from '../contact-enrichment/contactEnrichment.js';

export const SKIP_SHERPA_PERSON_URL = 'https://skipsherpa.com/api/beta6/person';

function headersToRecord(response: Response): Record<string, string> {
  const out: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

/** Extract `person_results` from a parsed JSON body, or []. */
export function parsePersonResultsArray(body: unknown): unknown[] {
  if (!body || typeof body !== 'object') return [];
  const pr = (body as { person_results?: unknown }).person_results;
  return Array.isArray(pr) ? pr : [];
}

/**
 * One Skip Sherpa hit (credit) when the batch HTTP status is 2xx and this row includes
 * at least one person object in `persons` (vendor returned person data for this lookup).
 */
export function skipSherpaPersonRowHasBillableHit(httpStatus: number, personResultRow: unknown): boolean {
  if (httpStatus < 200 || httpStatus >= 300) return false;
  if (!personResultRow || typeof personResultRow !== 'object') return false;
  const persons = (personResultRow as { persons?: unknown }).persons;
  return Array.isArray(persons) && persons.length > 0;
}

export type SkipSherpaPersonLookupResponse = {
  httpStatus: number;
  body: unknown;
  personResults: unknown[];
  headers: Record<string, string>;
};

export async function callSkipSherpaPersonLookup(
  apiKey: string,
  lookups: SkipSherpaLookupPayload[],
): Promise<SkipSherpaPersonLookupResponse> {
  const response = await fetch(SKIP_SHERPA_PERSON_URL, {
    method: 'PUT',
    headers: {
      'API-Key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ person_lookups: lookups }),
  });
  const body = (await response.json().catch(() => ({}))) as unknown;
  return {
    httpStatus: response.status,
    body,
    personResults: parsePersonResultsArray(body),
    headers: headersToRecord(response),
  };
}
