import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  AgentsCheckpoint,
  EnumerationCheckpoint,
  SuggestionsCheckpoint,
} from './types.ts';

export function loadJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

export function saveJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function suggestionsCheckpointPath(runDir: string): string {
  return join(runDir, 'suggestions_checkpoint.json');
}

export function agentsCheckpointPath(runDir: string): string {
  return join(runDir, 'agents_checkpoint.json');
}

export function enumerationCheckpointPath(runDir: string): string {
  return join(runDir, 'enumeration_checkpoint.json');
}

export function loadSuggestionsCheckpoint(runDir: string): SuggestionsCheckpoint | null {
  return loadJson<SuggestionsCheckpoint>(suggestionsCheckpointPath(runDir));
}

export function saveSuggestionsCheckpoint(runDir: string, checkpoint: SuggestionsCheckpoint): void {
  saveJson(suggestionsCheckpointPath(runDir), checkpoint);
}

export function loadAgentsCheckpoint(runDir: string): AgentsCheckpoint | null {
  return loadJson<AgentsCheckpoint>(agentsCheckpointPath(runDir));
}

export function saveAgentsCheckpoint(runDir: string, checkpoint: AgentsCheckpoint): void {
  saveJson(agentsCheckpointPath(runDir), checkpoint);
}

export function loadEnumerationCheckpoint(runDir: string): EnumerationCheckpoint | null {
  return loadJson<EnumerationCheckpoint>(enumerationCheckpointPath(runDir));
}

export function saveEnumerationCheckpoint(
  runDir: string,
  checkpoint: EnumerationCheckpoint,
): void {
  saveJson(enumerationCheckpointPath(runDir), checkpoint);
}

export function appendJsonl(path: string, row: unknown): void {
  writeFileSync(path, `${JSON.stringify(row)}\n`, { encoding: 'utf8', flag: 'a' });
}
