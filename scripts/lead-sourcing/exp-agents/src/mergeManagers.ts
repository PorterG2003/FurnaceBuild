import { join } from 'node:path';
import { saveJson } from './checkpoint.ts';
import { writeCsv } from './csv.ts';
import {
  buildMasterIndexes,
  classifyMatchedProfile,
  dedupeRosterAgents,
  matchRosterToMaster,
  toCandidateRow,
  type MasterAgent,
  type MatchedRosterProfile,
} from './rosterMatch.ts';
import type {
  CapturedRoster,
  ManagerCandidateRow,
  ManagerCoverageByJurisdiction,
  ManagerRunSummary,
  RosterHostManifest,
} from './rosterTypes.ts';
import {
  HIGH_CONFIDENCE_PRECISION_GATE,
  JURISDICTION_COVERAGE_GATE,
  MANAGER_CANDIDATE_COLUMNS,
} from './rosterTypes.ts';

export type MergeResult = {
  profiles: MatchedRosterProfile[];
  highConfidence: ManagerCandidateRow[];
  review: ManagerCandidateRow[];
  unmatched: ManagerCandidateRow[];
  coverageByJurisdiction: Record<string, ManagerCoverageByJurisdiction>;
};

function masterForJurisdiction(
  master: MasterAgent[],
  jurisdiction: string,
): MasterAgent[] {
  const wanted = jurisdiction.toUpperCase();
  return master.filter((row) => row.state.toUpperCase() === wanted);
}

export function mergeAndClassify(options: {
  master: MasterAgent[];
  captures: CapturedRoster[];
  jurisdictions: string[];
  manifest: RosterHostManifest;
}): MergeResult {
  const indexes = buildMasterIndexes(options.master);
  const hostJurisdiction = new Map(
    options.manifest.hosts.map((host) => [
      host.host.replace(/\/$/, ''),
      host.jurisdictions.map((j) => j.toUpperCase()),
    ]),
  );

  const flat = dedupeRosterAgents(
    options.captures.flatMap((capture) =>
      capture.agents.map((agent) => ({
        agent,
        sourceHost: capture.host.replace(/\/$/, ''),
      })),
    ),
  );

  const profiles: MatchedRosterProfile[] = [];
  for (const item of flat) {
    const preferredStates = hostJurisdiction.get(item.sourceHost) ?? [];
    let matched = matchRosterToMaster(item.agent, indexes, preferredStates[0]);
    if (!matched.master && preferredStates.length > 1) {
      for (const state of preferredStates.slice(1)) {
        matched = matchRosterToMaster(item.agent, indexes, state);
        if (matched.master) break;
      }
    }
    profiles.push(
      classifyMatchedProfile(
        item.agent,
        item.sourceHost,
        matched.master,
        matched.matchMethod,
      ),
    );
  }

  const highConfidence: ManagerCandidateRow[] = [];
  const review: ManagerCandidateRow[] = [];
  const unmatched: ManagerCandidateRow[] = [];
  const seenHigh = new Set<string>();
  const seenReview = new Set<string>();

  for (const profile of profiles) {
    const row = toCandidateRow(profile);
    if (!profile.master) {
      if (profile.classification.confidence !== 'none') {
        unmatched.push(row);
      }
      continue;
    }
    if (profile.classification.confidence === 'high') {
      if (seenHigh.has(profile.master.id)) continue;
      seenHigh.add(profile.master.id);
      highConfidence.push(row);
      continue;
    }
    if (profile.classification.confidence === 'medium') {
      if (seenReview.has(profile.master.id) || seenHigh.has(profile.master.id)) {
        continue;
      }
      seenReview.add(profile.master.id);
      review.push(row);
    }
  }

  highConfidence.sort(
    (a, b) =>
      Number(b.manager_score) - Number(a.manager_score) ||
      a.last_name.localeCompare(b.last_name),
  );
  review.sort(
    (a, b) =>
      Number(b.manager_score) - Number(a.manager_score) ||
      a.last_name.localeCompare(b.last_name),
  );

  const coverageByJurisdiction: Record<string, ManagerCoverageByJurisdiction> = {};
  for (const jurisdiction of options.jurisdictions) {
    const masterRows = masterForJurisdiction(options.master, jurisdiction);
    const masterIds = new Set(masterRows.map((row) => row.id));
    const matchedMasterIds = new Set(
      profiles
        .filter((profile) => profile.master && masterIds.has(profile.master.id))
        .map((profile) => profile.master!.id),
    );
    const high = highConfidence.filter(
      (row) => row.state.toUpperCase() === jurisdiction.toUpperCase(),
    ).length;
    const medium = review.filter(
      (row) => row.state.toUpperCase() === jurisdiction.toUpperCase(),
    ).length;
    const hosts = options.manifest.hosts
      .filter(
        (host) =>
          host.status === 'healthy' &&
          host.jurisdictions.some((j) => j.toUpperCase() === jurisdiction.toUpperCase()),
      )
      .map((host) => host.host);
    coverageByJurisdiction[jurisdiction] = {
      masterRows: masterRows.length,
      matchedMasterIds: matchedMasterIds.size,
      coveragePct: Number(
        ((matchedMasterIds.size / Math.max(1, masterRows.length)) * 100).toFixed(1),
      ),
      high,
      medium,
      hosts,
    };
  }

  return {
    profiles,
    highConfidence,
    review,
    unmatched,
    coverageByJurisdiction,
  };
}

