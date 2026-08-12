import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { openCountryPage, sleepWithJitter } from './browser.ts';
import { loadAgentsCheckpoint, saveAgentsCheckpoint } from './checkpoint.ts';
import { appendCsvRows, readCsv } from './csv.ts';
import { searchAgentsByName } from './graphql.ts';
import { listSuggestionNamesForCountry } from './suggest.ts';
import {
  AGENT_CSV_COLUMNS,
  PAGE_SIZE,
  type AgentRow,
  type AgentsCheckpoint,
  type CountryCode,
} from './types.ts';

export type SearchPhaseResult = {
  agentsWritten: number;
  namesCompleted: number;
  gqlCalls: number;
};

function agentsCsvPath(runDir: string): string {
  return join(runDir, 'agents.csv');
}

function stripHtml(bio: string): string {
  return bio.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function toRow(
  agent: {
    id: string;
    firstName: string;
    lastName: string;
    city: string;
    state: string;
    photo: string;
    email: string | null;
    phoneNumber: string | null;
    bio: string;
  },
  country: CountryCode,
  sourceNameQuery: string,
): AgentRow {
  return {
    id: agent.id,
    first_name: agent.firstName ?? '',
    last_name: agent.lastName ?? '',
    email: agent.email ?? '',
    phone: agent.phoneNumber ?? '',
    city: agent.city ?? '',
    state: agent.state ?? '',
    country,
    photo_url: agent.photo ?? '',
    bio: stripHtml(agent.bio ?? ''),
    source_name_query: sourceNameQuery,
    scraped_at: new Date().toISOString(),
  };
}

function emptyCountryState() {
  return {
    done: false,
    completedNames: [] as string[],
    seenIds: [] as string[],
    agentCount: 0,
  };
}

export async function runSearchPhase(options: {
  page: Page;
  runDir: string;
  countries: CountryCode[];
  maxAgents: number | null;
  rateMs: number;
  resume: boolean;
}): Promise<SearchPhaseResult> {
  const { page, runDir, countries, maxAgents, rateMs, resume } = options;

  let checkpoint: AgentsCheckpoint =
    resume && loadAgentsCheckpoint(runDir)
      ? loadAgentsCheckpoint(runDir)!
      : { done: false, countries: {} };

  const existingRows = resume && existsSync(agentsCsvPath(runDir))
    ? readCsv(agentsCsvPath(runDir))
    : [];
  const globalSeen = new Set(existingRows.map((r) => r.id).filter(Boolean));

  let gqlCalls = 0;
  let agentsWritten = existingRows.length;
  let namesCompleted = 0;

  for (const country of countries) {
    if (!checkpoint.countries[country]) {
      checkpoint.countries[country] = emptyCountryState();
    }
    const state = checkpoint.countries[country]!;
    const completedNames = new Set(state.completedNames);
    const seenIds = new Set([...state.seenIds, ...globalSeen]);

    if (state.done) {
      namesCompleted += completedNames.size;
      console.log(
        `[search] ${country} already done agents=${state.agentCount} names=${completedNames.size}`,
      );
      continue;
    }

    const names = listSuggestionNamesForCountry(runDir, country);
    console.log(
      `[search] ${country} names=${names.length} completed=${completedNames.size} maxAgents=${maxAgents ?? 'all'}`,
    );

    if (!names.length) {
      console.warn(`[search] ${country} no suggestions to search`);
      state.done = true;
      saveAgentsCheckpoint(runDir, checkpoint);
      continue;
    }

    await openCountryPage(page, country);

    for (const name of names) {
      if (completedNames.has(name)) continue;
      if (maxAgents != null && agentsWritten >= maxAgents) {
        console.log(`[search] hit max-agents=${maxAgents}`);
        break;
      }

      let pageNumber = 1;
      let totalCount = Infinity;
      const newRows: AgentRow[] = [];

      try {
        while ((pageNumber - 1) * PAGE_SIZE < totalCount) {
          if (maxAgents != null && agentsWritten + newRows.length >= maxAgents) break;

          const result = await searchAgentsByName(page, {
            name,
            country,
            pageNumber,
          });
          gqlCalls += 1;
          totalCount = result.count ?? 0;

          for (const agent of result.agents ?? []) {
            if (!agent?.id || seenIds.has(agent.id)) continue;
            seenIds.add(agent.id);
            globalSeen.add(agent.id);
            newRows.push(toRow(agent, country, name));
            if (maxAgents != null && agentsWritten + newRows.length >= maxAgents) break;
          }

          if (!result.agents?.length) break;
          if (pageNumber * PAGE_SIZE >= totalCount) break;
          pageNumber += 1;
          await sleepWithJitter(rateMs);
        }
      } catch (error) {
        console.warn(`[search] ${country} name="${name}" failed: ${String(error)}`);
        await openCountryPage(page, country);
      }

      if (newRows.length) {
        appendCsvRows(agentsCsvPath(runDir), AGENT_CSV_COLUMNS, newRows);
        agentsWritten += newRows.length;
      }

      completedNames.add(name);
      namesCompleted += 1;
      state.completedNames = [...completedNames];
      state.seenIds = [...seenIds];
      state.agentCount = state.seenIds.length;
      saveAgentsCheckpoint(runDir, checkpoint);

      console.log(
        `[search] ${country} name="${name}" pages~${pageNumber} new=${newRows.length} totalAgents=${agentsWritten}`,
      );

      await sleepWithJitter(rateMs);
    }

    const pending = names.filter((n) => !completedNames.has(n));
    state.done =
      pending.length === 0 || (maxAgents != null && agentsWritten >= maxAgents);
    saveAgentsCheckpoint(runDir, checkpoint);
    console.log(`[search] ${country} pass complete done=${state.done}`);
  }

  checkpoint.done = countries.every((c) => checkpoint.countries[c]?.done);
  saveAgentsCheckpoint(runDir, checkpoint);

  return { agentsWritten, namesCompleted, gqlCalls };
}
