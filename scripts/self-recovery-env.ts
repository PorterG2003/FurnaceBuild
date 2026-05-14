import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { config as loadEnvFile } from 'dotenv';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const workerEnvDir = join(repoRoot, 'infra', 'workers');

function loadEnvIfPresent(path: string, override: boolean): void {
  if (existsSync(path)) {
    loadEnvFile({ path, override });
  }
}

export function loadSelfRecoveryEnv(): void {
  loadEnvIfPresent(join(repoRoot, '.env.local'), false);
  loadEnvIfPresent(join(repoRoot, '.env'), false);
  loadEnvIfPresent(join(workerEnvDir, '.env.local'), true);
  loadEnvIfPresent(join(workerEnvDir, '.env'), true);

  if (!process.env.DEV_SUPABASE_URL?.trim() && process.env.EXPO_PUBLIC_SUPABASE_URL?.trim()) {
    process.env.DEV_SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL.trim();
  }
}

export function ssmParamUnderPrefix(prefix: string, secretSegment: string): string {
  const normalizedPrefix = prefix.replace(/\/+$/, '');
  const normalizedSecretSegment = secretSegment.replace(/^\/+/, '');
  return `${normalizedPrefix}/${normalizedSecretSegment}`;
}

export async function fetchSecretFromParameterStore(
  parameterPath: string,
  region: string,
): Promise<string> {
  const ssmClient = new SSMClient({ region });
  const command = new GetParameterCommand({
    Name: parameterPath,
    WithDecryption: true,
  });
  const response = await ssmClient.send(command);
  const value = response.Parameter?.Value?.trim();
  if (!value) {
    throw new Error(`Parameter ${parameterPath} has no value`);
  }
  return value;
}

export function resolveSelfRecoveryTargetEnv(): 'prod' | 'dev' {
  const explicit = process.env.SELF_RECOVERY_TARGET_ENV?.trim().toLowerCase();
  if (explicit === 'prod' || explicit === 'dev') {
    return explicit;
  }

  if (process.env.PROD_SUPABASE_URL?.trim() && process.env.PROD_SECRET_SSM_PREFIX?.trim()) {
    return 'prod';
  }

  return 'dev';
}

export function resolveSupabaseUrlForTarget(
  targetEnv: 'prod' | 'dev',
): { url: string | null; source: string } {
  if (targetEnv === 'prod') {
    if (process.env.PROD_SUPABASE_URL?.trim()) {
      return { url: process.env.PROD_SUPABASE_URL.trim(), source: 'PROD_SUPABASE_URL' };
    }
    if (process.env.SUPABASE_URL?.trim()) {
      return { url: process.env.SUPABASE_URL.trim(), source: 'SUPABASE_URL' };
    }
  }

  if (targetEnv === 'dev') {
    if (process.env.DEV_SUPABASE_URL?.trim()) {
      return { url: process.env.DEV_SUPABASE_URL.trim(), source: 'DEV_SUPABASE_URL' };
    }
    if (process.env.EXPO_PUBLIC_SUPABASE_URL?.trim()) {
      return {
        url: process.env.EXPO_PUBLIC_SUPABASE_URL.trim(),
        source: 'EXPO_PUBLIC_SUPABASE_URL',
      };
    }
    if (process.env.SUPABASE_URL?.trim()) {
      return { url: process.env.SUPABASE_URL.trim(), source: 'SUPABASE_URL' };
    }
  }

  return { url: null, source: 'missing' };
}

export function resolveSecretParamPathForTarget(
  targetEnv: 'prod' | 'dev',
): string | null {
  if (process.env.SUPABASE_SECRET_KEY_PARAM_PATH?.trim()) {
    return process.env.SUPABASE_SECRET_KEY_PARAM_PATH.trim();
  }

  if (targetEnv === 'prod' && process.env.PROD_SECRET_SSM_PREFIX?.trim()) {
    return ssmParamUnderPrefix(
      process.env.PROD_SECRET_SSM_PREFIX.trim(),
      'SUPABASE_SECRET_KEY',
    );
  }

  if (targetEnv === 'dev' && process.env.DEV_SECRET_SSM_PREFIX?.trim()) {
    return ssmParamUnderPrefix(
      process.env.DEV_SECRET_SSM_PREFIX.trim(),
      'SUPABASE_SECRET_KEY',
    );
  }

  return null;
}
