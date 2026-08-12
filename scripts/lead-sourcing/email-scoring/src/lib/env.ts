import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadSelfRecoveryEnv,
  resolveMillionVerifierApiKey,
  resolveSelfRecoveryTargetEnv,
} from '../../../../self-recovery-env.js';

const libDir = dirname(fileURLToPath(import.meta.url));
export const packageRoot = resolve(libDir, '../..');
export const repoRoot = resolve(packageRoot, '../../..');
export const inputsDir = join(packageRoot, 'inputs');
export const outputDir = join(packageRoot, 'output');

let secretsHydrated = false;
let cachedMillionVerifierApiKey: string | null = null;

/** Load repo/worker env, then hydrate Million Verifier key from Amplify SSM. */
export async function ensureEnv(): Promise<void> {
  loadSelfRecoveryEnv();
  if (secretsHydrated) return;

  secretsHydrated = true;

  const explicitTarget = process.env.MILLION_VERIFIER_SECRET_TARGET_ENV?.trim().toLowerCase();
  const targets: Array<'prod' | 'dev'> =
    explicitTarget === 'prod' || explicitTarget === 'dev'
      ? [explicitTarget]
      : ['dev', resolveSelfRecoveryTargetEnv()];

  for (const targetEnv of [...new Set(targets)]) {
    try {
      const { apiKey } = await resolveMillionVerifierApiKey({ targetEnv });
      cachedMillionVerifierApiKey = apiKey;
      return;
    } catch {
      // Try the next SSM prefix (dev sandbox, then self-recovery default).
    }
  }
}

export function millionVerifierApiKey(): string {
  if (!cachedMillionVerifierApiKey) {
    throw new Error(
      'Million Verifier API key not loaded. Call ensureEnv() before live runs, or use --fixtures.',
    );
  }
  return cachedMillionVerifierApiKey;
}
