/** Domains that completed Transparency with `creativeCount > 0` (plan §3c). */
export interface FluxCompetitorScoredDomain {
  domain: string;
  /** Original Places text-search order (lower = earlier). */
  placeIndex: number;
  creativeCount: number;
  latestAdLastShownAt: string | null;
}

export function rankFluxCompetitorDomains(rows: FluxCompetitorScoredDomain[]): FluxCompetitorScoredDomain[] {
  return [...rows].sort((a, b) => {
    if (b.creativeCount !== a.creativeCount) return b.creativeCount - a.creativeCount;
    const ta = a.latestAdLastShownAt ? Date.parse(a.latestAdLastShownAt) : NaN;
    const tb = b.latestAdLastShownAt ? Date.parse(b.latestAdLastShownAt) : NaN;
    const validA = Number.isFinite(ta);
    const validB = Number.isFinite(tb);
    if (validA && validB && tb !== ta) return tb - ta;
    if (validA && !validB) return -1;
    if (!validA && validB) return 1;
    return a.placeIndex - b.placeIndex;
  });
}
