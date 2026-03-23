import {
  DescribeTasksCommand,
  ECSClient,
  RunTaskCommand,
  StopTaskCommand,
} from '@aws-sdk/client-ecs';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  deriveTargetStateForCompany,
  reconcileCompanyToStateEntity,
  runMockStateRunner,
} from '@furnace/registry-server';

let cachedClient: SupabaseClient | null = null;

function getLeadsClient(): SupabaseClient {
  if (cachedClient) return cachedClient;
  const url = process.env.LEADS_SUPABASE_URL;
  const key = process.env.LEADS_SUPABASE_SECRET_KEY;
  if (!url?.trim() || !key?.trim()) {
    throw new Error('Missing LEADS_SUPABASE_URL or LEADS_SUPABASE_SECRET_KEY');
  }
  cachedClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedClient;
}

type ProcessMockEvent = {
  action: 'processMock';
  jobId: string;
  reconciliationRunId: string;
};

type FinalizeEvent = { action: 'finalize'; jobId: string; reconciliationRunId: string };
type FailEvent = { action: 'fail'; jobId: string; reconciliationRunId: string; message?: string };

type RunUtahEcsEvent = { action: 'runUtahEcs'; jobId: string; reconciliationRunId: string };

const ecsClient = new ECSClient({});
const ssmClient = new SSMClient({});

let cachedUtahTaskDefinitionArn: string | undefined;

