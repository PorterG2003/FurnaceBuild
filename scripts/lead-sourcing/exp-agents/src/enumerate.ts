import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { openCountryPage, sleepWithJitter } from './browser.ts';
import {
  loadEnumerationCheckpoint,
  saveEnumerationCheckpoint,
  saveJson,
} from './checkpoint.ts';
import { appendCsvRows, readCsv } from './csv.ts';
import { searchAgentsByLocation } from './graphql.ts';
import { toRow } from './searchNames.ts';
import {
  AGENT_CSV_COLUMNS,
  COUNTRY_LOCATIONS,
  ELASTIC_RESULT_WINDOW,
  ENUMERATION_PAGE_SIZE,
  type AgentRow,
  type CountryCode,
  type EnumerationCheckpoint,
  type EnumerationSliceState,
  type SearchAgent,
} from './types.ts';

export type EnumerationResult = {
  agentsWritten: number;
  pagesCompleted: number;
  slicesCompleted: number;
  gqlCalls: number;
  sliceCounts: Record<string, { reported: number; written: number }>;
};

export type UnhealthyHandler = (
  error: Error,
  context: { country: CountryCode; location: string; from: number },
) => Promise<never>;

export type HealthProbe = (page: Page) => Promise<void>;

function agentsCsvPath(runDir: string): string {
  return join(runDir, 'agents.csv');
}

function emptySliceState(): EnumerationSliceState {
  return {
    done: false,
    nextFrom: 0,
    reportedCount: null,
    rowsWritten: 0,
    pagesCompleted: 0,
    verifiedEmpty: false,
  };
}

function emptyCheckpoint(): EnumerationCheckpoint {
  return { done: false, countries: {} };
}

export function validateSlicePayload(options: {
  agents: SearchAgent[];
  count: number;
  country: CountryCode;
  location: string;
  from: number;
  size: number;
}): void {
  const { agents, count, country, location, from, size } = options;
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`invalid count=${count} for ${country}/${location}`);
  }
  if (count >= ELASTIC_RESULT_WINDOW) {
    throw new Error(
      `slice ${country}/${location} reached Elasticsearch window ${count}; subdivide before continuing`,
    );
  }
  if (from < count && agents.length === 0) {
    throw new Error(`suspicious empty page for ${country}/${location} from=${from} count=${count}`);
  }
  const expected = Math.min(size, Math.max(0, count - from));
  if (agents.length < expected) {
    throw new Error(
      `short page for ${country}/${location} from=${from}: expected=${expected} got=${agents.length}`,
    );
  }
  const wrongLocation = agents.filter(
    (agent) => agent.state.trim().toUpperCase() !== location.toUpperCase(),
  );
  // A few agents are licensed/associated across neighboring jurisdictions.
  // A poison payload is broad disagreement, not one legitimate cross-state row.
  const mismatchLimit = Math.floor(agents.length / 2) + 1;
  if (wrongLocation.length >= mismatchLimit) {
    const sample = wrongLocation
      .slice(0, 3)
      .map((agent) => `${agent.id}:${agent.state}`)
      .join(',');
    throw new Error(
      `location mismatch for ${country}/${location}: ${wrongLocation.length}/${agents.length} (${sample})`,
    );
  }
}

async function getVerifiedPage(options: {
  page: Page;
  country: CountryCode;
  location: string;
  from: number;
  size: number;
  healthProbe: HealthProbe;
  countCall: () => void;
}): Promise<{ count: number; agents: SearchAgent[]; verifiedEmpty: boolean }> {
  const { page, country, location, from, size, healthProbe, countCall } = options;
  countCall();
  const first = await searchAgentsByLocation(page, {
    country,
    location,
    from,
    size,
  });

  if (first.count !== 0 || first.agents.length !== 0) {
    return { ...first, verifiedEmpty: false };
  }

  // A captcha soft-ban can masquerade as a valid empty payload. Prove the
  // session healthy with a known-good slice, then confirm the empty once.
  await healthProbe(page);
  await sleepWithJitter(1_000);
  countCall();
  const confirmed = await searchAgentsByLocation(page, {
    country,
    location,
    from,
    size,
  });
  return {
    ...confirmed,
    verifiedEmpty: confirmed.count === 0 && confirmed.agents.length === 0,
  };
}

