import type { ProspectRow } from '../lib/types.js';

export type CoverageReport = {
  banner: string;
  generated_at: string;
  composition: {
    self_provided_share: number;
    grant_only_share: number;
    own_domain_registration_share: number;
    third_party_registration_share: number;
    unknown_registration_share: number;
    live_online_share: number;
    entity_class: Record<string, number>;
    audience_relationship: Record<string, number>;
    profession_mix: Record<string, number>;
    fit_tiers: Record<string, number>;
  };
  funnel: {
    directory_rows: number;
    classified_rows: number;
    fit_rows: number;
    host_activities: number;
    grant_activities: number;
    unmatched: number;
    prospects: number;
    tier_1: number;
  };
  recency_note: string;
};

function share(count: number, total: number): number {
  if (total === 0) return 0;
  return Number((count / total).toFixed(3));
}

function countBy(rows: ProspectRow[], pick: (row: ProspectRow) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    const key = pick(row) || 'unknown';
    for (const part of key.split(';').map((p) => p.trim()).filter(Boolean)) {
      out[part] = (out[part] ?? 0) + 1;
    }
    if (!key) out.unknown = (out.unknown ?? 0) + 1;
  }
  return out;
}

export function buildCoverageReport(input: {
  directoryRows: number;
  classifiedRows: number;
  fitRows: number;
  hostActivities: number;
  grantActivities: number;
  unmatched: number;
  prospects: ProspectRow[];
}): CoverageReport {
  const prospects = input.prospects;
  const n = prospects.length;
  const selfProvided = prospects.filter((p) => p.self_provided).length;
  const grantOnly = prospects.filter((p) => !p.self_provided && p.fit_tier >= 3).length;
  const ownReg = prospects.filter((p) => p.registration_kind === 'own_domain').length;
  const thirdReg = prospects.filter((p) => p.registration_kind === 'third_party').length;
  const unknownReg = prospects.filter((p) => p.registration_kind === 'unknown').length;
  const liveOnline = prospects.filter((p) => p.has_live_online).length;
  const tier1 = prospects.filter((p) => p.fit_tier === 1).length;

  const fit_tiers: Record<string, number> = {};
  for (const p of prospects) {
    const key = String(p.fit_tier);
    fit_tiers[key] = (fit_tiers[key] ?? 0) + 1;
  }

  return {
    banner:
      'This is a fit-ranked sample of companies that may own a licensed CE audience (customers or partners). It is not a census of CME funders. Completeness is not the success metric; wrong-population confidence is the failure mode.',
    generated_at: new Date().toISOString(),
    composition: {
      self_provided_share: share(selfProvided, n),
      grant_only_share: share(grantOnly, n),
      own_domain_registration_share: share(ownReg, n),
      third_party_registration_share: share(thirdReg, n),
      unknown_registration_share: share(unknownReg, n),
      live_online_share: share(liveOnline, n),
      entity_class: countBy(prospects, (p) => p.entity_class),
      audience_relationship: countBy(prospects, (p) => p.audience_relationship),
      profession_mix: countBy(prospects, (p) => p.audience_profession),
      fit_tiers,
    },
    funnel: {
      directory_rows: input.directoryRows,
      classified_rows: input.classifiedRows,
      fit_rows: input.fitRows,
      host_activities: input.hostActivities,
      grant_activities: input.grantActivities,
      unmatched: input.unmatched,
      prospects: n,
      tier_1: tier1,
    },
    recency_note: 'Directory membership is current as of fetch time; activity dates are not a census.',
  };
}
