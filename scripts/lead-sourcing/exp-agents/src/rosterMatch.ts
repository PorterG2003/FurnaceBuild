import { classifyManagerSignals, type ManagerSignalResult } from './managerSignals.ts';
import type {
  ManagerCandidateRow,
  MatchMethod,
  RosterAgent,
} from './rosterTypes.ts';

export type MasterAgent = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  city: string;
  state: string;
  country: string;
  bio: string;
};

export type MatchedRosterProfile = {
  agent: RosterAgent;
  sourceHost: string;
  profileUrl: string;
  master: MasterAgent | null;
  matchMethod: MatchMethod;
  classification: ManagerSignalResult;
  bioClassification: ManagerSignalResult;
};

export function normalizeName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizePhone(value: string): string {
  const digits = value.replace(/\D+/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return digits;
}

export function profileUrlFor(host: string, agent: RosterAgent): string {
  const name = `${agent.fname ?? ''} ${agent.lname ?? ''}`.trim().replace(/\s+/g, '+');
  return `${host.replace(/\/$/, '')}/agents/${agent.agentid}/${encodeURIComponent(name).replace(/%2B/g, '+')}`;
}

export function rosterPhones(agent: RosterAgent): string[] {
  return [agent.cellphone, agent.direct_phone, agent.work_phone, agent.officephone]
    .filter((value): value is string => Boolean(value && value.trim()))
    .map(normalizePhone)
    .filter((value) => value.length >= 10);
}

export function buildMasterIndexes(master: MasterAgent[]): {
  byEmail: Map<string, MasterAgent>;
  byNameState: Map<string, MasterAgent[]>;
  byPhone: Map<string, MasterAgent[]>;
} {
  const byEmail = new Map<string, MasterAgent>();
  const byNameState = new Map<string, MasterAgent[]>();
  const byPhone = new Map<string, MasterAgent[]>();

  for (const row of master) {
    if (row.email) {
      const email = normalizeEmail(row.email);
      if (!byEmail.has(email)) byEmail.set(email, row);
    }
    const name = normalizeName(`${row.first_name} ${row.last_name}`);
    if (name) {
      const key = `${name}|${row.state.toUpperCase()}`;
      const bucket = byNameState.get(key) ?? [];
      bucket.push(row);
      byNameState.set(key, bucket);
    }
    const phone = normalizePhone(row.phone ?? '');
    if (phone.length >= 10) {
      const bucket = byPhone.get(phone) ?? [];
      bucket.push(row);
      byPhone.set(phone, bucket);
    }
  }

  return { byEmail, byNameState, byPhone };
}

export function matchRosterToMaster(
  agent: RosterAgent,
  indexes: ReturnType<typeof buildMasterIndexes>,
  preferredState?: string,
): { master: MasterAgent | null; matchMethod: MatchMethod } {
  if (agent.email) {
    const byEmail = indexes.byEmail.get(normalizeEmail(agent.email));
    if (byEmail) return { master: byEmail, matchMethod: 'email' };
  }

  const rosterName = normalizeName(`${agent.fname ?? ''} ${agent.lname ?? ''}`);
  if (rosterName && preferredState) {
    const key = `${rosterName}|${preferredState.toUpperCase()}`;
    const matches = indexes.byNameState.get(key) ?? [];
    if (matches.length === 1) {
      return { master: matches[0], matchMethod: 'name_state' };
    }
  }

  if (rosterName) {
    // Ambiguous without a preferred state: only accept if exactly one master
    // row shares this full name across all jurisdictions.
    const allNameMatches = [...indexes.byNameState.entries()]
      .filter(([key]) => key.startsWith(`${rosterName}|`))
      .flatMap(([, rows]) => rows);
    if (allNameMatches.length === 1) {
      return { master: allNameMatches[0], matchMethod: 'name_state' };
    }
  }

  for (const phone of rosterPhones(agent)) {
    const matches = indexes.byPhone.get(phone) ?? [];
    if (matches.length === 1) {
      return { master: matches[0], matchMethod: 'phone' };
    }
  }

  return { master: null, matchMethod: '' };
}

export function normalizeRosterAgent(raw: Record<string, unknown>): RosterAgent | null {
  const agentid = Number(raw.agentid ?? raw.user_id ?? 0);
  if (!Number.isFinite(agentid) || agentid <= 0) return null;
  const positionTypes = Array.isArray(raw.position_types)
    ? raw.position_types.map(String)
    : [];
  const designations = Array.isArray(raw.designations)
    ? raw.designations.map(String)
    : [];
  return {
    agentid,
    fname: String(raw.fname ?? ''),
    lname: String(raw.lname ?? ''),
    email: String(raw.email ?? raw.companyemail ?? raw.contact_email ?? ''),
    title: String(raw.title ?? ''),
    cellphone: raw.cellphone == null ? null : String(raw.cellphone),
    officephone: raw.officephone == null ? null : String(raw.officephone),
    direct_phone: raw.direct_phone == null ? null : String(raw.direct_phone),
    work_phone: raw.work_phone == null ? null : String(raw.work_phone),
    position_types: positionTypes,
    designations,
    description: String(raw.description ?? ''),
    photo: raw.photo == null ? null : String(raw.photo),
    website_url: raw.website_url == null ? null : String(raw.website_url),
  };
}

export function dedupeRosterAgents(
  items: Array<{ agent: RosterAgent; sourceHost: string }>,
): Array<{ agent: RosterAgent; sourceHost: string }> {
  const byId = new Map<string, { agent: RosterAgent; sourceHost: string }>();
  for (const item of items) {
    const key = String(item.agent.agentid);
    const prior = byId.get(key);
    if (!prior) {
      byId.set(key, item);
      continue;
    }
    // Prefer the record with richer structured fields.
    const priorScore =
      (prior.agent.title ? 1 : 0) +
      prior.agent.position_types.length +
      (prior.agent.description ? 1 : 0);
    const nextScore =
      (item.agent.title ? 1 : 0) +
      item.agent.position_types.length +
      (item.agent.description ? 1 : 0);
    if (nextScore > priorScore) byId.set(key, item);
  }
  return [...byId.values()];
}

export function classifyMatchedProfile(
  agent: RosterAgent,
  sourceHost: string,
  master: MasterAgent | null,
  matchMethod: MatchMethod,
): MatchedRosterProfile {
  const classification = classifyManagerSignals({
    title: agent.title,
    positionTypes: agent.position_types,
    description: agent.description,
  });
  const bioClassification = classifyManagerSignals({
    description: master?.bio ?? '',
  });
  return {
    agent,
    sourceHost,
    profileUrl: profileUrlFor(sourceHost, agent),
    master,
    matchMethod,
    classification,
    bioClassification,
  };
}

export function toCandidateRow(profile: MatchedRosterProfile): ManagerCandidateRow {
  const master = profile.master;
  const agent = profile.agent;
  return {
    master_id: master?.id ?? '',
    first_name: master?.first_name || agent.fname,
    last_name: master?.last_name || agent.lname,
    email: master?.email || agent.email,
    phone: master?.phone || rosterPhones(agent)[0] || '',
    city: master?.city ?? '',
    state: master?.state ?? '',
    country: master?.country ?? '',
    roster_agent_id: String(agent.agentid),
    roster_title: agent.title ?? '',
    roster_position_types: (agent.position_types ?? []).join(' | '),
    manager_confidence: profile.classification.confidence,
    manager_score: String(profile.classification.score),
    manager_categories: profile.classification.categories.join(' | '),
    manager_evidence: profile.classification.evidence.join(' | '),
    master_bio_confidence: profile.bioClassification.confidence,
    match_method: profile.matchMethod,
    source_host: profile.sourceHost,
    profile_url: profile.profileUrl,
  };
}

export function isGenericBrokerOnly(result: ManagerSignalResult): boolean {
  return result.confidence === 'none';
}
