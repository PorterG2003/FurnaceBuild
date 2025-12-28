import { createSupabaseClient } from './supabase';
import { QueueClient } from './queue';
import { SendWorker } from './worker';

/**
 * Main entry point for send worker
 * 
 * Environment variables required:
 * - SUPABASE_URL: Supabase project URL
 * - SUPABASE_SERVICE_KEY: Service role key
 * - SEND_QUEUE_URL: SQS queue URL
 * - AWS_REGION: AWS region (defaults to us-west-2)
 */
async function main() {
  try {
    // Validate environment variables
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
    const sendQueueUrl = process.env.SEND_QUEUE_URL;
    const awsRegion = process.env.AWS_REGION || 'us-west-2';

    if (!supabaseUrl || !supabaseServiceKey || !sendQueueUrl) {
      throw new Error(
        'Missing required environment variables: SUPABASE_URL, SUPABASE_SERVICE_KEY, or SEND_QUEUE_URL'
      );
    }

    console.log('Initializing send worker...');
    console.log(`Queue URL: ${sendQueueUrl}`);
    console.log(`AWS Region: ${awsRegion}`);

    // Initialize clients
    const supabase = createSupabaseClient();
    const queueClient = new QueueClient({
      queueUrl: sendQueueUrl,
      region: awsRegion,
      maxMessages: 10,
      waitTimeSeconds: 20, // Long polling
    });

    // Create and start worker
    const worker = new SendWorker({
      supabase,
      queueClient,
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

