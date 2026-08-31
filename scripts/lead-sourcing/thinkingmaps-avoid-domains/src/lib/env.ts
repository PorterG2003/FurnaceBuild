import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnvFile } from 'dotenv';
import { loadSelfRecoveryEnv, resolveSerperApiKey } from '../../../../self-recovery-env.js';

const libDir = dirname(fileURLToPath(import.meta.url));
export const packageRoot = resolve(libDir, '../..');
export const repoRoot = resolve(packageRoot, '../../..');
export const fixturesDir = join(packageRoot, 'fixtures');
export const outputDir = join(packageRoot, 'output');

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
  return join(fixturesDir, 'avoid-list-sample.csv');
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
