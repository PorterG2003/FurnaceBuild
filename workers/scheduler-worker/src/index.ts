import 'dotenv/config';
import { createSupabaseClient } from './supabase.js';
import { DatabaseClient } from './database.js';
import { SchedulerWorker } from './worker.js';
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
 * Main entry point for scheduler worker
 * 
 * Environment variables required:
 * - SUPABASE_URL: Supabase project URL
 * - SUPABASE_SECRET_KEY: Supabase Secret Key (or SUPABASE_SECRET_KEY_PARAM_PATH to fetch from Parameter Store)
 * - AWS_REGION: AWS region (defaults to us-west-2)
 *
 * Optional (for local dev, set in workers/scheduler-worker/.env):
 * - SLACK_ERROR_WEBHOOK_URL: Incoming Webhook URL for error reporting to Slack
 * - OPENROUTER_API_KEY (or OPENROUTER_API_KEY_PARAM_PATH): categorizer AI classification
 * - OPENROUTER_CATEGORIZER_MODEL: model override (default google/gemini-2.5-flash-lite)
 */
async function main() {
  try {
    // Validate environment variables
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseSecretKeyParamPath = process.env.SUPABASE_SECRET_KEY_PARAM_PATH;
    const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
    const awsRegion = process.env.AWS_REGION || 'us-west-2';

    const envDiag = {
      hasSupabaseUrl: !!supabaseUrl,
      hasParamPath: !!supabaseSecretKeyParamPath,
      paramPathValue: supabaseSecretKeyParamPath ?? '<unset>',
      hasSecretKeyDirect: !!supabaseSecretKey,
      awsRegion,
    };
    console.log('[scheduler-worker env]', JSON.stringify(envDiag));

    if (!supabaseUrl) {
      throw new Error('Missing required environment variable: SUPABASE_URL');
    }

    // Fetch SUPABASE_SECRET_KEY from Parameter Store if path is provided
    let secretKey = supabaseSecretKey;
    if (supabaseSecretKeyParamPath && !secretKey) {
      console.log(`Fetching SUPABASE_SECRET_KEY from Parameter Store: ${supabaseSecretKeyParamPath}`);
      try {
        secretKey = await fetchSecretFromParameterStore(supabaseSecretKeyParamPath, awsRegion);
        process.env.SUPABASE_SECRET_KEY = secretKey;
        console.log('[scheduler-worker] SSM fetch succeeded');
      } catch (fetchErr) {
        const errMsg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
        console.log('[scheduler-worker] SSM fetch failed:', errMsg);
        throw fetchErr;
      }
    } else {
      console.log('[scheduler-worker] Skipping SSM fetch (paramPath?', !!supabaseSecretKeyParamPath, 'secretKey?', !!secretKey, ')');
    }

    if (!secretKey) {
      throw new Error(
        'Missing SUPABASE_SECRET_KEY. Provide either SUPABASE_SECRET_KEY or SUPABASE_SECRET_KEY_PARAM_PATH'
      );
    }

    // OpenRouter key for the categorizer node (AI reply classification).
    // Non-fatal: without it, AI categorizer nodes defer-retry and alert
    // instead of classifying; everything else runs normally.
    const openRouterApiKeyParamPath = process.env.OPENROUTER_API_KEY_PARAM_PATH;
    if (openRouterApiKeyParamPath && !process.env.OPENROUTER_API_KEY) {
      try {
        process.env.OPENROUTER_API_KEY = await fetchSecretFromParameterStore(
          openRouterApiKeyParamPath,
          awsRegion
        );
        console.log('[scheduler-worker] OPENROUTER_API_KEY fetched from Parameter Store');
      } catch (fetchErr) {
        const errMsg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
        console.error('[scheduler-worker] OPENROUTER_API_KEY SSM fetch failed (AI categorizer disabled):', errMsg);
      }
    } else {
      console.log(
        '[scheduler-worker] OpenRouter key:',
        process.env.OPENROUTER_API_KEY ? 'set via env' : openRouterApiKeyParamPath ? 'param path set' : 'not configured'
      );
    }

    console.log('Initializing scheduler worker...');
    console.log(`AWS Region: ${awsRegion}`);

    // Initialize clients
    const supabase = createSupabaseClient();
    const databaseClient = new DatabaseClient({
      supabase,
      batchSize: 100,
      pollIntervalMs: 5000, // Poll every 5 seconds
    });

    // Create and start worker
    const worker = new SchedulerWorker({
      supabase,
      databaseClient,
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
    console.error('Fatal error:', error);
    const { reportErrorToSlack } = await import('@furnace/slack-lib');
    reportErrorToSlack('Scheduler worker fatal error', {
      severity: 'critical',
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }
}

main();

