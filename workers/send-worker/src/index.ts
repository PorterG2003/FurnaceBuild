import { createSupabaseClient } from './supabase.js';
import { DatabaseClient } from './database.js';
import { SendWorker } from './worker.js';
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
    return response.Parameter.Value;
  } catch (error) {
    throw new Error(`Failed to fetch secret from Parameter Store: ${error}`);
  }
}

/**
 * Main entry point for send worker
 * 
 * Environment variables required:
 * - SUPABASE_URL: Supabase project URL
 * - SUPABASE_SERVICE_KEY: Service role key (or SUPABASE_SERVICE_KEY_PARAM_PATH to fetch from Parameter Store)
 * - AWS_REGION: AWS region (defaults to us-west-2)
 */
async function main() {
  try {
    // Validate environment variables
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKeyParamPath = process.env.SUPABASE_SERVICE_KEY_PARAM_PATH;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
    const awsRegion = process.env.AWS_REGION || 'us-west-2';

    if (!supabaseUrl) {
      throw new Error('Missing required environment variable: SUPABASE_URL');
    }

    // Fetch SUPABASE_SERVICE_KEY from Parameter Store if path is provided
    let serviceKey = supabaseServiceKey;
    if (supabaseServiceKeyParamPath && !serviceKey) {
      console.log(`Fetching SUPABASE_SERVICE_KEY from Parameter Store: ${supabaseServiceKeyParamPath}`);
      serviceKey = await fetchSecretFromParameterStore(supabaseServiceKeyParamPath, awsRegion);
      // Set it as an environment variable for the Supabase client
      process.env.SUPABASE_SERVICE_KEY = serviceKey;
    }

    if (!serviceKey) {
      throw new Error(
        'Missing SUPABASE_SERVICE_KEY. Provide either SUPABASE_SERVICE_KEY or SUPABASE_SERVICE_KEY_PARAM_PATH'
      );
    }

    console.log('Initializing send worker...');
    console.log(`AWS Region: ${awsRegion}`);

    // Initialize clients
    const supabase = createSupabaseClient();
    const databaseClient = new DatabaseClient({
      supabase,
      batchSize: 100,
      pollIntervalMs: 2000, // Start with 2 seconds (adaptive polling in worker)
    });

    // Create and start worker
    const worker = new SendWorker({
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
    process.exit(1);
  }
}

main();

