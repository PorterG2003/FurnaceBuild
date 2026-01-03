import { SupabaseClient, createClient } from '@supabase/supabase-js';
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';

/**
 * Enrollment Metric Lambda Handler
 * 
 * This function runs periodically (triggered by EventBridge schedule)
 * to:
 * 1. Query Supabase for count of enrollments ready to process
 * 2. Publish custom CloudWatch metric for ECS auto-scaling
 */
export const handler = async (event: any) => {
  console.log('Enrollment Metric Lambda triggered:', JSON.stringify(event, null, 2));

  // Initialize clients
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
  const awsRegion = process.env.AWS_REGION || 'us-west-2';

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing required environment variables: EXPO_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_KEY');
  }

  if (!awsRegion) {
    throw new Error('AWS_REGION is not set in Lambda runtime environment');
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const cloudwatch = new CloudWatchClient({ region: awsRegion });

  try {
    // Query enrollment count (enrollments ready to process)
    const { count, error: countError } = await supabase
      .from('enrollments')
      .select('*', { count: 'exact', head: true })
      .eq('state', 'active')
      .lte('next_run_at', new Date().toISOString());

    if (countError) {
      console.error('Error querying enrollment count:', countError);
      throw countError;
    }

    const enrollmentCount = count || 0;
    console.log(`Enrollment count: ${enrollmentCount}`);

    // Publish custom CloudWatch metric
    await cloudwatch.send(new PutMetricDataCommand({
      Namespace: 'Furnace/Scheduler',
      MetricData: [
        {
          MetricName: 'EnrollmentsReadyToProcess',
          Value: enrollmentCount,
          Timestamp: new Date(),
          Unit: 'Count',
        },
      ],
    }));

    console.log(`Published metric: EnrollmentsReadyToProcess = ${enrollmentCount}`);

  } catch (error) {
    console.error('Fatal error in Enrollment Metric Lambda:', error);
    throw error;
  }
};

