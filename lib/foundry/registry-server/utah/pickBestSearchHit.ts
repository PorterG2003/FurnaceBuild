import { normalizeBusinessName } from './normalizeName.js';
import type { UtahSearchHit } from './types.js';

export type PickHitResult =
  | { hit: UtahSearchHit; ambiguous: false }
  | { hit: null; ambiguous: true; candidates: UtahSearchHit[] }
  | { hit: null; ambiguous: false; candidates: UtahSearchHit[] };

function scoreHit(queryNorm: string, hit: UtahSearchHit): number {
  const nameNorm = normalizeBusinessName(hit.entityName);
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
 * Pick best search hit for a company name query. Prefer LLC row over DBA when scores tie.
 */
export function pickBestSearchHit(hits: UtahSearchHit[], query: string): PickHitResult {
  if (hits.length === 0) {
    return { hit: null, ambiguous: false, candidates: [] };
  }

  const queryNorm = normalizeBusinessName(query);
  const scored = hits.map((h) => ({ h, s: scoreHit(queryNorm, h) }));
  scored.sort((a, b) => b.s - a.s);

  const topScore = scored[0]?.s ?? 0;
  if (topScore === 0) {
    return { hit: null, ambiguous: false, candidates: hits };
  }

  const tied = scored.filter((x) => x.s === topScore);
  if (tied.length > 1 && topScore >= 60) {
    const llcPreferred = tied.filter(
      (x) =>
        /\bLLC\b/i.test(x.h.entityName) ||
        /Limited Liability Company/i.test(x.h.entityType) ||
        /Domestic Limited Liability/i.test(x.h.entityType),
    );
    const pool = llcPreferred.length > 0 ? llcPreferred : tied;
    const active = pool.filter((x) => /active/i.test(x.h.status));
    const pickFrom = active.length > 0 ? active : pool;
    pickFrom.sort((a, b) => {
      const qa = queryNorm.length ? a.h.entityName.length - b.h.entityName.length : 0;
      if (qa !== 0) return -qa;
      return a.h.entityName.localeCompare(b.h.entityName);
    });
    return { hit: pickFrom[0].h, ambiguous: false };
  }

  return { hit: scored[0].h, ambiguous: false };
}
