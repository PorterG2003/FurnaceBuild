import { normalizeBusinessName } from './normalizeNames.js';

export type EntityHitLike = {
  entityName: string;
  status?: string;
  entityType?: string;
};

export type PickEntityHitResult<T extends EntityHitLike> =
  | { hit: T; ambiguous: false }
  | { hit: null; ambiguous: true; candidates: T[] }
  | { hit: null; ambiguous: false; candidates: T[] };

export function scoreEntityNameMatch(queryNorm: string, entityName: string): number {
  const nameNorm = normalizeBusinessName(entityName);
  if (!queryNorm || !nameNorm) return 0;
  if (nameNorm === queryNorm) return 100;
  if (nameNorm.includes(queryNorm) || queryNorm.includes(nameNorm)) return 80;
  const qTokens = queryNorm.split(' ').filter((t) => t.length > 2);
  const nTokens = new Set(nameNorm.split(' ').filter((t) => t.length > 2));
  let overlap = 0;
  for (const t of qTokens) {
    if (nTokens.has(t)) overlap += 1;
  }
  return overlap > 0 ? 40 + overlap * 5 : 0;
}

/**
 * Pick the best registry search row for a free-text company name.
 * When several rows tie with a strong score, `resolveHighScoreTie` disambiguates (state-specific).
 */
export function pickBestEntityHit<T extends EntityHitLike>(
  hits: T[],
  query: string,
  resolveHighScoreTie?: (tied: T[], queryNorm: string) => T,
): PickEntityHitResult<T> {
  if (hits.length === 0) {
    return { hit: null, ambiguous: false, candidates: [] };
  }

  const queryNorm = normalizeBusinessName(query);
  const scored = hits.map((h) => ({ h, s: scoreEntityNameMatch(queryNorm, h.entityName) }));
  scored.sort((a, b) => b.s - a.s);

  const topScore = scored[0]?.s ?? 0;
  if (topScore === 0) {
    return { hit: null, ambiguous: false, candidates: hits };
  }

  const tied = scored.filter((x) => x.s === topScore).map((x) => x.h);
  if (tied.length > 1 && topScore >= 60 && resolveHighScoreTie) {
    return { hit: resolveHighScoreTie(tied, queryNorm), ambiguous: false };
  }

  return { hit: scored[0].h, ambiguous: false };
}
