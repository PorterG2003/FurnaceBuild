import type { IowaEntityDetailParsed } from './types.js';
import type { PersistEntityOwnerInput } from '../state-persistence/ownerDrilldown.js';

function titleForOfficerRow(o: IowaEntityDetailParsed['officers'][number]): string | null {
  const type = (o.officerType ?? '').trim();
  const dir = (o.directorFlag ?? '').trim();
  if (/^yes$/i.test(dir) || /^y$/i.test(dir)) {
    return type ? `${type} (Director)` : 'Director';
  }
  return type || null;
}

/**
 * Map Iowa officer grid rows into owner rows for `replaceCurrentEntityOwners`.
 */
export function ownerRowsForIowaDetail(detail: IowaEntityDetailParsed): PersistEntityOwnerInput[] {
  return detail.officers.map((o) => ({
    ownerName: o.name.trim() || 'Unknown',
    titleRole: titleForOfficerRow(o),
  }));
}
