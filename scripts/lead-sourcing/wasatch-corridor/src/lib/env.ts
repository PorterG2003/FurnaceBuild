import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnvFile } from 'dotenv';
import {
  loadSelfRecoveryEnv,
  resolveApolloApiKey,
  resolveOpenRouterApiKey,
  resolveSerperApiKey,
  resolveSelfRecoveryTargetEnv,
} from '../../../../self-recovery-env.js';

const libDir = dirname(fileURLToPath(import.meta.url));
export const packageRoot = resolve(libDir, '../..');
export const repoRoot = resolve(packageRoot, '../../..');
export const fixturesDir = join(packageRoot, 'fixtures');
export const configDir = join(packageRoot, 'config');
export const outputDir = join(packageRoot, 'output');

function loadEnvIfPresent(path: string, override: boolean): void {
  if (existsSync(path)) loadEnvFile({ path, override });
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

let bootstrapped = false;
const hydrated = { apollo: false, openrouter: false, serper: false };

function explicitSecretTarget(): 'prod' | 'dev' | null {
  const explicitTarget = (
    process.env.APOLLO_SECRET_TARGET_ENV?.trim() ||
    process.env.SERPER_SECRET_TARGET_ENV?.trim() ||
    ''
  ).toLowerCase();
  if (explicitTarget === 'prod' || explicitTarget === 'dev') return explicitTarget;
  return null;
}

function secretTargets(): Array<'prod' | 'dev'> {
  const explicit = explicitSecretTarget();
  const targets: Array<'prod' | 'dev'> = explicit
    ? [explicit]
    : ['dev', resolveSelfRecoveryTargetEnv(), 'prod'];
  return [...new Set(targets)];
}

export async function ensureEnv(options: { apollo?: boolean; openrouter?: boolean; serper?: boolean } = {}): Promise<void> {
  loadEnv();
  if (!bootstrapped) {
    loadSelfRecoveryEnv();
    bootstrapped = true;
  }

  if (options.apollo && !hydrated.apollo) {
    if (process.env.APOLLO_API_KEY?.trim()) {
      hydrated.apollo = true;
    } else {
      for (const targetEnv of secretTargets()) {
        try {
          const { apiKey } = await resolveApolloApiKey({ targetEnv });
          process.env.APOLLO_API_KEY = apiKey;
          hydrated.apollo = true;
          break;
        } catch {
          // try next
        }
      }
    }
  }

  if (options.openrouter && !hydrated.openrouter) {
    if (process.env.OPENROUTER_API_KEY?.trim()) {
      hydrated.openrouter = true;
    } else {
      for (const targetEnv of secretTargets()) {
        try {
          const { apiKey } = await resolveOpenRouterApiKey({ targetEnv });
          process.env.OPENROUTER_API_KEY = apiKey;
          hydrated.openrouter = true;
          break;
        } catch {
          // try next
        }
      }
    }
  }

  if (options.serper && !hydrated.serper) {
    if (process.env.SERPER_API_KEY?.trim()) {
      hydrated.serper = true;
    } else {
      for (const targetEnv of secretTargets()) {
        try {
          const { apiKey } = await resolveSerperApiKey({ targetEnv });
          process.env.SERPER_API_KEY = apiKey;
          hydrated.serper = true;
          break;
        } catch {
          // try next
        }
      }
    }
  }
}
