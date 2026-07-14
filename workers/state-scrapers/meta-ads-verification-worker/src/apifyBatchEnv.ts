import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function loadApifyTokenFromEnvOrSsm(): string {
  const existing = process.env.APIFY_TOKEN?.trim();
  if (existing) return existing;

  const prefix =
    process.env.DEV_SECRET_SSM_PREFIX?.trim() ||
    readDevSecretPrefixFromWorkersEnv() ||
    '/amplify/furnacebuild/porter-sandbox-387f79dcc1';
  const paramName = `${prefix.replace(/\/+$/, '')}/APIFY_TOKEN`;

  try {
    const token = execSync(
      `aws ssm get-parameter --name "${paramName}" --with-decryption --region us-west-2 --query 'Parameter.Value' --output text`,
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim();
    if (token && token !== 'None') {
      process.env.APIFY_TOKEN = token;
      return token;
    }
  } catch {
    /* fall through */
  }

  throw new Error(
    'APIFY_TOKEN is required. Export APIFY_TOKEN or store it in Amplify secrets (APIFY_TOKEN).',
  );
}

function readDevSecretPrefixFromWorkersEnv(): string | null {
  const path = resolve(__dirname, '../../../../infra/workers/.env.local');
  if (!existsSync(path)) return null;
  const match = readFileSync(path, 'utf8').match(/^DEV_SECRET_SSM_PREFIX=(.+)$/m);
  return match?.[1]?.trim().replace(/^["']|["']$/g, '') ?? null;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function acquireApifyBatchLock(outDir: string): void {
  const lockPath = resolve(outDir, '.batch.lock');
  if (existsSync(lockPath)) {
    const pid = Number(readFileSync(lockPath, 'utf8').trim());
    if (Number.isFinite(pid) && pid > 0 && isProcessAlive(pid)) {
      throw new Error(
        `Another Apify meta ads batch is already running (pid ${pid}). Stop it first or delete ${lockPath}`,
      );
    }
    unlinkSync(lockPath);
  }
  writeFileSync(lockPath, String(process.pid));
  const release = (): void => {
    try {
      if (existsSync(lockPath) && readFileSync(lockPath, 'utf8').trim() === String(process.pid)) {
        unlinkSync(lockPath);
      }
    } catch {
      /* ignore */
    }
  };
  process.once('exit', release);
  process.once('SIGINT', () => {
    release();
    process.exit(130);
  });
  process.once('SIGTERM', () => {
    release();
    process.exit(143);
  });
}
