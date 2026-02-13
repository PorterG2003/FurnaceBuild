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
 */
async function main() {
  try {
    // Validate environment variables
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseSecretKeyParamPath = process.env.SUPABASE_SECRET_KEY_PARAM_PATH;
    const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
    const awsRegion = process.env.AWS_REGION || 'us-west-2';

    // #region agent log
    const envDiag = {
      hasSupabaseUrl: !!supabaseUrl,
      hasParamPath: !!supabaseSecretKeyParamPath,
      paramPathValue: supabaseSecretKeyParamPath ?? '<unset>',
      hasSecretKeyDirect: !!supabaseSecretKey,
      awsRegion,
    };
    console.log('[scheduler-worker env]', JSON.stringify(envDiag));
    fetch('http://127.0.0.1:7243/ingest/28828e28-f092-4c58-9db7-7686778cf427',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'scheduler-worker/index.ts:main',message:'env check',data:envDiag,timestamp:Date.now(),hypothesisId:'H1'})}).catch(()=>{});
    // #endregion

    if (!supabaseUrl) {
      throw new Error('Missing required environment variable: SUPABASE_URL');
    }

    // Fetch SUPABASE_SECRET_KEY from Parameter Store if path is provided
    let secretKey = supabaseSecretKey;
    if (supabaseSecretKeyParamPath && !secretKey) {
      console.log(`Fetching SUPABASE_SECRET_KEY from Parameter Store: ${supabaseSecretKeyParamPath}`);
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/28828e28-f092-4c58-9db7-7686778cf427',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'scheduler-worker/index.ts:before-ssm',message:'attempting SSM fetch',data:{paramPath:supabaseSecretKeyParamPath,region:awsRegion},timestamp:Date.now(),hypothesisId:'H2'})}).catch(()=>{});
      // #endregion
      try {
        secretKey = await fetchSecretFromParameterStore(supabaseSecretKeyParamPath, awsRegion);
        process.env.SUPABASE_SECRET_KEY = secretKey;
        // #region agent log
        console.log('[scheduler-worker] SSM fetch succeeded');
        fetch('http://127.0.0.1:7243/ingest/28828e28-f092-4c58-9db7-7686778cf427',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'scheduler-worker/index.ts:after-ssm',message:'SSM fetch succeeded',data:{hasSecret:!!secretKey},timestamp:Date.now(),hypothesisId:'H2'})}).catch(()=>{});
        // #endregion
      } catch (fetchErr) {
        // #region agent log
        const errMsg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
        console.log('[scheduler-worker] SSM fetch failed:', errMsg);
        fetch('http://127.0.0.1:7243/ingest/28828e28-f092-4c58-9db7-7686778cf427',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'scheduler-worker/index.ts:ssm-fetch-err',message:'SSM fetch failed',data:{error:errMsg},timestamp:Date.now(),hypothesisId:'H2'})}).catch(()=>{});
        // #endregion
        throw fetchErr;
      }
    } else {
      // #region agent log
      console.log('[scheduler-worker] Skipping SSM fetch (paramPath?', !!supabaseSecretKeyParamPath, 'secretKey?', !!secretKey, ')');
      fetch('http://127.0.0.1:7243/ingest/28828e28-f092-4c58-9db7-7686778cf427',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'scheduler-worker/index.ts:skip-ssm',message:'skipped SSM fetch',data:{hadParamPath:!!supabaseSecretKeyParamPath,hadSecretKey:!!secretKey},timestamp:Date.now(),hypothesisId:'H1'})}).catch(()=>{});
      // #endregion
    }

    if (!secretKey) {
      throw new Error(
        'Missing SUPABASE_SECRET_KEY. Provide either SUPABASE_SECRET_KEY or SUPABASE_SECRET_KEY_PARAM_PATH'
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
    process.exit(1);
  }
}

main();

