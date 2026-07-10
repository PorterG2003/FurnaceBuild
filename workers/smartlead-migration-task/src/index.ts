import { randomUUID } from 'node:crypto';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { reportErrorToSlack } from '@furnace/slack-lib';
import {
  migrateSingleSmartleadCampaign,
  type CampaignMigrationResult,
  type MigrationProgress,
  type SmartleadCampaign,
} from '@/lib/smartlead/migration';
import type { Database, Json } from '@/lib/supabase/types/database';

type DbClient = any;
type RunRow = Database['public']['Tables']['smartlead_migration_runs']['Row'];
type CampaignRow = Database['public']['Tables']['smartlead_migration_campaigns']['Row'];
type EventInsert = Database['public']['Tables']['smartlead_migration_events']['Insert'];
type RunUpdate = Database['public']['Tables']['smartlead_migration_runs']['Update'];
type CampaignUpdate = Database['public']['Tables']['smartlead_migration_campaigns']['Update'];
type ClaimedCampaignRow = Database['public']['Functions']['claim_next_smartlead_migration_campaign']['Returns'][number];

const HEARTBEAT_INTERVAL_MS = 10_000;

async function fetchSecureParameter(name: string, region: string): Promise<string> {
  const client = new SSMClient({ region });
  const response = await client.send(new GetParameterCommand({
    Name: name,
    WithDecryption: true,
  }));

  const value = response.Parameter?.Value?.trim();
  if (!value) {
    throw new Error(`Parameter ${name} has no value`);
  }
  return value;
}

function createSupabase(secretKey: string): DbClient {
  const supabaseUrl = process.env.SUPABASE_URL;
  if (!supabaseUrl) {
    throw new Error('Missing SUPABASE_URL');
  }

  return createClient<Database>(supabaseUrl, secretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }) as DbClient;
}

async function appendEvent(
  db: DbClient,
  run: RunRow,
  params: {
    campaignRowId?: string | null;
    eventType: string;
    level?: 'info' | 'warning' | 'error';
    phase?: RunRow['current_phase'];
    detail?: string | null;
    payload?: Record<string, unknown>;
  },
): Promise<void> {
  const eventRow: EventInsert = {
    run_id: run.id,
    campaign_row_id: params.campaignRowId ?? null,
    account_id: run.account_id,
    event_type: params.eventType,
    level: params.level ?? 'info',
    phase: params.phase ?? null,
    detail: params.detail ?? null,
    payload: (params.payload ?? {}) as Json,
  };

  const { error } = await ((db
    .from('smartlead_migration_events') as any)
    .insert(eventRow as any));

  if (error) {
    console.error('[smartlead-task] failed to append event', error.message);
  }
}

async function updateRun(
  db: DbClient,
  runId: string,
  updates: Partial<RunUpdate>,
): Promise<void> {
  const { error } = await ((db
    .from('smartlead_migration_runs') as any)
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    } as any)
    .eq('id', runId));

  if (error) {
    throw new Error(`Failed to update Smartlead migration run: ${error.message}`);
  }
}

async function updateCampaignRow(
  db: DbClient,
  rowId: string,
  updates: Partial<CampaignUpdate>,
): Promise<void> {
  const { error } = await ((db
    .from('smartlead_migration_campaigns') as any)
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    } as any)
    .eq('id', rowId));

  if (error) {
    throw new Error(`Failed to update Smartlead migration campaign row: ${error.message}`);
  }
}

async function getRun(db: DbClient, runId: string): Promise<RunRow> {
  const { data, error } = await ((db
    .from('smartlead_migration_runs')
    .select('*')
    .eq('id', runId)
    .single()) as any);

  if (error || !data) {
    throw new Error(`Failed to load Smartlead migration run: ${error?.message ?? 'not found'}`);
  }

  return data;
}

