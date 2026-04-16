import { eligibleIndividualRegisteredAgentName } from '../scrapers/registeredAgentPerson.js';
import type { FloridaEntityDetailParsed } from './types.js';
import type { PersistEntityOwnerInput } from '../state-persistence/ownerDrilldown.js';

/**
 * Florida `entity_owners` from Sunbiz detail.
 *
 * **Registered agent:** use the RA line only as a **fallback** when there are no officers or
 * authorized persons in `detail.people`. The name must pass {@link eligibleIndividualRegisteredAgentName}.
 * Title for that row is always **`Registered Agent`**.
 *
 * **Titles:** use the site’s title when present; otherwise **`Officer`** or **`Authorized person`**
 * from the person’s `source`.
 */
export function ownerRowsForFloridaDetail(detail: FloridaEntityDetailParsed): PersistEntityOwnerInput[] {
  const fromOffices = detail.people.filter((p) => p.source !== 'registered_agent');
  const rows = fromOffices.map((p) => ({
    ownerName: p.name.trim() || 'Unknown',
    titleRole: p.title.trim() || (p.source === 'officer' ? 'Officer' : 'Authorized person'),
  }));
  if (rows.length > 0) return rows;

  const ra = detail.registeredAgentName?.trim();
  if (ra && eligibleIndividualRegisteredAgentName(ra)) {
    return [{ ownerName: ra, titleRole: 'Registered Agent' }];
  }
  return [];
}

/** Same owner names as {@link ownerRowsForFloridaDetail} (for CSV / tests). */
export function filterFloridaOwnerPeople(detail: FloridaEntityDetailParsed): string[] {
  return ownerRowsForFloridaDetail(detail).map((r) => r.ownerName);
}
