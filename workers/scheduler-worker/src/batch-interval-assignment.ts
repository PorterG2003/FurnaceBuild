import {
  isRetryableSupabaseReadError,
  reportErrorToSlack,
} from '@furnace/slack-lib';
import { SupabaseClient } from '@supabase/supabase-js';
import {
  getEligibleMailboxes,
  selectMailboxFromPool,
  type CampaignMailboxRow,
} from './mailbox-selection.js';

type LiveCampaignJobMailbox = {
  id: string;
  lead_id: string;
  mailbox_id: string;
  created_at: string;
};

type ReadyIntervalEnrollmentRow = {
  id: string;
  lead_id: string;
  current_node_id: string | null;
  next_run_at: string | null;
  created_at?: string | null;
  lead_mailbox_id: string | null;
  lead_email: string;
  lead_name: string;
  lead_first_name?: string | null;
  lead_last_name?: string | null;
};

type ReadyEnrollment = {
  id: string;
  lead_id: string;
  current_node_id: string | null;
  next_run_at: string | null;
  created_at?: string;
  lead?: {
    id: string;
    mailbox_id: string | null;
    email: string;
    name: string;
    first_name?: string | null;
    last_name?: string | null;
    deleted_at?: string | null;
  } | Array<{
    id: string;
    mailbox_id: string | null;
    email: string;
    name: string;
    first_name?: string | null;
    last_name?: string | null;
    deleted_at?: string | null;
  }> | null;
};

type CampaignAccountRelation =
  | {
      jitter_percentage?: number | null;
    }
  | Array<{
      jitter_percentage?: number | null;
    }>
  | null;

/** PostgREST returns 400 Bad Request when `.in()` lists make the request URL too large. */
const POSTGREST_IN_CLAUSE_CHUNK_SIZE = 100;

function chunkDistinctIds(ids: string[], chunkSize: number): string[][] {
  const deduped = [...new Set(ids.filter(Boolean))];
  if (deduped.length === 0) {
    return [];
  }
  const out: string[][] = [];
  for (let i = 0; i < deduped.length; i += chunkSize) {
    out.push(deduped.slice(i, i + chunkSize));
  }
  return out;
}

function getAccountJitter(accounts: CampaignAccountRelation): number | null {
  if (Array.isArray(accounts)) {
    return accounts[0]?.jitter_percentage ?? null;
  }

  return accounts?.jitter_percentage ?? null;
}

function mapReadyIntervalEnrollmentRow(row: ReadyIntervalEnrollmentRow): ReadyEnrollment {
  return {
    id: row.id,
    lead_id: row.lead_id,
    current_node_id: row.current_node_id,
    next_run_at: row.next_run_at,
    created_at: row.created_at ?? undefined,
    lead: {
      id: row.lead_id,
      mailbox_id: row.lead_mailbox_id,
      email: row.lead_email,
      name: row.lead_name,
      first_name: row.lead_first_name,
      last_name: row.lead_last_name,
      deleted_at: null,
    },
  };
}

/**
 * Earliest live campaign message_job per lead (pending / reserved / sending).
 * Chunked: PostgREST encodes `.in('lead_id', …)` on the request URL; huge lists return 400 Bad Request.
 * Prefer passing only lead ids that actually need this lookup (see batchAssignIntervalJobs).
 * A single SQL RPC with `uuid[]` / jsonb parameters would avoid URL limits entirely (future refinement).
 */
async function loadLiveCampaignJobMailboxByLead(
  supabase: SupabaseClient,
  campaignId: string,
  leadIds: string[],
): Promise<Map<string, LiveCampaignJobMailbox>> {
  if (leadIds.length === 0) {
    return new Map();
  }

  const mailboxByLead = new Map<string, LiveCampaignJobMailbox>();

  for (const chunk of chunkDistinctIds(leadIds, POSTGREST_IN_CLAUSE_CHUNK_SIZE)) {
    const { data, error } = await supabase
      .from('message_jobs')
      .select('id, lead_id, mailbox_id, created_at')
      .eq('campaign_id', campaignId)
      .in('lead_id', chunk)
      .in('status', ['pending', 'reserved', 'sending'])
      .or('message_type.is.null,message_type.eq.campaign')
      .order('created_at', { ascending: true });

    if (error) {
      throw new Error(`Failed to load live campaign job mailboxes: ${error.message}`);
    }

    for (const row of (data ?? []) as LiveCampaignJobMailbox[]) {
      const existing = mailboxByLead.get(row.lead_id);
      if (!existing || row.created_at < existing.created_at) {
        mailboxByLead.set(row.lead_id, row);
      }
    }
  }

  return mailboxByLead;
}

