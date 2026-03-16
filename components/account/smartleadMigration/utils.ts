import type {
  CampaignMigrationResult,
  ConversationImportDiagnostics,
  MigrationProgress,
} from '@/lib/smartlead/migration';
import type { SmartleadMigrationCampaign, SmartleadMigrationRun } from '@/lib/supabase/types';
import type { MigrationResultState } from './types';

/** Short reason why 0 conversations were imported (for UI). */
export function conversationZeroReason(d: ConversationImportDiagnostics | undefined): string | null {
  if (!d) return null;
  if (d.imported > 0) return null;
  if (d.repliedFromApi === 0) return 'no replies in Smartlead';
  if (d.leadsMatched === 0) return 'replies could not match to leads';
  if (d.skippedNoMatch > 0) return `${d.skippedNoMatch} no lead match`;
  if (d.skippedEmptyHistory > 0) return `${d.skippedEmptyHistory} empty history`;
  return null;
}

export function mapRunToProgress(run: SmartleadMigrationRun | null): MigrationProgress | null {
  if (!run?.current_phase) return null;
  return {
    campaignIndex: Math.max(0, run.completed_campaign_count + run.failed_campaign_count),
    campaignCount: run.selected_campaign_count,
    campaignName: run.current_campaign_name ?? '',
    phase: run.current_phase,
    detail: run.current_detail ?? undefined,
  };
}

export function mapCampaignRowToResult(row: SmartleadMigrationCampaign): CampaignMigrationResult {
  const diagnostics: ConversationImportDiagnostics | undefined = (
    row.replied_from_api > 0 ||
    row.leads_matched > 0 ||
    row.skipped_no_match > 0 ||
    row.skipped_empty_history > 0 ||
    row.conversations_imported > 0
  )
    ? {
        repliedFromApi: row.replied_from_api,
        leadsMatched: row.leads_matched,
        skippedNoMatch: row.skipped_no_match,
        skippedEmptyHistory: row.skipped_empty_history,
        imported: row.conversations_imported,
      }
    : undefined;

  return {
    campaignRowId: row.id,
    campaignId: row.furnace_campaign_id ?? undefined,
    campaignName: row.campaign_name,
    status: row.status === 'succeeded' ? 'succeeded' : 'failed',
    error: row.last_error_message ?? (row.status === 'cancelled' ? 'Migration cancelled.' : undefined),
    leadsImported: row.leads_imported,
    conversationsImported: row.conversations_imported,
    conversationDiagnostics: diagnostics,
    totalsStatsImported: row.totals_stats_imported,
    dayByDayStatsImported: row.day_by_day_stats_imported,
  };
}

export function buildResultState(
  run: SmartleadMigrationRun,
  campaignRows: SmartleadMigrationCampaign[],
): MigrationResultState {
  const campaignResults = campaignRows.map(mapCampaignRowToResult);
  const succeeded = campaignRows
    .filter((row) => row.status === 'succeeded')
    .map((row) => row.campaign_name);
  const failed = campaignRows
    .filter((row) => row.status === 'failed' || row.status === 'cancelled')
    .map((row) => ({
      name: row.campaign_name,
      error: row.last_error_message ?? (row.status === 'cancelled' ? 'Migration cancelled.' : 'Migration failed.'),
    }));

  return {
    succeeded,
    failed,
    statsImported: run.totals_stats_campaign_count > 0 || run.day_by_day_stats_campaign_count > 0,
    totalLeadsImported: run.leads_imported,
    campaignResults,
  };
}

export function formatCount(value: number | null | undefined): string {
  return new Intl.NumberFormat().format(value ?? 0);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function getRunHeading(run: SmartleadMigrationRun | null, migrating: boolean): string {
  switch (run?.status) {
    case 'queued':
    case 'launch_requested':
      return 'Preparing Migration';
    case 'task_started':
      return 'Waiting For Worker';
    case 'running':
      return 'Migration Running';
    case 'cancel_requested':
      return 'Cancelling Migration';
    case 'cancelled':
      return 'Migration Cancelled';
    case 'failed_to_launch':
      return 'Launch Failed';
    case 'failed_to_claim':
      return 'Worker Failed To Start';
    case 'failed':
      return 'Migration Failed';
    case 'completed_with_warnings':
      return 'Migration Complete With Warnings';
    default:
      return migrating ? 'Migration Running' : 'Migration Complete';
  }
}

export function getRunSummary(run: SmartleadMigrationRun): string {
  switch (run.status) {
    case 'queued':
    case 'launch_requested':
      return 'Launch requested. Preparing the ECS task.';
    case 'task_started':
      return 'ECS task created. Waiting for the worker to claim the run.';
    case 'running':
    case 'cancel_requested':
      return `${formatCount(run.completed_campaign_count + run.failed_campaign_count)} of ${formatCount(run.selected_campaign_count)} campaigns processed`;
    case 'failed_to_launch':
      return 'The launcher never created an ECS task for this run.';
    case 'failed_to_claim':
      return 'An ECS task was created, but no worker claimed the run.';
    case 'cancelled':
      return 'This run was cancelled before it could finish.';
    default:
      return `${formatCount(run.completed_campaign_count + run.failed_campaign_count)} of ${formatCount(run.selected_campaign_count)} campaigns processed`;
  }
}

export function getRunDetail(run: SmartleadMigrationRun, progress: MigrationProgress | null): string | null {
  if (progress) {
    if (progress.phase === 'campaign') return 'Creating campaign...';
    if (progress.phase === 'leads') return 'Fetching and importing leads...';
    if (progress.phase === 'enrollments') return `Creating enrollments (${progress.leadCount ?? 0} leads)...`;
    if (progress.phase === 'conversations') return progress.detail ?? 'Importing conversations...';
    if (progress.phase === 'stats') return 'Importing stats...';
    if (progress.phase === 'done') return run.current_detail ?? 'Migration finished.';
  }

  switch (run.status) {
    case 'queued':
    case 'launch_requested':
      return run.current_detail ?? 'Preparing launch request...';
    case 'task_started':
      return run.current_detail ?? 'Waiting for worker startup and claim...';
    case 'cancel_requested':
      return run.current_detail ?? 'Waiting for the worker to stop cleanly...';
    case 'failed_to_launch':
      return 'No ECS task was created before the launch timed out.';
    case 'failed_to_claim':
      return 'The worker did not heartbeat or claim the run before the timeout.';
    case 'cancelled':
      return run.current_detail ?? 'Migration cancelled.';
    case 'completed':
    case 'completed_with_warnings':
      return run.current_detail ?? 'Migration finished.';
    case 'failed':
      return run.current_detail ?? 'The worker started but the migration failed.';
    default:
      return null;
  }
}

export function formatParticipants(participants: string[] | null | undefined): string {
  if (!participants || participants.length === 0) return '—';
  if (participants.length <= 2) return participants.join(', ');
  return `${participants.slice(0, 2).join(', ')} +${participants.length - 2}`;
}
