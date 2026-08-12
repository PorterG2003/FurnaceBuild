import { join } from 'node:path';
import {
  classifyBrokerAudience,
  preferTier,
  type AudienceTier,
  type BrokerAudienceResult,
} from './brokerSignals.ts';
import type {
  BrokerExpansionSummary,
  BrokerLeadRow,
  LicenseMatchResult,
} from './brokerExpansionTypes.ts';
import { BROKER_LEAD_COLUMNS } from './brokerExpansionTypes.ts';
import { saveJson } from './checkpoint.ts';
import { writeCsv } from './csv.ts';
import {
  buildMasterIndexes,
  matchRosterToMaster,
  normalizeName,
  profileUrlFor,
  rosterPhones,
  type MasterAgent,
} from './rosterMatch.ts';
import {
  guessJurisdictions,
  hostPrefix,
  normalizeHost,
} from './rosterHosts.ts';
import type { CapturedRoster, RosterHostManifest } from './rosterTypes.ts';

export type ExpansionEvidence = {
  master: MasterAgent | null;
  unmatchedKey: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  city: string;
  state: string;
  country: string;
  tier: AudienceTier;
  roleCategory: string;
  campaignSegment: string;
  score: number;
  categories: Set<string>;
  evidence: Set<string>;
  signalSources: Set<string>;
  sourceHosts: Set<string>;
  rosterAgentIds: Set<string>;
  rosterTitles: Set<string>;
  rosterPositionTypes: Set<string>;
  matchMethods: Set<string>;
  profileUrls: Set<string>;
  licenseNumbers: Set<string>;
  licenseTypes: Set<string>;
  licenseStates: Set<string>;
  licenseStatuses: Set<string>;
  designatedSupervisor: boolean;
  sponsoringBrokers: Set<string>;
};

function emptyEvidence(partial: Partial<ExpansionEvidence> & { unmatchedKey: string }): ExpansionEvidence {
  return {
    master: null,
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    city: '',
    state: '',
    country: '',
    tier: 'none',
    roleCategory: '',
    campaignSegment: 'none',
    score: 0,
    categories: new Set(),
    evidence: new Set(),
    signalSources: new Set(),
    sourceHosts: new Set(),
    rosterAgentIds: new Set(),
    rosterTitles: new Set(),
    rosterPositionTypes: new Set(),
    matchMethods: new Set(),
    profileUrls: new Set(),
    licenseNumbers: new Set(),
    licenseTypes: new Set(),
    licenseStates: new Set(),
    licenseStatuses: new Set(),
    designatedSupervisor: false,
    sponsoringBrokers: new Set(),
    ...partial,
  };
}

function applyAudience(target: ExpansionEvidence, audience: BrokerAudienceResult, source: string): void {
  if (audience.tier === 'none') return;
  const nextTier = preferTier(target.tier, audience.tier);
  if (nextTier !== target.tier || audience.score > target.score) {
    target.tier = nextTier;
    target.score = Math.max(target.score, audience.score);
    target.roleCategory = audience.roleCategory || target.roleCategory;
    target.campaignSegment = audience.campaignSegment;
  } else {
    target.score = Math.max(target.score, audience.score);
  }
  for (const category of audience.categories) target.categories.add(category);
  for (const item of audience.evidence) target.evidence.add(item);
  target.signalSources.add(source);
}

function hostPreferredStates(
  host: string,
  manifest: RosterHostManifest | null,
): string[] {
  const normalized = normalizeHost(host);
  const fromManifest = manifest?.hosts.find((row) => normalizeHost(row.host) === normalized);
  if (fromManifest?.jurisdictions?.length) {
    return fromManifest.jurisdictions.map((j) => j.toUpperCase());
  }
  return guessJurisdictions(hostPrefix(normalized));
}

