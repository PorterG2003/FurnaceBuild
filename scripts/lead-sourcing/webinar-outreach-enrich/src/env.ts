import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { config as loadEnvFile } from 'dotenv';
import {
  loadSelfRecoveryEnv,
  resolveApolloApiKey,
  resolveProspeoApiKey,
  resolveSerperApiKey,
  resolveSelfRecoveryTargetEnv,
} from '../../../self-recovery-env.js';

const srcDir = dirname(fileURLToPath(import.meta.url));
export const packageRoot = resolve(srcDir, '..');
export const repoRoot = resolve(packageRoot, '../../..');
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
}

let bootstrapped = false;
const hydrated = { apollo: false, prospeo: false, serper: false };

function explicitSecretTarget(): 'prod' | 'dev' | null {
  const explicitTarget = (
    process.env.PROSPEO_SECRET_TARGET_ENV?.trim() ||
    process.env.APOLLO_SECRET_TARGET_ENV?.trim() ||
    ''
  ).toLowerCase();
  if (explicitTarget === 'prod' || explicitTarget === 'dev') return explicitTarget;
  return null;
}

function apolloSecretTargets(): Array<'prod' | 'dev'> {
  const explicit = explicitSecretTarget();
  const targets: Array<'prod' | 'dev'> = explicit
    ? [explicit]
    : ['dev', resolveSelfRecoveryTargetEnv(), 'prod'];
  return [...new Set(targets)];
}

function prospeoSecretTargets(): Array<'prod' | 'dev'> {
  const explicit = explicitSecretTarget();
  const targets: Array<'prod' | 'dev'> = explicit
    ? [explicit]
    : ['prod', resolveSelfRecoveryTargetEnv(), 'dev'];
  return [...new Set(targets)];
}

function serperSecretTargets(): Array<'prod' | 'dev'> {
  const explicit = explicitSecretTarget();
  const targets: Array<'prod' | 'dev'> = explicit
    ? [explicit]
    : ['dev', resolveSelfRecoveryTargetEnv(), 'prod'];
  return [...new Set(targets)];
}

async function prospeoKeyLooksValid(apiKey: string): Promise<boolean> {
  try {
    const resp = await fetch('https://api.prospeo.io/account-information', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-KEY': apiKey },
      body: JSON.stringify({}),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

async function apolloKeyCanEnrichOrg(apiKey: string): Promise<boolean> {
  try {
    const resp = await fetch(
      'https://api.apollo.io/api/v1/organizations/enrich?domain=apollo.io',
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
          'X-Api-Key': apiKey,
        },
      },
    );
    return resp.status !== 401 && resp.status !== 403;
  } catch {
    return false;
  }
}

/**
 * Hydrate secrets from env/SSM.
 * Defaults (no opts): Apollo + Prospeo.
 * Pass explicit flags to request subsets, e.g. `{ serper: true, apollo: false, prospeo: false }`.
 */
export async function ensureEnv(options?: {
  apollo?: boolean;
  prospeo?: boolean;
  serper?: boolean;
}): Promise<void> {
  loadEnv();
  if (!bootstrapped) {
    loadSelfRecoveryEnv();
    bootstrapped = true;
  }

  // Old semantics: omitted flag defaults true for apollo/prospeo; serper opt-in only.
  const wantApollo = options == null ? true : options.apollo !== false;
  const wantProspeo = options == null ? true : options.prospeo !== false;
  const wantSerper = options?.serper === true;

  if (wantApollo && !hydrated.apollo) {
    const existing = process.env.APOLLO_API_KEY?.trim();
    if (existing && (await apolloKeyCanEnrichOrg(existing))) {
      hydrated.apollo = true;
    } else {
      if (existing) delete process.env.APOLLO_API_KEY;
      for (const targetEnv of apolloSecretTargets()) {
        try {
          delete process.env.APOLLO_API_KEY;
          const { apiKey } = await resolveApolloApiKey({ targetEnv });
          if (await apolloKeyCanEnrichOrg(apiKey)) {
            process.env.APOLLO_API_KEY = apiKey;
            hydrated.apollo = true;
            break;
          }
        } catch {
          // try next
        }
      }
    }
  }

  if (wantProspeo && !hydrated.prospeo) {
    const existing = process.env.PROSPEO_API_KEY?.trim();
    if (existing && (await prospeoKeyLooksValid(existing))) {
      hydrated.prospeo = true;
    } else {
      if (existing) delete process.env.PROSPEO_API_KEY;
      for (const targetEnv of prospeoSecretTargets()) {
        try {
          delete process.env.PROSPEO_API_KEY;
          const { apiKey } = await resolveProspeoApiKey({ targetEnv });
          if (await prospeoKeyLooksValid(apiKey)) {
            process.env.PROSPEO_API_KEY = apiKey;
            hydrated.prospeo = true;
            break;
          }
        } catch {
          // try next
        }
      }
    }
  }

  if (wantSerper && !hydrated.serper) {
    if (process.env.SERPER_API_KEY?.trim()) {
      hydrated.serper = true;
    } else {
      for (const targetEnv of serperSecretTargets()) {
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

export function defaultOutreachCsv(): string {
  return join(
    repoRoot,
    'scripts/lead-sourcing/meta-webinar-ads/output/exports/webinar-outreach.csv',
  );
}

export function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg?.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

export function asNumber(value: string | boolean | undefined, fallback: number | null): number | null {
  if (value === undefined || value === true) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
