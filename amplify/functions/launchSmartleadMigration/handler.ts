import { randomUUID } from 'node:crypto';
import { ECSClient, RunTaskCommand } from '@aws-sdk/client-ecs';
import { SSMClient, GetParameterCommand, PutParameterCommand } from '@aws-sdk/client-ssm';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { reportErrorToSlack } from '@furnace/slack-lib';

function isFunctionUrlEvent(
  event: unknown,
): event is { headers: Record<string, string>; body?: string | null; isBase64Encoded?: boolean } {
  return !!event && typeof event === 'object' && 'headers' in event;
}

interface LaunchPayload {
  runId: string;
  accountId: string;
  apiKey?: string;
  action?: 'launch' | 'resume';
}

async function verifyUser(token: string) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseSecretKey) {
    throw new Error('Server configuration error');
  }

  const supabase = createClient(supabaseUrl, supabaseSecretKey);
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);

  if (error || !user) {
    throw new Error('Invalid or expired token');
  }

  return { supabase, user };
}

function getParameterPath(environment: string, runId: string): string {
  return `/furnace/smartlead-migrations/${environment}/${runId}/api-key`;
}

export const handler = async (
  event: { headers: Record<string, string>; body?: string | null; isBase64Encoded?: boolean },
) => {
  let launchSupabase: SupabaseClient | null = null;
  let launchPayload: LaunchPayload | null = null;
  if (!isFunctionUrlEvent(event)) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Unsupported invocation type' }),
    };
  }

  try {
    const auth = event.headers.authorization || event.headers.Authorization;
    const token = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : null;
    if (!token) {
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'Missing or invalid Authorization header' }),
      };
    }

    const { supabase, user } = await verifyUser(token);
    launchSupabase = supabase;
    const rawBody = event.body
      ? event.isBase64Encoded
        ? Buffer.from(event.body, 'base64').toString()
        : event.body
      : '{}';
    const payload = JSON.parse(rawBody) as LaunchPayload;
    launchPayload = payload;

    if (!payload.runId || !payload.accountId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'runId and accountId are required' }),
      };
    }

    const environment = process.env.WORKER_ENVIRONMENT || process.env.ENVIRONMENT || 'dev';
    const cluster = process.env.SMARTLEAD_MIGRATION_CLUSTER;
    const taskDefinition = process.env.SMARTLEAD_MIGRATION_TASK_DEFINITION;
    const subnetIds = (process.env.SMARTLEAD_MIGRATION_SUBNET_IDS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    const securityGroupId = process.env.SMARTLEAD_MIGRATION_SECURITY_GROUP_ID;
    const region = process.env.AWS_REGION || 'us-west-2';

    if (!cluster || !taskDefinition || subnetIds.length === 0 || !securityGroupId) {
      throw new Error('Smartlead migration task infrastructure is not configured');
    }

    const { data: membership, error: membershipError } = await supabase
      .from('account_users')
      .select('account_id')
      .eq('account_id', payload.accountId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (membershipError || !membership) {
      return {
        statusCode: 403,
        body: JSON.stringify({ error: 'Account not found or access denied' }),
      };
    }

    const { data: run, error: runError } = await supabase
      .from('smartlead_migration_runs')
      .select('id, account_id, status, api_key_secret_ref, last_heartbeat_at')
      .eq('id', payload.runId)
      .eq('account_id', payload.accountId)
      .maybeSingle();

    if (runError || !run) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Migration run not found' }),
      };
    }

    if (run.status === 'running' && run.last_heartbeat_at) {
      const heartbeatAgeMs = Date.now() - new Date(run.last_heartbeat_at).getTime();
      if (heartbeatAgeMs < 5 * 60 * 1000) {
        return {
          statusCode: 409,
          body: JSON.stringify({ error: 'Migration is already running' }),
        };
      }
    }

    let apiKeySecretRef = run.api_key_secret_ref;
    const ssm = new SSMClient({ region });

    if (payload.apiKey?.trim()) {
      apiKeySecretRef = getParameterPath(environment, payload.runId);
      await ssm.send(new PutParameterCommand({
        Name: apiKeySecretRef,
        Type: 'SecureString',
        Value: payload.apiKey.trim(),
        Overwrite: true,
      }));
    } else if (!apiKeySecretRef) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'apiKey is required to launch this migration' }),
      };
    } else {
      await ssm.send(new GetParameterCommand({
        Name: apiKeySecretRef,
        WithDecryption: true,
      }));
    }

    await supabase
      .from('smartlead_migration_runs')
      .update({
        status: 'launching',
        api_key_secret_ref: apiKeySecretRef,
        launched_at: new Date().toISOString(),
        last_error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', payload.runId);

    const workerId = randomUUID();
    const ecs = new ECSClient({ region });
    const response = await ecs.send(new RunTaskCommand({
      cluster,
      taskDefinition,
      launchType: 'FARGATE',
      startedBy: `smartlead-migration:${payload.runId}`,
      platformVersion: 'LATEST',
      networkConfiguration: {
        awsvpcConfiguration: {
          subnets: subnetIds,
          securityGroups: [securityGroupId],
          assignPublicIp: 'ENABLED',
        },
      },
      overrides: {
        containerOverrides: [
          {
            name: 'smartlead-migration-task',
            environment: [
              { name: 'SMARTLEAD_MIGRATION_RUN_ID', value: payload.runId },
              { name: 'SMARTLEAD_API_KEY_PARAM_PATH', value: apiKeySecretRef },
              { name: 'SMARTLEAD_MIGRATION_WORKER_ID', value: workerId },
            ],
          },
        ],
      },
    }));

    const taskArn = response.tasks?.[0]?.taskArn;
    if (!taskArn) {
      const failure = response.failures?.[0];
      throw new Error(failure?.reason || 'ECS task launch failed');
    }

    await supabase
      .from('smartlead_migration_runs')
      .update({
        status: 'launching',
        task_arn: taskArn,
        worker_id: workerId,
        launched_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', payload.runId);

    await supabase
      .from('smartlead_migration_events')
      .insert({
        run_id: payload.runId,
        account_id: payload.accountId,
        event_type: payload.action === 'resume' ? 'run_resumed' : 'run_launched',
        level: 'info',
        detail: payload.action === 'resume'
          ? 'Migration task resumed.'
          : 'Migration task launched.',
        payload: {
          task_arn: taskArn,
          worker_id: workerId,
        },
      });

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        runId: payload.runId,
        taskArn,
      }),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('launchSmartleadMigration error:', error);
    if (launchSupabase && launchPayload?.runId) {
      await launchSupabase
        .from('smartlead_migration_runs')
        .update({
          status: 'failed',
          last_error_message: message,
          finished_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', launchPayload.runId);
    }
    reportErrorToSlack('Failed to launch Smartlead migration task', {
      severity: 'critical',
      error: message,
    });

    return {
      statusCode: 500,
      body: JSON.stringify({ error: message }),
    };
  }
};