export function mergeRosterCaptures(options: {
  master: MasterAgent[];
  captures: CapturedRoster[];
  manifest: RosterHostManifest | null;
}): {
  byMaster: Map<string, ExpansionEvidence>;
  unmatched: ExpansionEvidence[];
  uniqueRosterAgents: number;
  matchedMasterIds: number;
} {
  const indexes = buildMasterIndexes(options.master);
  const byMaster = new Map<string, ExpansionEvidence>();
  const unmatched: ExpansionEvidence[] = [];
  const seenRosterIds = new Set<string>();

  for (const capture of options.captures) {
    const host = normalizeHost(capture.host);
    const preferredStates = hostPreferredStates(host, options.manifest);
    for (const agent of capture.agents) {
      seenRosterIds.add(String(agent.agentid));
      let matched = matchRosterToMaster(agent, indexes, preferredStates[0]);
      if (!matched.master && preferredStates.length > 1) {
        for (const state of preferredStates.slice(1)) {
          matched = matchRosterToMaster(agent, indexes, state);
          if (matched.master) break;
        }
      }

      const audience = classifyBrokerAudience({
        title: agent.title,
        positionTypes: agent.position_types,
        description: agent.description,
      });
      if (audience.tier === 'none') continue;

      const target = matched.master
        ? byMaster.get(matched.master.id) ??
          emptyEvidence({
            unmatchedKey: matched.master.id,
            master: matched.master,
            firstName: matched.master.first_name,
            lastName: matched.master.last_name,
            email: matched.master.email,
            phone: matched.master.phone,
            city: matched.master.city,
            state: matched.master.state,
            country: matched.master.country,
          })
        : emptyEvidence({
            unmatchedKey: `roster:${agent.agentid}`,
            firstName: agent.fname,
            lastName: agent.lname,
            email: agent.email,
            phone: rosterPhones(agent)[0] ?? '',
          });

      applyAudience(target, audience, 'roster');
      target.sourceHosts.add(host);
      target.rosterAgentIds.add(String(agent.agentid));
      if (agent.title.trim()) target.rosterTitles.add(agent.title.trim());
      for (const position of agent.position_types) {
        if (position.trim()) target.rosterPositionTypes.add(position.trim());
      }
      if (matched.matchMethod) target.matchMethods.add(matched.matchMethod);
      target.profileUrls.add(profileUrlFor(host, agent));
      if (!target.phone) target.phone = rosterPhones(agent)[0] ?? '';

      if (matched.master) byMaster.set(matched.master.id, target);
      else unmatched.push(target);
    }
  }

  return {
    byMaster,
    unmatched,
    uniqueRosterAgents: seenRosterIds.size,
    matchedMasterIds: byMaster.size,
  };
}

export function mergeBioCandidates(
  byMaster: Map<string, ExpansionEvidence>,
  master: MasterAgent[],
): number {
  let added = 0;
  for (const row of master) {
    const audience = classifyBrokerAudience(
      { description: row.bio },
      { bioOnly: true },
    );
    if (audience.tier === 'none') continue;
    const existing = byMaster.get(row.id);
    if (existing) {
      // Bio only upgrades when no structured roster/license tier exists yet,
      // or adds corroborating evidence under the existing tier.
      if (existing.tier === 'none' || existing.tier === 'D') {
        applyAudience(existing, audience, 'bio');
      } else {
        for (const item of audience.evidence) existing.evidence.add(`bio:${item}`);
        existing.signalSources.add('bio');
      }
      continue;
    }
    const target = emptyEvidence({
      unmatchedKey: row.id,
      master: row,
      firstName: row.first_name,
      lastName: row.last_name,
      email: row.email,
      phone: row.phone,
      city: row.city,
      state: row.state,
      country: row.country,
    });
    applyAudience(target, audience, 'bio');
    byMaster.set(row.id, target);
    added += 1;
  }
  return added;
}

