import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSupabaseClient } from './supabase.js';
import { DatabaseClient } from './database.js';
import { InboxCheckerWorker } from './worker.js';
import {
  IMAP_RECOVERY_BATCH_SIZE,
  IMAP_RECOVERY_CONCURRENCY,
  IMAP_RECOVERY_COOLDOWN_HOURS,
  IMAP_RECOVERY_RUN_ON_START,
  resolveImapRecoveryIntervalMs,
} from './imap-recovery-config.js';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

const workerDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(workerDir, '../..');

// Repo-root secrets first; worker .env can override (e.g. IMAP_RECOVERY_INTERVAL_MS).
dotenv.config({ path: path.join(repoRoot, '.env.local') });
dotenv.config({ path: path.join(workerDir, '.env') });

/**
 * Fetch secret from Parameter Store
 */
async function fetchSecretFromParameterStore(
  parameterPath: string,
  region: string
): Promise<string> {
  const ssmClient = new SSMClient({ region });
  const command = new GetParameterCommand({
    Name: parameterPath,
    WithDecryption: true,
  });

  try {
    const response = await ssmClient.send(command);
    if (!response.Parameter?.Value) {
      throw new Error(`Parameter ${parameterPath} has no value`);
    }
    // Trim whitespace and newlines (common when pasting secrets)
    return response.Parameter.Value.trim();
  } catch (error) {
    throw new Error(`Failed to fetch secret from Parameter Store: ${error}`);
  }
}

/**
 * Main entry point for inbox checker worker
 * 
 * Environment variables required:
 * - SUPABASE_URL: Supabase project URL (or EXPO_PUBLIC_SUPABASE_URL for local dev)
 * - SUPABASE_SECRET_KEY: Supabase Secret Key (or SUPABASE_SECRET_KEY_PARAM_PATH to fetch from Parameter Store)
 * - AWS_REGION: AWS region (defaults to us-west-2)
 *
 * Optional (for local dev, set in workers/inbox-checker-worker/.env):
 * - IMAP_RECOVERY_INTERVAL_MS: override recovery tick interval (e.g. 60000 for local smoke tests)
 */
async function main() {
  // Log immediately on startup to verify process is running
  console.log('[STARTUP] Inbox checker worker process starting...');
  console.log('[STARTUP] Node version:', process.version);
  console.log('[STARTUP] Working directory:', process.cwd());
  
  try {
    // Validate environment variables
    const supabaseUrl = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
    const supabaseSecretKeyParamPath = process.env.SUPABASE_SECRET_KEY_PARAM_PATH;
    const supabaseSecretKey =
      process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
    const awsRegion = process.env.AWS_REGION || 'us-west-2';

    if (!supabaseUrl) {
      throw new Error('Missing required environment variable: SUPABASE_URL');
    }

    // Fetch SUPABASE_SECRET_KEY from Parameter Store if path is provided
    let secretKey = supabaseSecretKey;
    if (supabaseSecretKeyParamPath && !secretKey) {
      console.log(`Fetching SUPABASE_SECRET_KEY from Parameter Store: ${supabaseSecretKeyParamPath}`);
      secretKey = await fetchSecretFromParameterStore(supabaseSecretKeyParamPath, awsRegion);
      process.env.SUPABASE_SECRET_KEY = secretKey;
    }

    if (!secretKey) {
      throw new Error(
        'Missing SUPABASE_SECRET_KEY. Provide either SUPABASE_SECRET_KEY, SUPABASE_SERVICE_ROLE_KEY, or SUPABASE_SECRET_KEY_PARAM_PATH'
      );
    }

    process.env.SUPABASE_URL = supabaseUrl;
    process.env.SUPABASE_SECRET_KEY = secretKey;

    console.log('Initializing inbox checker worker...');
    console.log(`AWS Region: ${awsRegion}`);
    const imapRecoveryIntervalMs = resolveImapRecoveryIntervalMs(
      process.env.IMAP_RECOVERY_INTERVAL_MS,
    );
    console.log(
      `[IMAP RECOVERY] interval=${imapRecoveryIntervalMs}ms batch=${IMAP_RECOVERY_BATCH_SIZE} cooldown=${IMAP_RECOVERY_COOLDOWN_HOURS}h concurrency=${IMAP_RECOVERY_CONCURRENCY}`,
    );

    // Initialize clients
    const supabase = createSupabaseClient();
    const databaseClient = new DatabaseClient({
      supabase,
      batchSize: 50, // Claim 50 mailboxes at a time
      checkIntervalMinutes: 5, // Check mailboxes every 5 minutes
      processingTimeoutMinutes: 10, // Timeout after 10 minutes
    });

    // Create and start worker
    const worker = new InboxCheckerWorker({
      supabase,
      databaseClient,
      concurrencyLimit: 10, // Process 10 mailboxes in parallel
      recovery: {
        intervalMs: imapRecoveryIntervalMs,
        batchSize: IMAP_RECOVERY_BATCH_SIZE,
        cooldownHours: IMAP_RECOVERY_COOLDOWN_HOURS,
        concurrency: IMAP_RECOVERY_CONCURRENCY,
        runOnStart: IMAP_RECOVERY_RUN_ON_START,
      },
    });

    // Handle graceful shutdown — request stop only; do not process.exit here.
    process.on('SIGTERM', () => {
      console.log('SIGTERM received, shutting down gracefully...');
      void worker.stop();
    });

    process.on('SIGINT', () => {
      console.log('SIGINT received, shutting down gracefully...');
      void worker.stop();
    });

    // Start worker (runs until stop() drains and start() resolves)
    await worker.start();

  } catch (error) {
    console.error('[FATAL ERROR] Inbox checker worker failed to start:', error);
    if (error instanceof Error) {
      console.error('[FATAL ERROR] Error message:', error.message);
      console.error('[FATAL ERROR] Stack trace:', error.stack);
    }
    const { reportErrorToSlack } = await import('@furnace/slack-lib');
    reportErrorToSlack('Inbox-checker worker failed to start', {
      severity: 'critical',
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }
}

// Log unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('[UNHANDLED REJECTION] Unhandled rejection at:', promise);
  console.error('[UNHANDLED REJECTION] Reason:', reason);
  process.exit(1);
});

// Log uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('[UNCAUGHT EXCEPTION] Uncaught exception:', error);
  console.error('[UNCAUGHT EXCEPTION] Stack:', error.stack);
  process.exit(1);
});

main();
