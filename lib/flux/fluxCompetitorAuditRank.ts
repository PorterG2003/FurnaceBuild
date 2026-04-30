/** Domains that completed Transparency with `creativeCount > 0`. */
export interface FluxCompetitorScoredDomain {
  domain: string;
  /** Original Places text-search order (lower = earlier). Final tie-break. */
  placeIndex: number;
  creativeCount: number;
  /** Latest “Last shown” seen among scanned creatives (ISO yyyy-mm-dd). */
  latestAdLastShownAt: string | null;
  /** Distance from prospect service-area center to this competitor’s Places pin (meters). */
  distanceMeters: number;
  /** Max calendar-days (First shown → Last shown) among creatives with both dates; null if unknown. */
  longestAdRunDays: number | null;
}

/** Great-circle distance in meters (WGS84). */
export function haversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6_371_000;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function lastShownSortKey(iso: string | null): number {
  if (!iso) return Number.NEGATIVE_INFINITY;
  const t = Date.parse(`${iso}T12:00:00Z`);
  return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
}

/** Whole calendar days from first shown to last shown (inclusive span). */
export function calendarRunDaysBetween(firstIso: string, lastIso: string): number | null {
  const a = Date.parse(`${firstIso}T12:00:00Z`);
  const b = Date.parse(`${lastIso}T12:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return Math.floor((b - a) / 86_400_000);
}

function longestRunSortKey(days: number | null): number {
  return days == null ? Number.NEGATIVE_INFINITY : days;
}

/**
 * Rank competitors for the audit hero section:
 * 1. Most recent activity (max Last shown)
 * 2. Closer to service area
 * 3. Higher Transparency creative count
 * 4. Longest-running individual ad (First shown → Last shown)
 * 5. Places order tie-break
 */
export function rankFluxCompetitorDomains(rows: FluxCompetitorScoredDomain[]): FluxCompetitorScoredDomain[] {
  return [...rows].sort((a, b) => {
    const la = lastShownSortKey(a.latestAdLastShownAt);
    const lb = lastShownSortKey(b.latestAdLastShownAt);
    if (lb !== la) return lb - la;

    if (a.distanceMeters !== b.distanceMeters) {
      return a.distanceMeters - b.distanceMeters;
    }

    if (b.creativeCount !== a.creativeCount) return b.creativeCount - a.creativeCount;

    const ra = longestRunSortKey(a.longestAdRunDays);
    const rb = longestRunSortKey(b.longestAdRunDays);
    if (rb !== ra) return rb - ra;

    return a.placeIndex - b.placeIndex;
  });
}

const fluxCompetitorAuditRank = {
  rankFluxCompetitorDomains,
  haversineDistanceMeters,
  calendarRunDaysBetween,
};

export default fluxCompetitorAuditRank;