function compareReadyEnrollments(left: ReadyEnrollment, right: ReadyEnrollment): number {
  const leftNextRun = left.next_run_at ?? '';
  const rightNextRun = right.next_run_at ?? '';
  if (leftNextRun !== rightNextRun) {
    return leftNextRun.localeCompare(rightNextRun);
  }

  const leftCreatedAt = left.created_at ?? '';
  const rightCreatedAt = right.created_at ?? '';
  if (leftCreatedAt !== rightCreatedAt) {
    return leftCreatedAt.localeCompare(rightCreatedAt);
  }

  return left.id.localeCompare(right.id);
}

function getEnrollmentLead(
  enrollment: ReadyEnrollment,
): NonNullable<Exclude<ReadyEnrollment['lead'], Array<unknown>>> | null {
  if (Array.isArray(enrollment.lead)) {
    return enrollment.lead[0] ?? null;
  }

  return enrollment.lead ?? null;
}

/**
 * Batch assign jobs to intervals for campaigns
 * 
 * For each campaign with available/scheduled intervals:
 * 1. Locks the first available/scheduled interval
 * 2. Finds enrollments ready for email jobs (current_node_id is email node, no message_job exists yet)
 * 3. For each enrollment, determines mailbox (locked lead mailbox, existing live job mailbox, or round-robin)
 * 4. Creates all message_jobs in one atomic transaction
 */
