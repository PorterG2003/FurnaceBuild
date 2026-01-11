import { SupabaseClient } from '@supabase/supabase-js';
import { selectMailbox } from './mailbox-selection.js';

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
    .select('id, jitter_percentage')
    .not('sending_interval_seconds', 'is', null);
  
  if (campaignsError) {
    console.error('[BATCH INTERVAL] Error loading campaigns:', campaignsError);
    return;
  }
  
  if (!campaigns || campaigns.length === 0) {
    return;
  }
  
  console.log(`[BATCH INTERVAL] Processing ${campaigns.length} campaign(s)`);
  
  let globalRotationIndex = rotationIndexBase;
  
  for (const campaign of campaigns) {
    try {
      // Check if campaign has any available/scheduled intervals
      const { data: intervals, error: intervalsError } = await supabase
        .from('campaign_intervals')
        .select('id, interval_time, status')
        .eq('campaign_id', campaign.id)
        .gt('interval_time', now)
        .in('status', ['available', 'scheduled'])
        .order('interval_time', { ascending: true })
        .limit(1);
      
      if (intervalsError) {
        console.error(`[BATCH INTERVAL] Error checking intervals for campaign ${campaign.id.substring(0, 8)}:`, intervalsError);
        continue;
      }
      
      // Skip if no available/scheduled intervals
      if (!intervals || intervals.length === 0) {
        continue;
      }
      
      // Check if first interval is blocked by incomplete previous intervals
      const firstInterval = intervals[0];
      const { data: blockingIntervals } = await supabase
        .from('campaign_intervals')
        .select('id')
        .eq('campaign_id', campaign.id)
        .lt('interval_time', firstInterval.interval_time)
        .gte('interval_time', now)
        .neq('status', 'completed')
        .limit(1);
      
      if (blockingIntervals && blockingIntervals.length > 0) {
        // Interval is blocked - skip this campaign
        continue;
      }
      
      // Find enrollments ready for email jobs
      // current_node_id must be an email node
      // No message_job should exist for this enrollment+node combination
      const { data: emailNodes, error: nodesError } = await supabase
        .from('nodes')
        .select('id')
        .eq('campaign_id', campaign.id)
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
          lead:leads!inner(id, mailbox_id, email, name, first_name, last_name)
        `)
        .eq('campaign_id', campaign.id)
        .eq('state', 'active')
        .in('current_node_id', emailNodeIds);
      
      if (enrollmentsError) {
        console.error(`[BATCH INTERVAL] Error loading enrollments for campaign ${campaign.id.substring(0, 8)}:`, enrollmentsError);
        continue;
      }
      
      if (!enrollments || enrollments.length === 0) {
        continue;
      }
      
      // Filter enrollments that don't already have a message_job for this node
      const enrollmentsWithoutJobs: typeof enrollments = [];
      
      for (const enrollment of enrollments) {
        const { data: existingJob } = await supabase
          .from('message_jobs')
          .select('id')
          .eq('enrollment_id', enrollment.id)
          .eq('node_id', enrollment.current_node_id)
          .in('status', ['pending', 'reserved', 'sending', 'sent', 'failed'])
          .maybeSingle();
        
        if (!existingJob) {
          enrollmentsWithoutJobs.push(enrollment);
        }
      }
      
      if (enrollmentsWithoutJobs.length === 0) {
        continue;
      }
      
      console.log(`[BATCH INTERVAL] Campaign ${campaign.id.substring(0, 8)}: Found ${enrollmentsWithoutJobs.length} enrollment(s) ready for email jobs`);
      
      // Get account jitter if campaign doesn't have one (need this before creating jobs)
      let jitterPercentage = campaign.jitter_percentage;
      if (!jitterPercentage) {
        const { data: campaignWithAccount } = await supabase
          .from('campaigns')
          .select('account_id, accounts(jitter_percentage)')
          .eq('id', campaign.id)
          .single();
        
        if (campaignWithAccount && (campaignWithAccount as any).accounts) {
          jitterPercentage = (campaignWithAccount as any).accounts.jitter_percentage || 10.0;
        } else {
          jitterPercentage = 10.0;
        }
      }
      
      // Get eligible mailboxes for this campaign
      const { data: campaignMailboxes } = await supabase
        .from('campaign_mailboxes')
        .select(`
          mailbox_id,
          mailbox:mailboxes!inner(id, status, smtp_status)
        `)
        .eq('campaign_id', campaign.id);
      
      const eligibleMailboxes = campaignMailboxes?.filter((cm: any) => 
        cm.mailbox?.status === 'connected' && cm.mailbox?.smtp_status === 'active'
      ) || [];
      
      if (eligibleMailboxes.length === 0) {
        console.warn(`[BATCH INTERVAL] Campaign ${campaign.id.substring(0, 8)} has no eligible mailboxes`);
        continue;
      }
      
      // Get node data for message_data
      const nodeIdToNodeData = new Map<string, any>();
      for (const enrollment of enrollmentsWithoutJobs) {
        if (enrollment.current_node_id && !nodeIdToNodeData.has(enrollment.current_node_id)) {
          const { data: node } = await supabase
            .from('nodes')
            .select('id, node_data')
            .eq('id', enrollment.current_node_id)
            .single();
          
          if (node) {
            nodeIdToNodeData.set(enrollment.current_node_id, node);
          }
        }
      }
      
      // Prepare job data - assign mailboxes
      const jobData: any[] = [];
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
          const selectedMailbox = await selectMailbox(campaign.id, supabase, rotationIndex);
          if (!selectedMailbox) {
            console.warn(`[BATCH INTERVAL] No mailbox available for enrollment ${enrollment.id.substring(0, 8)}`);
            continue;
          }
          mailboxId = selectedMailbox.id;
          rotationIndex++;
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
        
        jobData.push({
          enrollment_id: enrollment.id,
          lead_id: enrollment.lead_id,
          mailbox_id: mailboxId,
          node_id: enrollment.current_node_id,
          message_data: messageData,
          jitter_percentage: jitterPercentage,
        });
      }
      
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
        });
      
      if (rpcError) {
        console.error(`[BATCH INTERVAL] RPC error for campaign ${campaign.id.substring(0, 8)}:`, rpcError);
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
    }
  }
}

