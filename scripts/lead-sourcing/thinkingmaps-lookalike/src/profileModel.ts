import { assignBins, districtWeight, featureLabel, geoCounts, loadFeaturesConfig } from './features.js';
import type { BinLift, CcdDistrict, DistrictMatch, FeatureBins, FeatureProfile, FeaturesConfig, WonDistrict } from './types.js';

const FEATURE_KEYS: Array<keyof FeatureBins> = [
  'enrollment',
  'grade_span',
  'ell_share',
  'spec_ed_share',
  'locale',
  'agency',
  'str',
  'poverty_share',
  'geo_same_county',
  'geo_nearby',
];

export function logLift(wonWeight: number, universe: number, baseRate: number, minWins: number): { raw: number; shrunk: number } {
  if (universe <= 0 || baseRate <= 0) return { raw: 0, shrunk: 0 };
  const rate = Math.max(wonWeight / universe, 1e-12);
  const raw = Math.log(rate / baseRate);
  const shrink = Math.min(1, wonWeight / minWins);
  if (shrink === 0) return { raw, shrunk: 0 };
  return { raw, shrunk: raw * shrink };
}

export function scoredMatches(matches: DistrictMatch[]): DistrictMatch[] {
  return matches.filter((m) => m.leaid && (m.confidence === 'high' || m.confidence === 'medium'));
}

export function buildProfile(options: {
  universe: CcdDistrict[];
  won: WonDistrict[];
  matches: DistrictMatch[];
  config?: FeaturesConfig;
  trainingLeaids?: Set<string>;
}): FeatureProfile {
  const config = options.config ?? loadFeaturesConfig();
  const usableUniverse = options.universe.filter((d) => d.enrollment != null && d.enrollment > 0);
  const byLeaid = new Map(usableUniverse.map((d) => [d.leaid, d]));
  const matched = scoredMatches(options.matches).filter((m) => !options.trainingLeaids || options.trainingLeaids.has(m.leaid));
  const wonByKey = new Map(options.won.map((w) => [w.district_key, w]));
  const wonCcd: CcdDistrict[] = [];
  const wonWithWeight: Array<{ district: CcdDistrict; weight: number; bins: FeatureBins }> = [];

  const totalRevenue = matched.reduce((sum, m) => sum + (wonByKey.get(m.district_key)?.revenue ?? m.revenue), 0);
  const wonCount = matched.length;

  for (const match of matched) {
    const ccd = byLeaid.get(match.leaid);
    if (!ccd) continue;
    const won = wonByKey.get(match.district_key);
    const weight = won
      ? districtWeight(won, config, totalRevenue, wonCount)
      : config.logo_weight;
    wonCcd.push(ccd);
    wonWithWeight.push({
      district: ccd,
      weight,
      bins: assignBins(ccd, config, geoCounts(ccd, wonCcd, config.nearby_miles)),
    });
  }

  // Recompute bins now that the full training won set is known (geo features).
  for (const row of wonWithWeight) {
    row.bins = assignBins(row.district, config, geoCounts(row.district, wonCcd, config.nearby_miles));
  }

  const universeBins = usableUniverse.map((d) => ({
    district: d,
    bins: assignBins(d, config, geoCounts(d, wonCcd, config.nearby_miles)),
  }));

  const wonWeightSum = wonWithWeight.reduce((sum, row) => sum + row.weight, 0);
  const baseRate = universeBins.length ? wonWeightSum / universeBins.length : 0;
  const lifts: FeatureProfile['lifts'] = {};

  for (const feature of FEATURE_KEYS) {
    const universeCounts = new Map<string, number>();
    const wonWeights = new Map<string, number>();
    for (const row of universeBins) {
      const bin = row.bins[feature];
      universeCounts.set(bin, (universeCounts.get(bin) ?? 0) + 1);
    }
    for (const row of wonWithWeight) {
      const bin = row.bins[feature];
      wonWeights.set(bin, (wonWeights.get(bin) ?? 0) + row.weight);
    }
    const bins: Record<string, BinLift> = {};
    for (const [bin, universe] of universeCounts) {
      const wonWeight = wonWeights.get(bin) ?? 0;
      const { raw, shrunk } = logLift(wonWeight, universe, baseRate, config.min_wins_for_full_lift);
      bins[bin] = {
        feature,
        bin,
        label: featureLabel(feature, bin, config),
        won_weight: wonWeight,
        universe,
        win_rate: universe ? wonWeight / universe : 0,
        lift: shrunk,
        raw_lift: raw,
      };
    }
    lifts[feature] = bins;
  }

  return {
    base_rate: baseRate,
    won_count: wonCcd.length,
    won_weight_sum: wonWeightSum,
    universe_count: universeBins.length,
    lifts,
  };
}

export function scoreDistrict(
  bins: FeatureBins,
  profile: FeatureProfile,
): { score: number; contributions: Array<{ feature: string; bin: string; label: string; lift: number; multiplier: number }> } {
  let score = 0;
  const contributions: Array<{ feature: string; bin: string; label: string; lift: number; multiplier: number }> = [];
  for (const feature of FEATURE_KEYS) {
    const bin = bins[feature];
    const lift = profile.lifts[feature]?.[bin];
    if (!lift) continue;
    score += lift.lift;
    contributions.push({
      feature,
      bin,
      label: lift.label,
      lift: lift.lift,
      multiplier: Math.exp(lift.lift),
    });
  }
  contributions.sort((a, b) => Math.abs(b.lift) - Math.abs(a.lift));
  return { score, contributions };
}

export function formatReasons(
  contributions: Array<{ label: string; multiplier: number; lift: number }>,
  limit = 4,
): string {
  return contributions
    .slice(0, limit)
    .filter((c) => Math.abs(c.lift) >= 0.05)
    .map((c) => `${c.label} (${c.multiplier.toFixed(1)}x)`)
    .join('; ');
}