async function claimRun(db: DbClient, runId: string, workerId: string, taskArn: string | null): Promise<void> {
  const { data, error } = await (db.rpc('claim_smartlead_migration_run', {
    p_run_id: runId,
    p_worker_id: workerId,
    p_task_arn: taskArn,
    p_processing_timeout_minutes: 15,
  } as any) as any);

  if (error) {
    throw new Error(`Failed to claim Smartlead migration run: ${error.message}`);
  }

  if (data !== true) {
    throw new Error('Smartlead migration run is already claimed by another task.');
  }
}

async function claimNextCampaign(db: DbClient, runId: string, workerId: string): Promise<CampaignRow | null> {
  const { data: claimedRows, error } = await (db.rpc('claim_next_smartlead_migration_campaign', {
    p_run_id: runId,
    p_worker_id: workerId,
    p_processing_timeout_minutes: 15,
  } as any) as any);

  if (error) {
    throw new Error(`Failed to claim next Smartlead migration campaign: ${error.message}`);
  }

  const data = (claimedRows ?? []) as ClaimedCampaignRow[];
  if (data.length === 0) {
    return null;
  }

  const claimedId = data[0].id;
  const { data: campaignRow, error: rowError } = await ((db
    .from('smartlead_migration_campaigns')
    .select('*')
    .eq('id', claimedId)
    .single()) as any);

  if (rowError || !campaignRow) {
    throw new Error(`Failed to load claimed Smartlead migration campaign row: ${rowError?.message ?? 'not found'}`);
  }

  return campaignRow;
}

async function hasCancelRequested(db: DbClient, runId: string): Promise<boolean> {
  const { data: runState, error } = await ((db
    .from('smartlead_migration_runs')
    .select('status, cancel_requested_at')
    .eq('id', runId)
    .single()) as any);

  if (error) {
    throw new Error(`Failed to check Smartlead migration cancel state: ${error.message}`);
  }

  const data = runState as Pick<RunRow, 'status' | 'cancel_requested_at'>;
  return data.status === 'cancel_requested' || data.cancel_requested_at != null;
}

