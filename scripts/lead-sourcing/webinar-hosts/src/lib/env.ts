import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnvFile } from 'dotenv';
import {
  loadSelfRecoveryEnv,
  resolveApolloApiKey,
  resolveOpenRouterApiKey,
  resolveSelfRecoveryTargetEnv,
} from '../../../../self-recovery-env.js';

const libDir = dirname(fileURLToPath(import.meta.url));
export const packageRoot = resolve(libDir, '../..');
export const repoRoot = resolve(packageRoot, '../../..');
export const configDir = join(packageRoot, 'config');
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
  loadEnvIfPresent(join(repoRoot, 'infra', 'workers', '.env.local'), false);
  loadEnvIfPresent(join(packageRoot, '.env.local'), false);
  loadEnvIfPresent(join(packageRoot, '.env'), false);
}

let secretsHydrated = false;

function secretTargetEnvs(): Array<'prod' | 'dev'> {
  const explicitTarget = process.env.APOLLO_SECRET_TARGET_ENV?.trim().toLowerCase();
  const targets: Array<'prod' | 'dev'> =
    explicitTarget === 'prod' || explicitTarget === 'dev'
      ? [explicitTarget]
      : ['dev', resolveSelfRecoveryTargetEnv()];
  return [...new Set(targets)];
}

/** Load env files, then hydrate Apollo/OpenRouter keys from SSM when not set locally. */
export async function ensureEnv(): Promise<void> {
  loadEnv();
  if (secretsHydrated) return;
  secretsHydrated = true;
  loadSelfRecoveryEnv();

  const targets = secretTargetEnvs();

  if (!process.env.APOLLO_API_KEY?.trim()) {
    for (const targetEnv of targets) {
      try {
        const { apiKey } = await resolveApolloApiKey({ targetEnv });
        process.env.APOLLO_API_KEY = apiKey;
        break;
      } catch {
        // Try the next SSM prefix (dev sandbox, then self-recovery default).
      }
    }
  }

  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    for (const targetEnv of targets) {
      try {
        const { apiKey } = await resolveOpenRouterApiKey({ targetEnv });
        process.env.OPENROUTER_API_KEY = apiKey;
        break;
      } catch {
        // Non-fatal — callers that need OpenRouter report the missing key.
      }
    }
  }
}

export function useFixtures(): boolean {
  return process.env.USE_FIXTURES === '1' || process.env.USE_FIXTURES === 'true';
}

export function envInt(name: string, fallback: number | null = null): number | null {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function envBool(name: string, fallback = false): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes';
}

export function scrapeProfiles(): boolean {
  return envBool('SCRAPE_PROFILES');
}