export async function batchAssignIntervalJobs(
  supabase: SupabaseClient,
  rotationIndexBase: number = 0
): Promise<void> {
  const now = new Date().toISOString();
  /** Lower bound for "next" interval_time (SQL >). Small slack avoids skipping the first slot when interval rows were just inserted with timestamps a few ms behind this tick. */
  const earliestIntervalLowerBoundIso = new Date(Date.now() - 15_000).toISOString();
  
  // Get all campaigns with available/scheduled intervals
  const { data: campaigns, error: campaignsError } = await supabase
    .from('campaigns')
    .select('id, jitter_percentage, account_id, accounts(jitter_percentage)')
    .eq('status', 'running')
    .is('deleted_at', null)
    .not('sending_interval_seconds', 'is', null);
  
  if (campaignsError) {
    console.error('[BATCH INTERVAL] Error loading campaigns:', campaignsError);
    reportErrorToSlack('Scheduler: batch interval failed to load campaigns', {
      severity: 'critical',
      error: campaignsError.message,
      alertPolicy: isRetryableSupabaseReadError(campaignsError.message)
        ? 'transient_retryable_warning'
        : 'critical_failure',
      aggregationKey: isRetryableSupabaseReadError(campaignsError.message)
        ? 'scheduler-batch-interval-load-campaigns'
        : undefined,
      summaryFields: {
        worker: 'scheduler',
        operation: 'batchAssignIntervalJobs',
      },
    });
    return;
  }
  
  if (!campaigns || campaigns.length === 0) {
    return;
  }
  
  console.log(`[BATCH INTERVAL] Processing ${campaigns.length} campaign(s)`);
  
  let globalRotationIndex = rotationIndexBase;
  
  for (const campaign of campaigns) {
    try {
      // Load the earliest future incomplete interval. If the earliest one is locked,
      // later intervals are blocked anyway, so we can skip this campaign.
      const { data: intervals, error: intervalsError } = await supabase
        .from('campaign_intervals')
        .select('id, interval_time, status')
        .eq('campaign_id', campaign.id)
        .gt('interval_time', earliestIntervalLowerBoundIso)
        .neq('status', 'completed')
        .order('interval_time', { ascending: true })
        .limit(1);
      
      if (intervalsError) {
        console.error(`[BATCH INTERVAL] Error checking intervals for campaign ${campaign.id.substring(0, 8)}:`, intervalsError);
        reportErrorToSlack('Scheduler: batch interval failed to check intervals', {
          severity: 'warning',
          campaign_id: campaign.id,
          error: intervalsError.message,
          alertPolicy: isRetryableSupabaseReadError(intervalsError.message)
            ? 'transient_retryable_warning'
            : 'persistent_config_warning',
          aggregationKey: `scheduler-batch-interval-check-intervals:${campaign.id}`,
          summaryFields: {
            campaign_id: campaign.id,
          },
        });
        continue;
      }
      
      // Skip if no future incomplete interval is available/scheduled.
      if (!intervals || intervals.length === 0) {
        continue;
      }

      const firstInterval = intervals[0];
      if (!['available', 'scheduled'].includes(firstInterval.status)) {
        continue;
      }
      
      // Find enrollments ready for email jobs
      // current_node_id must be an email node
      // No message_job should exist for this enrollment+node combination
      const { data: emailNodes, error: nodesError } = await supabase
        .from('nodes')
        .select('id, node_data')
        .eq('campaign_id', campaign.id)
        .is('deleted_at', null)
        .eq('node_type', 'email');
      
      if (nodesError || !emailNodes || emailNodes.length === 0) {
        continue;
      }
      
      // Priority email nodes (priority === true, or legacy send_mode='reply')
      // are handled by the scheduler directly as campaign_priority jobs —
      // never interval-assigned.
      const intervalEmailNodes = emailNodes.filter(
        (n: any) => n.node_data?.priority !== true && n.node_data?.send_mode !== 'reply',
      );

      if (intervalEmailNodes.length === 0) {
        continue;
      }

      const emailNodeIds = intervalEmailNodes.map(n => n.id);

      // Eligibility + duplicate-job exclusion in one indexed RPC (replaces the prior
      // enrollments SELECT + get_existing_message_job_pairs round-trip).
      const { data: readyRows, error: enrollmentsError } = await supabase.rpc(
        'get_ready_interval_enrollments',
        {
          p_campaign_id: campaign.id,
          p_node_ids: emailNodeIds,
          p_now: now,
        },
      );

      if (enrollmentsError) {
        console.error(`[BATCH INTERVAL] Error loading enrollments for campaign ${campaign.id.substring(0, 8)}:`, enrollmentsError);
        reportErrorToSlack('Scheduler: batch interval failed to load enrollments', {
          severity: 'warning',
          campaign_id: campaign.id,
          error: enrollmentsError.message,
          alertPolicy: isRetryableSupabaseReadError(enrollmentsError.message)
            ? 'transient_retryable_warning'
            : 'persistent_config_warning',
          aggregationKey: `scheduler-batch-interval-load-enrollments:${campaign.id}`,
          summaryFields: {
            campaign_id: campaign.id,
          },
        });
        continue;
      }

      const enrollmentsWithoutJobs = ((readyRows || []) as ReadyIntervalEnrollmentRow[]).map(
        mapReadyIntervalEnrollmentRow,
      );

      if (enrollmentsWithoutJobs.length === 0) {
        continue;
      }
      
      console.log(`[BATCH INTERVAL] Campaign ${campaign.id.substring(0, 8)}: Found ${enrollmentsWithoutJobs.length} enrollment(s) ready for email jobs`);

      // Live message_job mailbox is only used when the lead has no locked mailbox on `leads`.
      // Querying all ready lead_ids inflated PostgREST `.in()` URLs and caused 400 Bad Request at scale.
      const readyLeadIdsNeedingLiveMailbox = [
        ...new Set(
          enrollmentsWithoutJobs
            .filter((enrollment) => {
              if (!enrollment.lead_id) {
                return false;
              }
              const lead = getEnrollmentLead(enrollment);
              return !lead?.mailbox_id;
            })
            .map((enrollment) => enrollment.lead_id as string),
        ),
      ];
      const liveMailboxByLead = await loadLiveCampaignJobMailboxByLead(
        supabase,
        campaign.id,
        readyLeadIdsNeedingLiveMailbox,
      );
      
      const jitterPercentage =
        campaign.jitter_percentage ??
        getAccountJitter((campaign as any).accounts) ??
        10.0;
      
      // Get eligible mailboxes for this campaign
      const { data: campaignMailboxes } = await supabase
        .from('campaign_mailboxes')
        .select(`
          mailbox_id,
          mailbox:mailboxes!inner(id, status, smtp_status, deleted_at)
        `)
        .eq('campaign_id', campaign.id);

      const eligibleMailboxes = getEligibleMailboxes(
        (campaignMailboxes as CampaignMailboxRow[] | null) ?? [],
      );
      
      if (eligibleMailboxes.length === 0) {
        console.warn(`[BATCH INTERVAL] Campaign ${campaign.id.substring(0, 8)} has no eligible mailboxes`);
        continue;
      }
      
      // Reuse node_data already loaded with intervalEmailNodes (avoids a second nodes query).
      const nodeIdToNodeData = new Map<string, any>();
      for (const node of intervalEmailNodes) {
        nodeIdToNodeData.set(node.id, node);
      }
      
      // Prepare one candidate per mailbox for the current earliest interval.
      // Later candidates for the same mailbox cannot be scheduled into this interval anyway.
      const jobDataByMailbox = new Map<string, any>();
      let rotationIndex = globalRotationIndex;

      const sortedEnrollments = [...enrollmentsWithoutJobs].sort(compareReadyEnrollments);

      for (const enrollment of sortedEnrollments) {
        const lead = getEnrollmentLead(enrollment);
        if (!lead) {
          continue;
        }
        
        // Determine mailbox
        let mailboxId: string | null = lead.mailbox_id;
        
        if (!mailboxId) {
          const liveMailbox = liveMailboxByLead.get(enrollment.lead_id);
          if (liveMailbox?.mailbox_id) {
            mailboxId = liveMailbox.mailbox_id;
          } else {
            // No locked or live mailbox assignment yet - use round-robin from the current pool.
            const selectedMailbox = selectMailboxFromPool(campaign.id, eligibleMailboxes, rotationIndex);
            if (!selectedMailbox) {
              console.warn(`[BATCH INTERVAL] No mailbox available for enrollment ${enrollment.id.substring(0, 8)}`);
              continue;
            }
            mailboxId = selectedMailbox.id;
            rotationIndex++;
          }
        }
        
        // Get node data
        const node = enrollment.current_node_id ? nodeIdToNodeData.get(enrollment.current_node_id) : null;
        if (!node || !enrollment.current_node_id) {
          console.warn(`[BATCH INTERVAL] Node data not found for enrollment ${enrollment.id.substring(0, 8)}`);
          continue;
        }
        
        // Prepare message_data
        const messageData = {
          node_config: node.node_data || {},
          lead_data: {
            email: lead.email,
            name: lead.name,
            first_name: lead.first_name,
            last_name: lead.last_name,
          },
        };
        
        if (jobDataByMailbox.has(mailboxId)) {
          continue;
        }

        jobDataByMailbox.set(mailboxId, {
          enrollment_id: enrollment.id,
          lead_id: enrollment.lead_id,
          mailbox_id: mailboxId,
          node_id: enrollment.current_node_id,
          message_data: messageData,
          jitter_percentage: jitterPercentage,
        });
      }

      const jobData = [...jobDataByMailbox.values()];
      
      if (jobData.length === 0) {
        continue;
      }
      
      // Call RPC function to batch assign jobs
      const workerId = process.env.WORKER_ID || 'scheduler';
      const { data: result, error: rpcError } = await supabase
        .rpc('batch_assign_jobs_to_interval', {
          p_campaign_id: campaign.id,
          p_job_data: jobData,
          p_worker_id: workerId,
          p_required_mailbox_count: eligibleMailboxes.length,
        });
      
      if (rpcError) {
        console.error(`[BATCH INTERVAL] RPC error for campaign ${campaign.id.substring(0, 8)}:`, rpcError);
        reportErrorToSlack('Scheduler: batch interval RPC failed (assign_message_jobs_to_interval)', {
          severity: 'critical',
          campaign_id: campaign.id,
          error: rpcError.message,
          alertPolicy: isRetryableSupabaseReadError(rpcError.message)
            ? 'transient_retryable_warning'
            : 'persistent_config_warning',
          aggregationKey: `scheduler-batch-interval-rpc:${campaign.id}`,
          summaryFields: {
            campaign_id: campaign.id,
          },
        });
        continue;
      }
      
      if (result && result.length > 0) {
        const r = result[0] as any;
        console.log(`[BATCH INTERVAL] Campaign ${campaign.id.substring(0, 8)}: Created ${r.jobs_created} job(s) in interval ${r.interval_id?.substring(0, 8) || 'NULL'} (${r.interval_time})`);
      }
      
      // Update global rotation index
      globalRotationIndex = rotationIndex;
      
    } catch (error) {
      console.error(`[BATCH INTERVAL] Error processing campaign ${campaign.id.substring(0, 8)}:`, error);
      const msg = error instanceof Error ? error.message : String(error);
      reportErrorToSlack('Scheduler: batch interval error processing campaign', {
        severity: 'critical',
        campaign_id: campaign.id,
        error: msg,
        alertPolicy: isRetryableSupabaseReadError(msg)
          ? 'transient_retryable_warning'
          : 'persistent_config_warning',
        aggregationKey: `scheduler-batch-interval-process-campaign:${campaign.id}`,
        summaryFields: {
          campaign_id: campaign.id,
        },
      });
    }
  }
}