export function mergeLicenseMatches(
  byMaster: Map<string, ExpansionEvidence>,
  masterById: Map<string, MasterAgent>,
  matches: LicenseMatchResult[],
): number {
  let applied = 0;
  for (const match of matches) {
    if (match.ambiguous) continue;
    const master = masterById.get(match.masterId);
    if (!master) continue;
    const target =
      byMaster.get(match.masterId) ??
      emptyEvidence({
        unmatchedKey: match.masterId,
        master,
        firstName: master.first_name,
        lastName: master.last_name,
        email: master.email,
        phone: master.phone,
        city: master.city,
        state: master.state,
        country: master.country,
      });

    const license = match.license;
    const isManagerish =
      license.designatedSupervisor ||
      /\b(managing|designated|qualifying|broker of record|broker[- ]in[- ]charge|principal)\b/i.test(
        license.licenseType,
      );
    const isBroker = /\bbroker\b/i.test(license.licenseType) || isManagerish;
    if (!isBroker) continue;

    const audience = classifyBrokerAudience({
      title: isManagerish ? 'Designated Managing Broker' : 'Broker',
      positionTypes: [license.licenseType],
    });
    // Force tier: supervisor/managing -> A/B, ordinary broker -> C
    const forced: BrokerAudienceResult = isManagerish
      ? {
          ...audience,
          tier: license.designatedSupervisor || /designated|qualifying|broker of record|broker[- ]in[- ]charge/i.test(license.licenseType)
            ? 'A'
            : 'B',
          campaignSegment:
            license.designatedSupervisor || /designated|qualifying|broker of record|broker[- ]in[- ]charge/i.test(license.licenseType)
              ? 'manager'
              : 'possible_manager',
          roleCategory: license.designatedSupervisor
            ? 'designated_supervisor'
            : audience.roleCategory || 'license_manager',
          evidence: [
            `license:${license.source}:${license.licenseType || 'broker'}`,
            ...(license.designatedSupervisor ? ['license designated supervisor flag'] : []),
          ],
          categories: [
            license.designatedSupervisor ? 'designated_supervisor' : 'license_broker_manager',
          ],
          score: license.designatedSupervisor ? 90 : 65,
          manager: audience.manager,
          hasStructuredBroker: true,
        }
      : {
          ...audience,
          tier: 'C',
          campaignSegment: 'broker',
          roleCategory: 'license_broker',
          evidence: [`license:${license.source}:${license.licenseType || 'broker'}`],
          categories: ['license_broker'],
          score: 35,
          manager: audience.manager,
          hasStructuredBroker: true,
        };

    applyAudience(target, forced, `license:${license.source}`);
    target.licenseNumbers.add(license.licenseNumber);
    if (license.licenseType) target.licenseTypes.add(license.licenseType);
    if (license.state) target.licenseStates.add(license.state);
    if (license.status) target.licenseStatuses.add(license.status);
    if (license.designatedSupervisor) target.designatedSupervisor = true;
    if (license.sponsoringBroker) target.sponsoringBrokers.add(license.sponsoringBroker);
    target.matchMethods.add(match.matchMethod);
    byMaster.set(match.masterId, target);
    applied += 1;
  }
  return applied;
}

export function toBrokerLeadRow(evidence: ExpansionEvidence): BrokerLeadRow {
  return {
    master_id: evidence.master?.id ?? '',
    first_name: evidence.firstName,
    last_name: evidence.lastName,
    email: evidence.email,
    phone: evidence.phone,
    city: evidence.city,
    state: evidence.state,
    country: evidence.country,
    audience_tier: evidence.tier,
    role_category: evidence.roleCategory,
    campaign_segment: evidence.campaignSegment,
    score: String(evidence.score),
    categories: [...evidence.categories].join(' | '),
    evidence: [...evidence.evidence].join(' | '),
    signal_sources: [...evidence.signalSources].sort().join('|'),
    source_hosts: [...evidence.sourceHosts].sort().join('|'),
    roster_agent_ids: [...evidence.rosterAgentIds].sort().join('|'),
    roster_titles: [...evidence.rosterTitles].join(' | '),
    roster_position_types: [...evidence.rosterPositionTypes].join(' | '),
    match_methods: [...evidence.matchMethods].sort().join('|'),
    profile_urls: [...evidence.profileUrls].sort().join('|'),
    license_numbers: [...evidence.licenseNumbers].sort().join('|'),
    license_types: [...evidence.licenseTypes].sort().join('|'),
    license_states: [...evidence.licenseStates].sort().join('|'),
    license_status: [...evidence.licenseStatuses].sort().join('|'),
    designated_supervisor: evidence.designatedSupervisor ? 'true' : '',
    sponsoring_broker: [...evidence.sponsoringBrokers].sort().join('|'),
  };
}

export function buildBrokerLeadRows(
  byMaster: Map<string, ExpansionEvidence>,
): BrokerLeadRow[] {
  return [...byMaster.values()]
    .filter((row) => row.tier !== 'none')
    .map(toBrokerLeadRow)
    .sort(
      (a, b) =>
        Number(b.score) - Number(a.score) ||
        a.state.localeCompare(b.state) ||
        a.last_name.localeCompare(b.last_name),
    );
}

export function buildReviewSample(rows: BrokerLeadRow[], perBucket = 25): BrokerLeadRow[] {
  const buckets: AudienceTier[] = ['A', 'B', 'C', 'D'];
  const out = new Map<string, BrokerLeadRow>();
  for (const tier of buckets) {
    for (const row of rows.filter((item) => item.audience_tier === tier).slice(0, perBucket)) {
      out.set(row.master_id || `${row.email}|${row.audience_tier}`, row);
    }
  }
  return [...out.values()];
}