async function cancelQueuedCampaigns(db: DbClient, runId: string): Promise<void> {
  const { error } = await ((db
    .from('smartlead_migration_campaigns') as any)
    .update({
      status: 'cancelled',
      finished_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as any)
    .eq('run_id', runId)
    .eq('status', 'queued'));

  if (error) {
    throw new Error(`Failed to cancel remaining Smartlead migration campaigns: ${error.message}`);
  }
}

async function markRunFailedBeforeClaim(
  db: DbClient,
  run: RunRow,
  workerId: string,
  taskArn: string | null,
  message: string,
): Promise<void> {
  const finishedAt = new Date().toISOString();
  const { data, error } = await ((db
    .from('smartlead_migration_runs') as any)
    .update({
      status: 'failed_to_claim',
      worker_id: workerId,
      task_arn: taskArn,
      current_phase: 'done',
      current_detail: null,
      last_error_message: message,
      finished_at: finishedAt,
      updated_at: finishedAt,
    } as any)
    .eq('id', run.id)
    .is('started_at', null)
    .in('status', ['queued', 'launch_requested', 'task_started'])
    .select('id')
    .maybeSingle());

  if (error) {
    throw new Error(`Failed to mark Smartlead migration run as failed_to_claim: ${error.message}`);
  }

  if (!data) {
    return;
  }

  await appendEvent(db, run, {
    eventType: 'run_failed_to_claim',
    level: 'error',
    phase: 'done',
    detail: message,
    payload: {
      worker_id: workerId,
      task_arn: taskArn,
    },
  });
}

function mapCampaignRowToSmartleadCampaign(row: CampaignRow): SmartleadCampaign {
  return {
    id: row.smartlead_campaign_id,
    name: row.campaign_name,
    created_at: row.smartlead_created_at ?? undefined,
  };
}

async function syncAggregates(db: DbClient, runId: string): Promise<{
  succeeded: number;
  failed: number;
  leadsImported: number;
  conversationsImported: number;
  totalsStatsCount: number;
  dayByDayStatsCount: number;
}> {
  const { data: aggregateRows, error } = await ((db
    .from('smartlead_migration_campaigns')
    .select('status, leads_imported, conversations_imported, totals_stats_imported, day_by_day_stats_imported')
    .eq('run_id', runId)) as any);

  if (error) {
    throw new Error(`Failed to sync Smartlead migration aggregates: ${error.message}`);
  }

  const rows = (aggregateRows ?? []) as Array<
    Pick<
      CampaignRow,
      'status' | 'leads_imported' | 'conversations_imported' | 'totals_stats_imported' | 'day_by_day_stats_imported'
    >
  >;
  return rows.reduce(
    (acc, row) => {
      if (row.status === 'succeeded') acc.succeeded += 1;
      if (row.status === 'failed') acc.failed += 1;
      acc.leadsImported += row.leads_imported ?? 0;
      acc.conversationsImported += row.conversations_imported ?? 0;
      if (row.totals_stats_imported) acc.totalsStatsCount += 1;
      if (row.day_by_day_stats_imported) acc.dayByDayStatsCount += 1;
      return acc;
    },
    {
      succeeded: 0,
      failed: 0,
      leadsImported: 0,
      conversationsImported: 0,
      totalsStatsCount: 0,
      dayByDayStatsCount: 0,
    },
  );
}

async function finalizeRun(db: DbClient, run: RunRow, cancelled: boolean): Promise<void> {
  const aggregates = await syncAggregates(db, run.id);
  const status: RunRow['status'] = cancelled
    ? 'cancelled'
    : aggregates.failed > 0
      ? 'completed_with_warnings'
      : 'completed';

  await updateRun(db, run.id, {
    status,
    completed_campaign_count: aggregates.succeeded,
    failed_campaign_count: aggregates.failed,
    leads_imported: aggregates.leadsImported,
    conversations_imported: aggregates.conversationsImported,
    totals_stats_campaign_count: aggregates.totalsStatsCount,
    day_by_day_stats_campaign_count: aggregates.dayByDayStatsCount,
    current_phase: 'done',
    current_detail: cancelled ? 'Migration cancelled.' : 'Migration finished.',
    current_campaign_id: null,
    current_campaign_name: null,
    finished_at: new Date().toISOString(),
    last_heartbeat_at: new Date().toISOString(),
  });

  await appendEvent(db, run, {
    eventType: cancelled ? 'run_cancelled' : 'run_completed',
    level: cancelled ? 'warning' : 'info',
    phase: 'done',
    detail: cancelled ? 'Migration cancelled.' : 'Migration finished.',
    payload: {
      completed_campaign_count: aggregates.succeeded,
      failed_campaign_count: aggregates.failed,
      leads_imported: aggregates.leadsImported,
      conversations_imported: aggregates.conversationsImported,
      totals_stats_campaign_count: aggregates.totalsStatsCount,
      day_by_day_stats_campaign_count: aggregates.dayByDayStatsCount,
    },
  });
}

async function processCampaign(
  db: DbClient,
  run: RunRow,
  row: CampaignRow,
  apiKey: string,
  ownerId: string,
  totalCampaigns: number,
  seenMessageIds: Set<string>,
): Promise<CampaignMigrationResult> {
  await updateRun(db, run.id, {
    current_campaign_id: row.smartlead_campaign_id,
    current_campaign_name: row.campaign_name,
    current_phase: 'campaign',
    current_detail: 'Starting campaign import...',
    last_heartbeat_at: new Date().toISOString(),
  });

  await appendEvent(db, run, {
    campaignRowId: row.id,
    eventType: 'campaign_started',
    phase: 'campaign',
    detail: `Starting ${row.campaign_name}.`,
    payload: {
      smartlead_campaign_id: row.smartlead_campaign_id,
      order_index: row.order_index,
      attempt_count: row.attempt_count,
    },
  });

  return migrateSingleSmartleadCampaign({
    apiKey,
    campaign: mapCampaignRowToSmartleadCampaign(row),
    accountId: run.account_id,
    ownerId,
    campaignIndex: row.order_index,
    campaignCount: totalCampaigns,
    db,
    seenMessageIds,
    onProgress: (progress: MigrationProgress) => {
      void (async () => {
        const heartbeatAt = new Date().toISOString();
        await updateRun(db, run.id, {
          current_campaign_id: row.smartlead_campaign_id,
          current_campaign_name: row.campaign_name,
          current_phase: progress.phase,
          current_detail: progress.detail ?? null,
          last_heartbeat_at: heartbeatAt,
        });
        await updateCampaignRow(db, row.id, {
          last_phase: progress.phase === 'done' ? 'done' : progress.phase,
          current_detail: progress.detail ?? null,
          last_heartbeat_at: heartbeatAt,
        });

        if (progress.detail) {
          await appendEvent(db, run, {
            campaignRowId: row.id,
            eventType: 'phase_progress',
            phase: progress.phase === 'done' ? 'done' : progress.phase,
            detail: progress.detail,
            payload: {
              lead_count: progress.leadCount ?? null,
              lead_index: progress.leadIndex ?? null,
            },
          });
        }
      })().catch((error) => {
        console.error('[smartlead-task] failed to persist progress', error);
      });
    },
  });
}

async function runTask(): Promise<void> {
  const runId = process.env.SMARTLEAD_MIGRATION_RUN_ID;
  const taskArn = process.env.SMARTLEAD_MIGRATION_TASK_ARN ?? null;
  const apiKeyParamPath = process.env.SMARTLEAD_API_KEY_PARAM_PATH;
  const region = process.env.AWS_REGION || 'us-west-2';
  const supabaseSecretParamPath = process.env.SUPABASE_SECRET_KEY_PARAM_PATH;
  const directSecret = process.env.SUPABASE_SECRET_KEY;

  if (!runId) throw new Error('Missing SMARTLEAD_MIGRATION_RUN_ID');
  if (!apiKeyParamPath) throw new Error('Missing SMARTLEAD_API_KEY_PARAM_PATH');

  const supabaseSecret = directSecret ?? (supabaseSecretParamPath
    ? await fetchSecureParameter(supabaseSecretParamPath, region)
    : null);

  if (!supabaseSecret) throw new Error('Missing SUPABASE_SECRET_KEY or SUPABASE_SECRET_KEY_PARAM_PATH');

  const smartleadApiKey = await fetchSecureParameter(apiKeyParamPath, region);
  const workerId = process.env.SMARTLEAD_MIGRATION_WORKER_ID ?? randomUUID();
  const db = createSupabase(supabaseSecret);
  let run: RunRow | null = null;
  let claimed = false;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let cancelled = false;

  try {
    run = await getRun(db, runId);

    await claimRun(db, runId, workerId, taskArn);
    claimed = true;
    run = await getRun(db, runId);
    const ownerId = run.created_by;

    await appendEvent(db, run, {
      eventType: 'run_started',
      phase: 'campaign',
      detail: 'Worker claimed the run and started processing.',
      payload: {
        worker_id: workerId,
        task_arn: taskArn,
      },
    });

    heartbeatTimer = setInterval(() => {
      updateRun(db, runId, {
        last_heartbeat_at: new Date().toISOString(),
      }).catch((error) => {
        console.error('[smartlead-task] failed to write heartbeat', error);
      });
    }, HEARTBEAT_INTERVAL_MS);

    const seenMessageIds = new Set<string>();

    while (true) {
      if (await hasCancelRequested(db, runId)) {
        cancelled = true;
        break;
      }

      const campaignRow = await claimNextCampaign(db, runId, workerId);
      if (!campaignRow) {
        break;
      }

      const result = await processCampaign(
        db,
        run,
        campaignRow,
        smartleadApiKey,
        ownerId,
        run.selected_campaign_count,
        seenMessageIds,
      );

      if (result.status === 'succeeded') {
        await updateCampaignRow(db, campaignRow.id, {
          status: 'succeeded',
          furnace_campaign_id: result.campaignId ?? null,
          last_phase: 'done',
          current_detail: null,
          leads_imported: result.leadsImported ?? 0,
          conversations_imported: result.conversationsImported ?? 0,
          totals_stats_imported: result.totalsStatsImported ?? false,
          day_by_day_stats_imported: result.dayByDayStatsImported ?? false,
          replied_from_api: result.conversationDiagnostics?.repliedFromApi ?? 0,
          leads_matched: result.conversationDiagnostics?.leadsMatched ?? 0,
          skipped_no_match: result.conversationDiagnostics?.skippedNoMatch ?? 0,
          skipped_empty_history: result.conversationDiagnostics?.skippedEmptyHistory ?? 0,
          finished_at: new Date().toISOString(),
          last_error_message: null,
          last_heartbeat_at: new Date().toISOString(),
        });

        await appendEvent(db, run, {
          campaignRowId: campaignRow.id,
          eventType: 'campaign_succeeded',
          phase: 'done',
          detail: `${campaignRow.campaign_name} imported successfully.`,
          payload: {
            furnace_campaign_id: result.campaignId ?? null,
            leads_imported: result.leadsImported ?? 0,
            conversations_imported: result.conversationsImported ?? 0,
            totals_stats_imported: result.totalsStatsImported ?? false,
            day_by_day_stats_imported: result.dayByDayStatsImported ?? false,
            conversation_diagnostics: result.conversationDiagnostics ?? null,
          },
        });
      } else {
        await updateCampaignRow(db, campaignRow.id, {
          status: 'failed',
          last_phase: 'done',
          current_detail: null,
          last_error_message: result.error ?? 'Migration failed.',
          finished_at: new Date().toISOString(),
          last_heartbeat_at: new Date().toISOString(),
        });

        await appendEvent(db, run, {
          campaignRowId: campaignRow.id,
          eventType: 'campaign_failed',
          level: 'error',
          phase: 'done',
          detail: result.error ?? 'Migration failed.',
          payload: {
            campaign_name: campaignRow.campaign_name,
          },
        });
      }

      const aggregates = await syncAggregates(db, runId);
      await updateRun(db, runId, {
        completed_campaign_count: aggregates.succeeded,
        failed_campaign_count: aggregates.failed,
        leads_imported: aggregates.leadsImported,
        conversations_imported: aggregates.conversationsImported,
        totals_stats_campaign_count: aggregates.totalsStatsCount,
        day_by_day_stats_campaign_count: aggregates.dayByDayStatsCount,
        current_phase: 'campaign',
        current_detail: 'Preparing next campaign...',
        last_heartbeat_at: new Date().toISOString(),
      });
    }

    if (cancelled) {
      await cancelQueuedCampaigns(db, runId);
    }

    await finalizeRun(db, run, cancelled);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (run && !claimed) {
      await markRunFailedBeforeClaim(db, run, workerId, taskArn, message);
    } else if (run) {
      await updateRun(db, runId, {
        status: 'failed',
        current_phase: 'done',
        current_detail: null,
        last_error_message: message,
        finished_at: new Date().toISOString(),
        last_heartbeat_at: new Date().toISOString(),
      });

      await appendEvent(db, run, {
        eventType: 'run_failed',
        level: 'error',
        phase: 'done',
        detail: message,
      });
    }

    reportErrorToSlack('Smartlead migration task failed', {
      severity: 'critical',
      run_id: runId,
      error: message,
    });
    throw error;
  } finally {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
    }
  }
}

runTask().catch((error) => {
  console.error('[smartlead-task] fatal error', error);
  process.exit(1);
});
