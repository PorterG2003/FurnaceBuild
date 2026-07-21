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
  return resolveAmplifySecretParamPathForTarget(targetEnv, 'SUPABASE_SECRET_KEY');
}

export function resolveAmplifySecretParamPathForTarget(
  targetEnv: 'prod' | 'dev',
  secretSegment: string,
): string | null {
  const explicitPathBySegment: Record<string, string | undefined> = {
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY_PARAM_PATH?.trim(),
    RESEND_API_KEY: process.env.RESEND_API_KEY_PARAM_PATH?.trim(),
    APOLLO_API_KEY: process.env.APOLLO_API_KEY_PARAM_PATH?.trim(),
    MILLION_VERIFIER_API_KEY: process.env.MILLION_VERIFIER_API_KEY_PARAM_PATH?.trim(),
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY_PARAM_PATH?.trim(),
  };
  const explicitPath = explicitPathBySegment[secretSegment];
  if (explicitPath) {
    return explicitPath;
  }

  if (targetEnv === 'prod' && process.env.PROD_SECRET_SSM_PREFIX?.trim()) {
    return ssmParamUnderPrefix(
      process.env.PROD_SECRET_SSM_PREFIX.trim(),
      secretSegment,
    );
  }

  if (targetEnv === 'dev' && process.env.DEV_SECRET_SSM_PREFIX?.trim()) {
    return ssmParamUnderPrefix(
      process.env.DEV_SECRET_SSM_PREFIX.trim(),
      secretSegment,
    );
  }

  return null;
}

export function resolveResendApiKeyParamPathForTarget(
  targetEnv: 'prod' | 'dev',
): string | null {
  return resolveAmplifySecretParamPathForTarget(targetEnv, 'RESEND_API_KEY');
}

export function resolveApolloApiKeyParamPathForTarget(
  targetEnv: 'prod' | 'dev',
): string | null {
  return resolveAmplifySecretParamPathForTarget(targetEnv, 'APOLLO_API_KEY');
}

export function resolveMillionVerifierApiKeyParamPathForTarget(
  targetEnv: 'prod' | 'dev',
): string | null {
  return resolveAmplifySecretParamPathForTarget(targetEnv, 'MILLION_VERIFIER_API_KEY');
}

export function resolveOpenRouterApiKeyParamPathForTarget(
  targetEnv: 'prod' | 'dev',
): string | null {
  return resolveAmplifySecretParamPathForTarget(targetEnv, 'OPENROUTER_API_KEY');
}

export async function resolveResendApiKey(options?: {
  targetEnv?: 'prod' | 'dev';
  awsRegion?: string;
}): Promise<{ apiKey: string; source: string }> {
  const targetEnv = options?.targetEnv ?? resolveSelfRecoveryTargetEnv();
  const awsRegion =
    options?.awsRegion?.trim() ||
    process.env.AWS_REGION?.trim() ||
    process.env.CDK_DEFAULT_REGION?.trim() ||
    'us-west-2';

  const fromEnv = process.env.RESEND_API_KEY?.trim();
  if (fromEnv) {
    return { apiKey: fromEnv, source: 'RESEND_API_KEY environment variable' };
  }

  const paramPath = resolveResendApiKeyParamPathForTarget(targetEnv);
  if (paramPath) {
    const apiKey = await fetchSecretFromParameterStore(paramPath, awsRegion);
    return { apiKey, source: `Parameter Store ${paramPath}` };
  }

  throw new Error(
    'Missing RESEND_API_KEY. Set RESEND_API_KEY, RESEND_API_KEY_PARAM_PATH, or DEV_SECRET_SSM_PREFIX / PROD_SECRET_SSM_PREFIX (same Amplify secrets folder as SUPABASE_SECRET_KEY).',
  );
}

export async function resolveApolloApiKey(options?: {
  targetEnv?: 'prod' | 'dev';
  awsRegion?: string;
}): Promise<{ apiKey: string; source: string }> {
  const targetEnv = options?.targetEnv ?? resolveSelfRecoveryTargetEnv();
  const awsRegion =
    options?.awsRegion?.trim() ||
    process.env.AWS_REGION?.trim() ||
    process.env.CDK_DEFAULT_REGION?.trim() ||
    'us-west-2';

  const fromEnv = process.env.APOLLO_API_KEY?.trim();
  if (fromEnv) {
    return { apiKey: fromEnv, source: 'APOLLO_API_KEY environment variable' };
  }

  const paramPath = resolveApolloApiKeyParamPathForTarget(targetEnv);
  if (paramPath) {
    const apiKey = await fetchSecretFromParameterStore(paramPath, awsRegion);
    return { apiKey, source: `Parameter Store ${paramPath}` };
  }

  throw new Error(
    'Missing APOLLO_API_KEY. Set APOLLO_API_KEY, APOLLO_API_KEY_PARAM_PATH, or DEV_SECRET_SSM_PREFIX / PROD_SECRET_SSM_PREFIX (same Amplify secrets folder as SUPABASE_SECRET_KEY).',
  );
}

export async function resolveMillionVerifierApiKey(options?: {
  targetEnv?: 'prod' | 'dev';
  awsRegion?: string;
}): Promise<{ apiKey: string; source: string }> {
  const targetEnv = options?.targetEnv ?? resolveSelfRecoveryTargetEnv();
  const awsRegion =
    options?.awsRegion?.trim() ||
    process.env.AWS_REGION?.trim() ||
    process.env.CDK_DEFAULT_REGION?.trim() ||
    'us-west-2';

  const paramPath = resolveMillionVerifierApiKeyParamPathForTarget(targetEnv);
  if (paramPath) {
    const apiKey = await fetchSecretFromParameterStore(paramPath, awsRegion);
    return { apiKey, source: `Parameter Store ${paramPath}` };
  }

  throw new Error(
    'Missing MILLION_VERIFIER_API_KEY. Set MILLION_VERIFIER_API_KEY_PARAM_PATH or DEV_SECRET_SSM_PREFIX / PROD_SECRET_SSM_PREFIX (same Amplify secrets folder as SUPABASE_SECRET_KEY).',
  );
}

export async function resolveOpenRouterApiKey(options?: {
  targetEnv?: 'prod' | 'dev';
  awsRegion?: string;
}): Promise<{ apiKey: string; source: string }> {
  const targetEnv = options?.targetEnv ?? resolveSelfRecoveryTargetEnv();
  const awsRegion =
    options?.awsRegion?.trim() ||
    process.env.AWS_REGION?.trim() ||
    process.env.CDK_DEFAULT_REGION?.trim() ||
    'us-west-2';

  const fromEnv = process.env.OPENROUTER_API_KEY?.trim();
  if (fromEnv) {
    return { apiKey: fromEnv, source: 'OPENROUTER_API_KEY environment variable' };
  }

  const paramPath = resolveOpenRouterApiKeyParamPathForTarget(targetEnv);
  if (paramPath) {
    const apiKey = await fetchSecretFromParameterStore(paramPath, awsRegion);
    return { apiKey, source: `Parameter Store ${paramPath}` };
  }

  throw new Error(
    'Missing OPENROUTER_API_KEY. Set OPENROUTER_API_KEY, OPENROUTER_API_KEY_PARAM_PATH, or DEV_SECRET_SSM_PREFIX / PROD_SECRET_SSM_PREFIX (same Amplify secrets folder as SUPABASE_SECRET_KEY).',
  );
}