export function evaluateQualityGate(options: {
  coverageByJurisdiction: Record<string, ManagerCoverageByJurisdiction>;
  precisionPct: number | null;
  requiredPrecisionPct?: number;
  requiredCoveragePct?: number;
}): ManagerRunSummary['qualityGate'] {
  const requiredPrecisionPct =
    options.requiredPrecisionPct ?? HIGH_CONFIDENCE_PRECISION_GATE;
  const requiredCoveragePct =
    options.requiredCoveragePct ?? JURISDICTION_COVERAGE_GATE;
  const failingJurisdictions = Object.entries(options.coverageByJurisdiction)
    .filter(([, coverage]) => coverage.coveragePct < requiredCoveragePct)
    .map(([jurisdiction]) => jurisdiction);
  const coveragePassed = failingJurisdictions.length === 0;
  const precisionPassed =
    options.precisionPct == null ? null : options.precisionPct >= requiredPrecisionPct;
  const notes: string[] = [];
  if (!coveragePassed) {
    notes.push(
      `Coverage below ${requiredCoveragePct}% in: ${failingJurisdictions.join(', ')}`,
    );
  }
  if (precisionPassed === false) {
    notes.push(
      `High-confidence precision ${options.precisionPct}% below ${requiredPrecisionPct}% gate`,
    );
  }
  if (precisionPassed == null) {
    notes.push(
      'Precision not yet measured; complete stratified manual review before national scale',
    );
  }
  return {
    requiredPrecisionPct,
    requiredCoveragePct,
    precisionPct: options.precisionPct,
    coveragePassed,
    precisionPassed,
    passed: coveragePassed && precisionPassed === true,
    failingJurisdictions,
    notes,
  };
}

export function writeManagerOutputs(options: {
  runDir: string;
  phase: 'pilot' | 'national';
  jurisdictions: string[];
  hostsAttempted: number;
  hostsHealthy: number;
  merge: MergeResult;
  precisionPct: number | null;
}): ManagerRunSummary {
  const highPath = join(options.runDir, 'agent_managers_high_confidence.csv');
  const reviewPath = join(options.runDir, 'agent_managers_review.csv');
  const unmatchedPath = join(options.runDir, 'agent_manager_unmatched.csv');
  const coveragePath = join(options.runDir, 'manager_coverage_report.json');
  const summaryPath = join(options.runDir, 'manager_run_summary.json');

  writeCsv(highPath, MANAGER_CANDIDATE_COLUMNS, options.merge.highConfidence);
  writeCsv(reviewPath, MANAGER_CANDIDATE_COLUMNS, options.merge.review);
  writeCsv(unmatchedPath, MANAGER_CANDIDATE_COLUMNS, options.merge.unmatched);

  const uniqueRosterIds = new Set(
    options.merge.profiles.map((profile) => String(profile.agent.agentid)),
  );
  const matchedMasterIds = new Set(
    options.merge.profiles
      .filter((profile) => profile.master)
      .map((profile) => profile.master!.id),
  );

  const qualityGate = evaluateQualityGate({
    coverageByJurisdiction: options.merge.coverageByJurisdiction,
    precisionPct: options.precisionPct,
  });

  const summary: ManagerRunSummary = {
    generatedAt: new Date().toISOString(),
    phase: options.phase,
    jurisdictions: options.jurisdictions,
    hostsAttempted: options.hostsAttempted,
    hostsHealthy: options.hostsHealthy,
    rosterProfiles: options.merge.profiles.length,
    uniqueRosterIds: uniqueRosterIds.size,
    matchedMasterIds: matchedMasterIds.size,
    highConfidence: options.merge.highConfidence.length,
    mediumConfidence: options.merge.review.length,
    unmatchedRosterProfiles: options.merge.unmatched.length,
    coverageByJurisdiction: options.merge.coverageByJurisdiction,
    qualityGate,
    outputs: {
      highConfidence: highPath,
      review: reviewPath,
      unmatched: unmatchedPath,
      coverage: coveragePath,
      summary: summaryPath,
    },
  };

  saveJson(coveragePath, {
    generatedAt: summary.generatedAt,
    coverageByJurisdiction: options.merge.coverageByJurisdiction,
    qualityGate,
  });
  saveJson(summaryPath, summary);
  return summary;
}

export function buildReviewSample(
  merge: MergeResult,
  perBucket = 25,
): ManagerCandidateRow[] {
  const high = merge.highConfidence.slice(0, perBucket);
  const medium = merge.review.slice(0, perBucket);
  const bioGaps = merge.highConfidence
    .filter((row) => row.master_bio_confidence === 'none')
    .slice(0, perBucket);
  const unmatched = merge.unmatched.slice(0, Math.min(15, perBucket));
  const byKey = new Map<string, ManagerCandidateRow>();
  for (const row of [...high, ...medium, ...bioGaps, ...unmatched]) {
    const key = `${row.master_id}|${row.roster_agent_id}|${row.manager_confidence}`;
    byKey.set(key, row);
  }
  return [...byKey.values()];
}
