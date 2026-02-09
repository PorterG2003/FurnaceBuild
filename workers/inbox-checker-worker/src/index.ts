import { createSupabaseClient } from './supabase.js';
import { DatabaseClient } from './database.js';
import { InboxCheckerWorker } from './worker.js';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

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
 * - SUPABASE_URL: Supabase project URL
 * - SUPABASE_SECRET_KEY: Supabase Secret Key (or SUPABASE_SECRET_KEY_PARAM_PATH to fetch from Parameter Store)
 * - AWS_REGION: AWS region (defaults to us-west-2)
 */
async function main() {
  // Log immediately on startup to verify process is running
  console.log('[STARTUP] Inbox checker worker process starting...');
  console.log('[STARTUP] Node version:', process.version);
  console.log('[STARTUP] Working directory:', process.cwd());
  
  try {
    // Validate environment variables
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseSecretKeyParamPath = process.env.SUPABASE_SECRET_KEY_PARAM_PATH;
    const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
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
        'Missing SUPABASE_SECRET_KEY. Provide either SUPABASE_SECRET_KEY or SUPABASE_SECRET_KEY_PARAM_PATH'
      );
    }

    console.log('Initializing inbox checker worker...');
    console.log(`AWS Region: ${awsRegion}`);

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
    });

    // Handle graceful shutdown
    process.on('SIGTERM', () => {
      console.log('SIGTERM received, shutting down gracefully...');
      worker.stop();
      process.exit(0);
    });

    process.on('SIGINT', () => {
      console.log('SIGINT received, shutting down gracefully...');
      worker.stop();
      process.exit(0);
    });

    // Start worker (runs until stopped)
    await worker.start();

  } catch (error) {
    console.error('[FATAL ERROR] Inbox checker worker failed to start:', error);
    if (error instanceof Error) {
      console.error('[FATAL ERROR] Error message:', error.message);
      console.error('[FATAL ERROR] Stack trace:', error.stack);
    }
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
