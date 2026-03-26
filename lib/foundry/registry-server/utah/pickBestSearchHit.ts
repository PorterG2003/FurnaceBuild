import { pickBestEntityHit } from '../scrapers/pickBestEntityHit.js';
import type { UtahSearchHit } from './types.js';

export type PickHitResult =
  | { hit: UtahSearchHit; ambiguous: false }
  | { hit: null; ambiguous: true; candidates: UtahSearchHit[] }
  | { hit: null; ambiguous: false; candidates: UtahSearchHit[] };

function resolveUtahHighScoreTie(tied: UtahSearchHit[], queryNorm: string): UtahSearchHit {
  const llcPreferred = tied.filter(
    (x) =>
      /\bLLC\b/i.test(x.entityName) ||
      /Limited Liability Company/i.test(x.entityType) ||
      /Domestic Limited Liability/i.test(x.entityType),
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
 * Pick best search hit for a company name query. Prefer LLC row over DBA when scores tie.
 */
export function pickBestSearchHit(hits: UtahSearchHit[], query: string): PickHitResult {
  return pickBestEntityHit(hits, query, resolveUtahHighScoreTie) as PickHitResult;
}
