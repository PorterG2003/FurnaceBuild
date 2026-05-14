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

type ExistingMessageJobPair = {
  enrollment_id: string;
  node_id: string;
};

type LiveCampaignJobMailbox = {
  id: string;
  lead_id: string;
  mailbox_id: string;
  created_at: string;
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

/** RPC JSON payload size for `get_existing_message_job_pairs`; chunk to avoid failures at scale. */
const MESSAGE_JOB_PAIR_RPC_CHUNK_SIZE = 300;

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

async function loadExistingMessageJobPairSet(
  supabase: SupabaseClient,
  candidatePairs: ExistingMessageJobPair[],
): Promise<Set<string>> {
  if (candidatePairs.length === 0) {
    return new Set();
  }

  const keys = new Set<string>();
  for (let i = 0; i < candidatePairs.length; i += MESSAGE_JOB_PAIR_RPC_CHUNK_SIZE) {
    const slice = candidatePairs.slice(i, i + MESSAGE_JOB_PAIR_RPC_CHUNK_SIZE);
    const { data, error } = await supabase.rpc('get_existing_message_job_pairs', {
      p_pairs: slice,
    });

    if (error) {
      throw new Error(`Failed to load existing message job pairs: ${error.message}`);
    }

    const existingPairs = Array.isArray(data) ? (data as ExistingMessageJobPair[]) : [];
    for (const pair of existingPairs) {
      keys.add(`${pair.enrollment_id}:${pair.node_id}`);
    }
  }
  return keys;
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
        .select('id')
        .eq('campaign_id', campaign.id)
        .is('deleted_at', null)
        .eq('node_type', 'email');
      
      if (nodesError || !emailNodes || emailNodes.length === 0) {
        continue;
      }
      
      const emailNodeIds = emailNodes.map(n => n.id);
      
      // Find enrollments with email node as current_node_id
      const { data: enrollments, error: enrollmentsError } = await supabase
        .from('enrollments')
        .select(`
          id,
          lead_id,
          current_node_id,
          next_run_at,
          created_at,
          lead:leads!inner(id, mailbox_id, email, name, first_name, last_name, deleted_at)
        `)
        .eq('campaign_id', campaign.id)
        .eq('state', 'active')
        .is('deleted_at', null)
        .not('next_run_at', 'is', null)
        .lte('next_run_at', now)
        .in('current_node_id', emailNodeIds)
        .order('next_run_at', { ascending: true })
        .order('created_at', { ascending: true })
        .order('id', { ascending: true });
      
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
      
      const activeEnrollments = ((enrollments || []) as ReadyEnrollment[]).filter((enrollment) => {
        const lead = getEnrollmentLead(enrollment);
        return !lead?.deleted_at;
      });

      if (activeEnrollments.length === 0) {
        continue;
      }
      
      // Filter enrollments that don't already have a message_job for this node.
      // Include 'cancelled' and 'blocked': do not create another job if the only job was cancelled or blocked.
      const candidatePairs = activeEnrollments
        .filter((enrollment) => Boolean(enrollment.current_node_id))
        .map((enrollment) => ({
          enrollment_id: enrollment.id,
          node_id: enrollment.current_node_id as string,
        }));

      const existingJobPairSet = await loadExistingMessageJobPairSet(supabase, candidatePairs);
      const enrollmentsWithoutJobs = activeEnrollments.filter(
        (enrollment) =>
          !enrollment.current_node_id ||
          !existingJobPairSet.has(`${enrollment.id}:${enrollment.current_node_id}`),
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
      
      // Get node data for message_data
      const uniqueNodeIds = [...new Set(
        enrollmentsWithoutJobs
          .map((enrollment) => enrollment.current_node_id)
          .filter((nodeId): nodeId is string => Boolean(nodeId))
      )];
      const nodeIdToNodeData = new Map<string, any>();

      if (uniqueNodeIds.length > 0) {
        const { data: nodes, error: nodesLookupError } = await supabase
          .from('nodes')
          .select('id, node_data')
          .in('id', uniqueNodeIds)
          .is('deleted_at', null);

        if (nodesLookupError) {
          console.error(
            `[BATCH INTERVAL] Error loading node data for campaign ${campaign.id.substring(0, 8)}:`,
            nodesLookupError,
          );
          reportErrorToSlack('Scheduler: batch interval failed to load node data', {
            severity: 'warning',
            campaign_id: campaign.id,
            error: nodesLookupError.message,
            alertPolicy: isRetryableSupabaseReadError(nodesLookupError.message)
              ? 'transient_retryable_warning'
              : 'persistent_config_warning',
            aggregationKey: `scheduler-batch-interval-load-node-data:${campaign.id}`,
            summaryFields: {
              campaign_id: campaign.id,
            },
          });
          continue;
        }

        for (const node of nodes || []) {
          nodeIdToNodeData.set(node.id, node);
        }
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