async function getUtahTaskDefinitionArnFromSsm(): Promise<string> {
  if (cachedUtahTaskDefinitionArn) return cachedUtahTaskDefinitionArn;
  const paramName = process.env.UTAH_ECS_TASK_DEFINITION_PARAM?.trim();
  if (!paramName) {
    throw new Error('Missing UTAH_ECS_TASK_DEFINITION_PARAM');
  }
  const out = await ssmClient.send(new GetParameterCommand({ Name: paramName }));
  const arn = out.Parameter?.Value?.trim();
  if (!arn) {
    throw new Error(`SSM parameter empty or missing: ${paramName}`);
  }
  cachedUtahTaskDefinitionArn = arn;
  return arn;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function runUtahEcsAndWait(jobId: string, reconciliationRunId: string): Promise<void> {
  const cluster = process.env.UTAH_ECS_CLUSTER?.trim();
  const taskDefinition = await getUtahTaskDefinitionArnFromSsm();
  const subnetIds = (process.env.UTAH_ECS_SUBNET_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const securityGroupId = process.env.UTAH_ECS_SECURITY_GROUP_ID?.trim();
  const executionRoleArn = process.env.UTAH_ECS_EXECUTION_ROLE_ARN?.trim();
  const taskRoleArn = process.env.UTAH_ECS_TASK_ROLE_ARN?.trim();

  if (
    !cluster ||
    !taskDefinition ||
    subnetIds.length === 0 ||
    !securityGroupId ||
    !executionRoleArn ||
    !taskRoleArn
  ) {
    throw new Error('Utah ECS is not configured (missing UTAH_ECS_* env on state-matching Lambda)');
  }

  const out = await ecsClient.send(
    new RunTaskCommand({
      cluster,
      taskDefinition,
      launchType: 'FARGATE',
      platformVersion: 'LATEST',
      startedBy: `foundry-state-matching:${jobId}`,
      networkConfiguration: {
        awsvpcConfiguration: {
          subnets: subnetIds,
          securityGroups: [securityGroupId],
          assignPublicIp: 'ENABLED',
        },
      },
      overrides: {
        taskRoleArn,
        executionRoleArn,
        containerOverrides: [
          {
            name: 'utah-scraper',
            command: ['sh', '-c', 'npx tsx src/run-reconciliation.ts'],
            environment: [
              { name: 'RUN_MODE', value: 'reconciliation' },
              { name: 'JOB_ID', value: jobId },
              { name: 'RECONCILIATION_RUN_ID', value: reconciliationRunId },
            ],
          },
        ],
      },
    }),
  );

  const taskArn = out.tasks?.[0]?.taskArn;
  if (!taskArn) {
    throw new Error(out.failures?.map((f) => f.reason).join('; ') || 'RunTask returned no task');
  }

  const deadline = Date.now() + 55 * 60 * 1000;
  while (Date.now() < deadline) {
    const d = await ecsClient.send(
      new DescribeTasksCommand({
        cluster,
        tasks: [taskArn],
      }),
    );
    const t = d.tasks?.[0];
    const status = t?.lastStatus;
    if (status === 'STOPPED') {
      const exit = t?.containers?.[0]?.exitCode;
      if (exit !== 0 && exit != null) {
        const reason = t?.stoppedReason ?? 'unknown';
        throw new Error(`Utah ECS task exited with code ${exit}: ${reason}`);
      }
      return;
    }
    await sleep(8000);
  }

  await ecsClient.send(
    new StopTaskCommand({
      cluster,
      task: taskArn,
      reason: 'Foundry state matching Lambda timeout waiting for Utah task',
    }),
  );
  throw new Error('Timeout waiting for Utah ECS task');
}

export const handler = async (
  event: ProcessMockEvent | FinalizeEvent | FailEvent | RunUtahEcsEvent,
): Promise<Record<string, unknown>> => {
  if ('action' in event && event.action === 'runUtahEcs') {
    await runUtahEcsAndWait(event.jobId, event.reconciliationRunId);
    return { ok: true };
  }

  if ('action' in event && event.action === 'finalize') {
    const client = getLeadsClient();
    const { data: job } = await client.from('foundry_jobs').select('payload, progress').eq('id', event.jobId).maybeSingle();
    const prev = (job?.progress ?? {}) as Record<string, unknown>;
    const payload = (job?.payload ?? {}) as Record<string, unknown>;

    await client
      .from('foundry_jobs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        progress: { ...prev, current_step: 'done' },
      })
      .eq('id', event.jobId);

    await client
      .from('reconciliation_runs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        meta: {
          run_kind: 'state_matching_orchestration',
          ...(typeof payload.preflight === 'object' && payload.preflight ? { preflight: payload.preflight } : {}),
          async: true,
          job_id: event.jobId,
          mock_per_company: prev.mock_per_company,
          utah_per_company: prev.utah_per_company,
        },
      })
      .eq('id', event.reconciliationRunId);

    return { ok: true };
  }

  if ('action' in event && event.action === 'fail') {
    const client = getLeadsClient();
    const msg =
      typeof event.message === 'string' && event.message.trim()
        ? event.message.trim()
        : 'Step Functions failure';
    await client
      .from('foundry_jobs')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        error_summary: msg,
      })
      .eq('id', event.jobId);
    await client
      .from('reconciliation_runs')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        meta: { run_kind: 'state_matching_orchestration', error: msg, job_id: event.jobId },
      })
      .eq('id', event.reconciliationRunId);
    return { ok: true };
  }

  const e = event as ProcessMockEvent;
  const client = getLeadsClient();
  const { data: jobRow } = await client.from('foundry_jobs').select('payload').eq('id', e.jobId).maybeSingle();
  const jobPayload = (jobRow?.payload ?? {}) as { mock_company_ids?: string[] };
  const mockCompanyIds = jobPayload.mock_company_ids ?? [];
  const perCompany: Record<string, unknown>[] = [];

  for (const companyId of mockCompanyIds) {
    const state = await deriveTargetStateForCompany(client, companyId);
    if (!state) continue;
    try {
      const { state_entity_id } = await runMockStateRunner(client, { companyId, targetState: state });
      const recon = await reconcileCompanyToStateEntity(client, {
        reconciliationRunId: e.reconciliationRunId,
        companyId,
        stateEntityId: state_entity_id,
      });
      perCompany.push({ companyId, state, state_entity_id, ...recon });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      perCompany.push({ companyId, error: message });
      await client.from('reconciliation_results').insert({
        reconciliation_run_id: e.reconciliationRunId,
        company_id: companyId,
        outcome: 'error',
        details: { message },
        matcher_version: 'foundry_matcher_v1',
        scoring_version: 'foundry_score_v1',
        ruleset_version: 'foundry_rules_v1',
      });
    }
  }

  const { data: job } = await client.from('foundry_jobs').select('progress').eq('id', e.jobId).maybeSingle();
  const prev = (job?.progress ?? {}) as Record<string, unknown>;
  await client
    .from('foundry_jobs')
    .update({
      status: 'running',
      progress: {
        ...prev,
        current_step: 'mock_batch_done',
        mock_per_company: perCompany,
      },
    })
    .eq('id', e.jobId);

  return { ok: true, mockProcessed: perCompany.length };
};