export async function runEnumeratePhase(options: {
  page: Page;
  runDir: string;
  countries: CountryCode[];
  maxAgents: number | null;
  rateMs: number;
  resume: boolean;
  onUnhealthy: UnhealthyHandler;
  healthProbe: HealthProbe;
  onHealthy: () => void;
}): Promise<EnumerationResult> {
  const {
    page,
    runDir,
    countries,
    maxAgents,
    rateMs,
    resume,
    onUnhealthy,
    healthProbe,
    onHealthy,
  } = options;
  const csvPath = agentsCsvPath(runDir);
  const existingRows = resume && existsSync(csvPath) ? readCsv(csvPath) : [];
  const seenIds = new Set(existingRows.map((row) => row.id).filter(Boolean));
  const checkpoint =
    resume && loadEnumerationCheckpoint(runDir)
      ? loadEnumerationCheckpoint(runDir)!
      : emptyCheckpoint();

  let agentsWritten = existingRows.length;
  let gqlCalls = 0;

  for (const country of countries) {
    const countryState = (checkpoint.countries[country] ??= {
      done: false,
      slices: {},
    });
    if (countryState.done) continue;

    await openCountryPage(page, country);
    for (const location of COUNTRY_LOCATIONS[country]) {
      const state = (countryState.slices[location] ??= emptySliceState());
      if (state.done) continue;
      if (maxAgents != null && agentsWritten >= maxAgents) break;

      console.log(
        `[enumerate] ${country}/${location} resumeFrom=${state.nextFrom} reported=${state.reportedCount ?? '?'}`,
      );

      // Non-zero offsets can time out even when an equivalent larger page is
      // accepted. On resume, replay a bounded slice as one page; id dedupe
      // prevents duplicate output rows.
      let replayPageSize =
        state.nextFrom === 0 &&
        state.pagesCompleted > 0 &&
        state.reportedCount != null &&
        state.reportedCount <= 1000
          ? state.reportedCount
          : null;
      if (state.nextFrom > 0 && state.reportedCount != null) {
        const replayFrom = state.reportedCount <= 1000 ? 0 : 1000;
        if (state.nextFrom > replayFrom) {
          replayPageSize = state.reportedCount - replayFrom;
          console.log(
            `[enumerate] ${country}/${location} rewinding ${state.nextFrom}->${replayFrom} for one replay page`,
          );
          state.nextFrom = replayFrom;
          saveEnumerationCheckpoint(runDir, checkpoint);
        }
      }

      while (!state.done) {
        if (maxAgents != null && agentsWritten >= maxAgents) break;

        const from = state.nextFrom;
        const pageSize =
          replayPageSize ??
          (from >= 1000 && state.reportedCount != null
            ? state.reportedCount - from
            : ENUMERATION_PAGE_SIZE);
        let payload: { count: number; agents: SearchAgent[]; verifiedEmpty: boolean };
        try {
          payload = await getVerifiedPage({
            page,
            country,
            location,
            from,
            size: pageSize,
            healthProbe,
            countCall: () => {
              gqlCalls += 1;
            },
          });
          if (payload.verifiedEmpty) {
            onHealthy();
            state.verifiedEmpty = true;
            state.reportedCount = 0;
            state.done = true;
            saveEnumerationCheckpoint(runDir, checkpoint);
            console.log(`[enumerate] ${country}/${location} verified empty`);
            break;
          }
          validateSlicePayload({
            ...payload,
            country,
            location,
            from,
            size: pageSize,
          });
          onHealthy();
        } catch (error) {
          saveEnumerationCheckpoint(runDir, checkpoint);
          const normalized = error instanceof Error ? error : new Error(String(error));
          await onUnhealthy(normalized, { country, location, from });
          throw normalized;
        }

        state.reportedCount = payload.count;
        const newRows: AgentRow[] = [];
        for (const agent of payload.agents) {
          if (!agent.id || seenIds.has(agent.id)) continue;
          seenIds.add(agent.id);
          newRows.push(toRow(agent, country, `location:${location}`));
          if (maxAgents != null && agentsWritten + newRows.length >= maxAgents) break;
        }
        appendCsvRows(csvPath, AGENT_CSV_COLUMNS, newRows);
        agentsWritten += newRows.length;
        state.rowsWritten += newRows.length;
        state.pagesCompleted += 1;
        state.nextFrom = from + payload.agents.length;
        state.done = state.nextFrom >= payload.count;
        if (!state.done && from === 0 && payload.count <= 1000) {
          replayPageSize = payload.count;
          state.nextFrom = 0;
          console.log(
            `[enumerate] ${country}/${location} replaying bounded slice as one ${payload.count}-row page`,
          );
        }
        saveEnumerationCheckpoint(runDir, checkpoint);

        console.log(
          `[enumerate] ${country}/${location} from=${from} got=${payload.agents.length} new=${newRows.length} next=${state.nextFrom}/${payload.count} total=${agentsWritten}`,
        );
        if (!state.done) await sleepWithJitter(rateMs);
      }
    }

    countryState.done = COUNTRY_LOCATIONS[country].every(
      (location) => countryState.slices[location]?.done,
    );
    saveEnumerationCheckpoint(runDir, checkpoint);
  }

  checkpoint.done = countries.every((country) => checkpoint.countries[country]?.done);
  saveEnumerationCheckpoint(runDir, checkpoint);

  const sliceCounts: EnumerationResult['sliceCounts'] = {};
  let pagesCompleted = 0;
  let slicesCompleted = 0;
  for (const country of countries) {
    for (const [location, state] of Object.entries(
      checkpoint.countries[country]?.slices ?? {},
    )) {
      pagesCompleted += state.pagesCompleted;
      if (state.done) slicesCompleted += 1;
      sliceCounts[`${country}/${location}`] = {
        reported: state.reportedCount ?? 0,
        written: state.rowsWritten,
      };
    }
  }
  saveJson(join(runDir, 'enumeration_counts.json'), sliceCounts);

  return { agentsWritten, pagesCompleted, slicesCompleted, gqlCalls, sliceCounts };
}
