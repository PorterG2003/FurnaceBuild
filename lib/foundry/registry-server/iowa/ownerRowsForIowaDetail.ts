import { eligibleIndividualRegisteredAgentName } from '../scrapers/registeredAgentPerson.js';
import type { IowaEntityDetailParsed } from './types.js';
import type { PersistEntityOwnerInput } from '../state-persistence/ownerDrilldown.js';

function titleForOfficerRow(o: IowaEntityDetailParsed['officers'][number]): string {
  const type = (o.officerType ?? '').trim();
  const dir = (o.directorFlag ?? '').trim();
  if (/^yes$/i.test(dir) || /^y$/i.test(dir)) {
    return type ? `${type} (Director)` : 'Director';
  }
  return type || 'Officer';
}

/**
 * Iowa `entity_owners` from the officer grid, with **registered agent as fallback** only when there
 * are no officer rows and the RA name looks like an individual (not a company).
 */
export function ownerRowsForIowaDetail(detail: IowaEntityDetailParsed): PersistEntityOwnerInput[] {
  const fromOfficers = detail.officers.map((o) => ({
    ownerName: o.name.trim() || 'Unknown',
    titleRole: titleForOfficerRow(o),
  }));
  if (fromOfficers.length > 0) return fromOfficers;

  const ra = detail.registeredAgentName?.trim();
  if (ra && eligibleIndividualRegisteredAgentName(ra)) {
    return [{ ownerName: ra, titleRole: 'Registered Agent' }];
  }
  return [];
}
