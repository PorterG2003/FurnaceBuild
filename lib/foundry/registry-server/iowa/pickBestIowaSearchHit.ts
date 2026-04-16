import { pickBestEntityHit } from '../scrapers/pickBestEntityHit.js';
import type { IowaSearchHit } from './types.js';

export type PickIowaHitResult =
  | { hit: IowaSearchHit; ambiguous: false }
  | { hit: null; ambiguous: true; candidates: IowaSearchHit[] }
  | { hit: null; ambiguous: false; candidates: IowaSearchHit[] };

function resolveIowaHighScoreTie(tied: IowaSearchHit[], queryNorm: string): IowaSearchHit {
  const llcPreferred = tied.filter(
    (x) =>
      /\bLLC\b/i.test(x.entityName) ||
      /Limited Liability Company/i.test(x.entityName) ||
      /^L$/i.test((x.nameType ?? '').trim()),
  );
  const pool = llcPreferred.length > 0 ? llcPreferred : tied;
  const active = pool.filter((x) => /active/i.test(x.status));
  const pickFrom = active.length > 0 ? active : pool;
  pickFrom.sort((a, b) => {
    const qa = queryNorm.length ? a.entityName.length - b.entityName.length : 0;
    if (qa !== 0) return -qa;
    return a.entityName.localeCompare(b.entityName);
  });
  return pickFrom[0];
}

/**
 * Pick best Iowa search hit for a company name query (LLC / legal-type preference on ties).
 */
export function pickBestIowaSearchHit(hits: IowaSearchHit[], query: string): PickIowaHitResult {
  return pickBestEntityHit(hits, query, resolveIowaHighScoreTie) as PickIowaHitResult;
}