export function extractLicenseNumbersFromBio(bio: string): string[] {
  const matches = bio.matchAll(
    /\b(?:DRE|CA\s*DRE|License|#)\s*#?\s*([A-Z]{0,3}\d{5,10})\b|\b(\d{6,10})\b/gi,
  );
  const out = new Set<string>();
  for (const match of matches) {
    const value = (match[1] || match[2] || '').toUpperCase();
    if (value) out.add(value);
  }
  return [...out];
}

export function writeBrokerExpansionOutputs(options: {
  runDir: string;
  masterCsv: string;
  captureDir: string;
  rows: BrokerLeadRow[];
  unmatched: BrokerLeadRow[];
  uniqueRosterAgents: number;
  matchedMasterIds: number;
  bioCandidates: number;
  licenseMatches: number;
  rosterCaptures: number;
  discovery?: BrokerExpansionSummary['discovery'];
}): BrokerExpansionSummary {
  const allPath = join(options.runDir, 'exp_broker_manager_leads.csv');
  const reviewPath = join(options.runDir, 'exp_broker_manager_review.csv');
  const unmatchedPath = join(options.runDir, 'exp_broker_manager_unmatched.csv');
  const summaryPath = join(options.runDir, 'broker_expansion_summary.json');
  const sourcesPath = join(options.runDir, 'broker_expansion_sources.json');

  writeCsv(allPath, BROKER_LEAD_COLUMNS, options.rows);
  for (const tier of ['A', 'B', 'C', 'D'] as const) {
    writeCsv(
      join(options.runDir, `exp_broker_manager_tier_${tier.toLowerCase()}.csv`),
      BROKER_LEAD_COLUMNS,
      options.rows.filter((row) => row.audience_tier === tier),
    );
  }
  writeCsv(reviewPath, BROKER_LEAD_COLUMNS, buildReviewSample(options.rows));
  writeCsv(unmatchedPath, BROKER_LEAD_COLUMNS, options.unmatched);

  const tiers: Record<string, number> = { A: 0, B: 0, C: 0, D: 0 };
  const campaignSegments: Record<string, number> = {};
  const byState: Record<string, number> = {};
  for (const row of options.rows) {
    tiers[row.audience_tier] = (tiers[row.audience_tier] ?? 0) + 1;
    campaignSegments[row.campaign_segment] =
      (campaignSegments[row.campaign_segment] ?? 0) + 1;
    const state = row.state || 'UNKNOWN';
    byState[state] = (byState[state] ?? 0) + 1;
  }

  const summary: BrokerExpansionSummary = {
    generatedAt: new Date().toISOString(),
    runDir: options.runDir,
    masterCsv: options.masterCsv,
    captureDir: options.captureDir,
    uniqueRosterAgents: options.uniqueRosterAgents,
    matchedMasterIds: options.matchedMasterIds,
    unmatchedBrokerOrManager: options.unmatched.length,
    tiers,
    campaignSegments,
    byState,
    sources: {
      rosterCaptures: options.rosterCaptures,
      bioCandidates: options.bioCandidates,
      licenseMatches: options.licenseMatches,
    },
    discovery: options.discovery,
    outputs: {
      all: allPath,
      review: reviewPath,
      unmatched: unmatchedPath,
      summary: summaryPath,
      sources: sourcesPath,
      tierA: join(options.runDir, 'exp_broker_manager_tier_a.csv'),
      tierB: join(options.runDir, 'exp_broker_manager_tier_b.csv'),
      tierC: join(options.runDir, 'exp_broker_manager_tier_c.csv'),
      tierD: join(options.runDir, 'exp_broker_manager_tier_d.csv'),
    },
  };

  saveJson(summaryPath, summary);
  saveJson(sourcesPath, {
    generatedAt: summary.generatedAt,
    masterCsv: options.masterCsv,
    captureDir: options.captureDir,
    rosterCaptures: options.rosterCaptures,
    bioCandidates: options.bioCandidates,
    licenseMatches: options.licenseMatches,
  });
  return summary;
}

export function masterNameKey(row: MasterAgent): string {
  return `${normalizeName(`${row.first_name} ${row.last_name}`)}|${row.state.toUpperCase()}`;
}
