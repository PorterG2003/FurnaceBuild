import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnvFile } from 'dotenv';
import { loadSelfRecoveryEnv, resolveApolloApiKey, resolveMillionVerifierApiKey, resolveSerperApiKey } from '../../../../self-recovery-env.js';

const libDir = dirname(fileURLToPath(import.meta.url));
export const packageRoot = resolve(libDir, '../..');
export const repoRoot = resolve(packageRoot, '../../..');
export const configDir = join(packageRoot, 'config');
export const fixturesDir = join(packageRoot, 'fixtures');
export const outputDir = join(packageRoot, 'output');
export const dataDir = join(packageRoot, 'data');

function loadEnvIfPresent(path: string, override: boolean): void {
  if (existsSync(path)) {
    loadEnvFile({ path, override });
  }
}

export function loadEnv(): void {
  loadEnvIfPresent(join(repoRoot, '.env.local'), false);
  loadEnvIfPresent(join(repoRoot, '.env'), false);
  loadEnvIfPresent(join(packageRoot, '.env.local'), false);
  loadEnvIfPresent(join(packageRoot, '.env'), false);
}

export function useFixtures(): boolean {
  return process.env.USE_FIXTURES === '1' || process.env.USE_FIXTURES === 'true';
}

export function defaultInputCsv(): string {
  return join(fixturesDir, 'closed-won-sample.csv');
}

export function defaultAvoidCsv(): string {
  return join(fixturesDir, 'avoid-list-sample.csv');
}

export function downloadsClosedWonCsv(): string {
  return join(
    process.env.HOME ?? '',
    'Downloads',
    'Accounts_Closed-Won_after_1_1_2023.csv',
  );
}

export function downloadsAvoidCsv(): string {
  return join(process.env.HOME ?? '', 'Downloads', 'Avoid_List_for_Cold_Outreach.csv');
}

export function defaultMatchesCsv(): string {
  return join(outputDir, 'runs/full-1/matches.csv');
}

export function defaultSchoolsCache(): string {
  return join(dataDir, 'ccd-schools-2024.json');
}

export function fixtureSchoolsCache(): string {
  return join(fixturesDir, 'ccd-schools.json');
}

let secretsHydrated = false;

export async function ensureSerperEnv(): Promise<void> {
  loadEnv();
  if (secretsHydrated) return;
  secretsHydrated = true;
  loadSelfRecoveryEnv();
  if (process.env.SERPER_API_KEY?.trim()) return;
  for (const targetEnv of ['dev', 'prod'] as const) {
    try {
      const { apiKey } = await resolveSerperApiKey({ targetEnv });
      process.env.SERPER_API_KEY = apiKey;
      return;
    } catch {
      // try next
    }
  }
}

export async function ensureApolloEnv(): Promise<void> {
  loadEnv();
  if (process.env.APOLLO_API_KEY?.trim()) return;
  loadSelfRecoveryEnv();
  for (const targetEnv of ['dev', 'prod'] as const) {
    try {
      const { apiKey } = await resolveApolloApiKey({ targetEnv });
      process.env.APOLLO_API_KEY = apiKey;
      return;
    } catch {
      // try next
    }
  }
}

export async function ensureMillionVerifierEnv(): Promise<void> {
  loadEnv();
  if (process.env.MILLION_VERIFIER_API_KEY?.trim()) return;
  loadSelfRecoveryEnv();
  for (const targetEnv of ['dev', 'prod'] as const) {
    try {
      const { apiKey } = await resolveMillionVerifierApiKey({ targetEnv });
      process.env.MILLION_VERIFIER_API_KEY = apiKey;
      return;
    } catch {
      // try next
    }
  }
}
