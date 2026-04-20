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

type CampaignAccountRelation =
  | {
      jitter_percentage?: number | null;
    }
  | Array<{
      jitter_percentage?: number | null;
    }>
  | null;

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

  const { data, error } = await supabase.rpc('get_existing_message_job_pairs', {
    p_pairs: candidatePairs,
  });

  if (error) {
    throw new Error(`Failed to load existing message job pairs: ${error.message}`);
  }

  const existingPairs = Array.isArray(data) ? (data as ExistingMessageJobPair[]) : [];
  return new Set(existingPairs.map((pair) => `${pair.enrollment_id}:${pair.node_id}`));
}

/**
 * Batch assign jobs to intervals for campaigns
 * 
 * For each campaign with available/scheduled intervals:
 * 1. Locks the first available/scheduled interval
 * 2. Finds enrollments ready for email jobs (current_node_id is email node, no message_job exists yet)
 * 3. For each enrollment, determines mailbox (uses existing assignment or round-robin)
 * 4. Creates all message_jobs in one atomic transaction
 */
export async function batchAssignIntervalJobs(
  supabase: SupabaseClient,
  rotationIndexBase: number = 0
): Promise<void> {
  const now = new Date().toISOString();
  
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
        .gt('interval_time', now)
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
          lead:leads!inner(id, mailbox_id, email, name, first_name, last_name, deleted_at)
        `)
        .eq('campaign_id', campaign.id)
        .eq('state', 'active')
        .is('deleted_at', null)
        .in('current_node_id', emailNodeIds);
      
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
      
      const activeEnrollments = (enrollments || []).filter((enrollment: any) => !enrollment.lead?.deleted_at);

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
      
      for (const enrollment of enrollmentsWithoutJobs) {
        const lead = (enrollment as any).lead;
        if (!lead) {
          continue;
        }
        
        // Determine mailbox
        let mailboxId: string | null = lead.mailbox_id;
        
        if (!mailboxId) {
          // No mailbox assigned - use round-robin
          const selectedMailbox = selectMailboxFromPool(campaign.id, eligibleMailboxes, rotationIndex);
          if (!selectedMailbox) {
            console.warn(`[BATCH INTERVAL] No mailbox available for enrollment ${enrollment.id.substring(0, 8)}`);
            continue;
          }
          mailboxId = selectedMailbox.id;
          rotationIndex++;
          // Persist assignment so subsequent emails for this lead use the same mailbox
          const { error: updateLeadError } = await supabase
            .from('leads')
            .update({ mailbox_id: selectedMailbox.id })
            .eq('id', enrollment.lead_id)
            .is('mailbox_id', null);
          if (!updateLeadError) {
            console.log(`[BATCH INTERVAL] Assigned mailbox ${selectedMailbox.id.substring(0, 8)} to lead ${enrollment.lead_id.substring(0, 8)}`);
          }
          // If update failed (e.g. race: another worker assigned), lead now has mailbox_id; next batch run will use it
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
            : 'critical_failure',
          aggregationKey: isRetryableSupabaseReadError(rpcError.message)
            ? `scheduler-batch-interval-rpc:${campaign.id}`
            : undefined,
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
          : 'critical_failure',
        aggregationKey: isRetryableSupabaseReadError(msg)
          ? `scheduler-batch-interval-process-campaign:${campaign.id}`
          : undefined,
        summaryFields: {
          campaign_id: campaign.id,
        },
      });
    }
  }
}

