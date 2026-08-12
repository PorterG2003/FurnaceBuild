import { readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { saveJson } from './checkpoint.ts';
import { readCsv, writeCsv } from './csv.ts';
import {
  classifyManagerSignals,
  type ManagerConfidence,
  type ManagerSignalResult,
} from './managerSignals.ts';

type RosterAgent = {
  agentid: number;
  fname: string;
  lname: string;
  email: string;
  title: string;
  position_types: string[];
  description: string;
};

type ProbeCandidateRow = Record<string, string> & {
  master_id: string;
  first_name: string;
  last_name: string;
  email: string;
  city: string;
  state: string;
  roster_agent_id: string;
  roster_title: string;
  roster_position_types: string;
  manager_confidence: string;
  manager_score: string;
  manager_categories: string;
  manager_evidence: string;
  master_bio_confidence: string;
  match_method: string;
  profile_url: string;
};

const CANDIDATE_COLUMNS: (keyof ProbeCandidateRow & string)[] = [
  'master_id',
  'first_name',
  'last_name',
  'email',
  'city',
  'state',
  'roster_agent_id',
  'roster_title',
  'roster_position_types',
  'manager_confidence',
  'manager_score',
  'manager_categories',
  'manager_evidence',
  'master_bio_confidence',
  'match_method',
  'profile_url',
];

const KNOWN_PILOT_NAMES = [
  'Steve Rettig',
  'Kati Spaniak',
  'Randi Lynn Quigley',
  'Ron Rank',
  'Evan Reynolds',
  'Pamela Raver',
] as const;

function normalize(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function loadRosterCapture(path: string): RosterAgent[] {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as
    | RosterAgent[]
    | { result?: { value?: RosterAgent[] } };
  const rows = Array.isArray(parsed) ? parsed : parsed.result?.value;
  if (!Array.isArray(rows)) {
    throw new Error(`capture does not contain a roster array: ${path}`);
  }
  return rows;
}

function confidenceCounts(
  results: ManagerSignalResult[],
): Record<ManagerConfidence, number> {
  const counts: Record<ManagerConfidence, number> = { high: 0, medium: 0, none: 0 };
  for (const result of results) counts[result.confidence] += 1;
  return counts;
}

function profileUrl(host: string, agent: RosterAgent): string {
  const name = `${agent.fname} ${agent.lname}`.trim().replace(/\s+/g, '+');
  return `${host}/agents/${agent.agentid}/${encodeURIComponent(name).replace(/%2B/g, '+')}`;
}

function main(): void {
  const captureInput = process.argv[2];
  if (!captureInput) {
    throw new Error(
      'usage: tsx src/analyzeManagerProbe.ts <cdp-capture.json> [run-dir] [state] [host]',
    );
  }

  const packageRoot = join(import.meta.dirname, '..');
  const runDirInput = process.argv[3] ?? 'output/runs/us-ca-enumeration';
  const state = (process.argv[4] ?? 'IL').toUpperCase();
  const host = (process.argv[5] ?? 'https://il.exprealty.com').replace(/\/$/, '');
  const runDir = isAbsolute(runDirInput) ? runDirInput : resolve(packageRoot, runDirInput);
  const capturePath = isAbsolute(captureInput)
    ? captureInput
    : resolve(packageRoot, captureInput);
  const roster = loadRosterCapture(capturePath);
  const master = readCsv(join(runDir, 'agents.csv'));
  const masterState = master.filter(
    (row) => row.country === 'US' && row.state.toUpperCase() === state,
  );

  const byEmail = new Map<string, Record<string, string>>();
  const byName = new Map<string, Record<string, string>>();
  for (const row of masterState) {
    if (row.email) byEmail.set(normalizeEmail(row.email), row);
    const key = normalize(`${row.first_name} ${row.last_name}`);
    if (key && !byName.has(key)) byName.set(key, row);
  }

  let emailMatches = 0;
  let nameMatches = 0;
  const candidates: ProbeCandidateRow[] = [];
  const allResults: ManagerSignalResult[] = [];
  const knownSamples: Array<{
    name: string;
    title: string;
    positionTypes: string[];
    confidence: ManagerConfidence;
    categories: string[];
  }> = [];

  for (const agent of roster) {
    const emailMatch = agent.email ? byEmail.get(normalizeEmail(agent.email)) : undefined;
    const rosterName = `${agent.fname} ${agent.lname}`.trim();
    const nameMatch = rosterName ? byName.get(normalize(rosterName)) : undefined;
    const masterRow = emailMatch ?? nameMatch;
    const matchMethod = emailMatch ? 'email' : nameMatch ? 'name' : '';
    if (emailMatch) emailMatches += 1;
    else if (nameMatch) nameMatches += 1;

    const result = classifyManagerSignals({
      title: agent.title,
      positionTypes: agent.position_types,
      description: agent.description,
    });
    allResults.push(result);

    if (
      KNOWN_PILOT_NAMES.some((name) => normalize(name) === normalize(rosterName))
    ) {
      knownSamples.push({
        name: rosterName,
        title: agent.title,
        positionTypes: agent.position_types,
        confidence: result.confidence,
        categories: result.categories,
      });
    }

    if (result.confidence === 'none') continue;
    const bioResult = classifyManagerSignals({ description: masterRow?.bio ?? '' });
    candidates.push({
      master_id: masterRow?.id ?? '',
      first_name: masterRow?.first_name ?? agent.fname,
      last_name: masterRow?.last_name ?? agent.lname,
      email: masterRow?.email ?? agent.email,
      city: masterRow?.city ?? '',
      state: masterRow?.state ?? state,
      roster_agent_id: String(agent.agentid),
      roster_title: agent.title,
      roster_position_types: agent.position_types.join(' | '),
      manager_confidence: result.confidence,
      manager_score: String(result.score),
      manager_categories: result.categories.join(' | '),
      manager_evidence: result.evidence.join(' | '),
      master_bio_confidence: bioResult.confidence,
      match_method: matchMethod,
      profile_url: profileUrl(host, agent),
    });
  }

  candidates.sort(
    (a, b) =>
      Number(b.manager_score) - Number(a.manager_score) ||
      a.last_name.localeCompare(b.last_name) ||
      a.first_name.localeCompare(b.first_name),
  );

  const matchedCandidates = candidates.filter((row) => row.match_method);
  const newVsMasterBio = matchedCandidates.filter(
    (row) => row.master_bio_confidence === 'none',
  );
  const report = {
    generatedAt: new Date().toISOString(),
    source: {
      state,
      host,
      capturePath,
      endpoint: `${host}/ajax/agent-roster.php`,
    },
    coverage: {
      masterRows: master.length,
      masterStateRows: masterState.length,
      rosterRows: roster.length,
      matchedToMaster: emailMatches + nameMatches,
      emailMatches,
      nameMatches,
      matchRatePct: Number(
        (((emailMatches + nameMatches) / Math.max(1, roster.length)) * 100).toFixed(1),
      ),
      rosterSizeVsMasterStatePct: Number(
        ((roster.length / Math.max(1, masterState.length)) * 100).toFixed(1),
      ),
      masterStateCoveragePct: Number(
        (
          ((emailMatches + nameMatches) / Math.max(1, masterState.length)) *
          100
        ).toFixed(1),
      ),
      withTitle: roster.filter((agent) => agent.title.trim()).length,
      withPositionTypes: roster.filter((agent) => agent.position_types.length > 0).length,
      withDescription: roster.filter((agent) => agent.description.trim()).length,
    },
    classification: {
      ...confidenceCounts(allResults),
      candidates: candidates.length,
      matchedCandidates: matchedCandidates.length,
      candidatesMissingFromMainBioSignals: newVsMasterBio.length,
    },
    knownSamples,
    conclusions: [
      'The localized eXp roster exposes first-party title, position_types, description, profile URL, and contact fields without reCAPTCHA.',
      'Title and description carry useful manager signals; position_types alone are incomplete and sometimes represent license class rather than agent supervision.',
      'The localized roster is not a complete state roster, so scaling requires discovering all regional roster hosts and deduplicating them against the master agent id list.',
    ],
  };

  saveJson(join(runDir, `manager_probe_${state.toLowerCase()}_roster.json`), roster);
  saveJson(join(runDir, `manager_probe_${state.toLowerCase()}_report.json`), report);
  writeCsv(
    join(runDir, `manager_probe_${state.toLowerCase()}_candidates.csv`),
    CANDIDATE_COLUMNS,
    candidates,
  );
  console.log(
    `[manager-probe] state=${state} roster=${roster.length} matched=${emailMatches + nameMatches} high=${report.classification.high} medium=${report.classification.medium} newVsBio=${newVsMasterBio.length}`,
  );
}

main();
