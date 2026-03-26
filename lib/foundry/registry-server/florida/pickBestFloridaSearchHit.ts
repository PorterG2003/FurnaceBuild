import { pickBestEntityHit } from '../scrapers/pickBestEntityHit.js';
import type { FloridaSearchHit } from './types.js';

export type PickFloridaHitResult =
  | { hit: FloridaSearchHit; ambiguous: false }
  | { hit: null; ambiguous: true; candidates: FloridaSearchHit[] }
  | { hit: null; ambiguous: false; candidates: FloridaSearchHit[] };

function resolveFloridaHighScoreTie(tied: FloridaSearchHit[], queryNorm: string): FloridaSearchHit {
  const llcPreferred = tied.filter((x) => /\bLLC\b/i.test(x.entityName));
  const pool = llcPreferred.length > 0 ? llcPreferred : tied;
  const active = pool.filter((x) => /^active$/i.test((x.status ?? '').trim()));
  const pickFrom = active.length > 0 ? active : pool;
  pickFrom.sort((a, b) => {
    const qa = queryNorm.length ? a.entityName.length - b.entityName.length : 0;
    if (qa !== 0) return -qa;
    return a.entityName.localeCompare(b.entityName);
  });
  return pickFrom[0];
}

export function pickBestFloridaSearchHit(hits: FloridaSearchHit[], query: string): PickFloridaHitResult {
  return pickBestEntityHit(hits, query, resolveFloridaHighScoreTie) as PickFloridaHitResult;
}
