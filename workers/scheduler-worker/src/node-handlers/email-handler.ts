import { SupabaseClient } from '@supabase/supabase-js';
import type { Enrollment, MessageJob, Lead, Mailbox, Campaign } from '../types.js';
import { selectMailbox } from '../mailbox-selection.js';

/**
 * Diagnostic function to log interval availability details
 */
async function diagnoseIntervalAvailability(
  campaignId: string,
  mailboxId: string,
  supabase: SupabaseClient
): Promise<void> {
  const now = new Date().toISOString();
  
  // Get campaign info
  const { data: campaign, error: campaignError } = await supabase
    .from('campaigns')
    .select('id, last_completed_interval_time, sending_interval_seconds')
    .eq('id', campaignId)
    .single();

  if (campaignError) {
    console.error(`[INTERVAL DIAGNOSTIC] Failed to load campaign: ${campaignError.message}`);
    return;
  }

  // Get all intervals for this campaign
  const { data: intervals, error: intervalsError } = await supabase
    .from('campaign_intervals')
    .select('id, interval_time, status, locked_at, locked_by')
    .eq('campaign_id', campaignId)
    .order('interval_time', { ascending: true })
    .limit(50); // Get first 50 to see what's available

  if (intervalsError) {
    console.error(`[INTERVAL DIAGNOSTIC] Failed to load intervals: ${intervalsError.message}`);
    return;
  }

  // Get mailbox jobs in intervals
  const { data: mailboxJobs, error: jobsError } = await supabase
    .from('message_jobs')
    .select('id, interval_id, status, scheduled_at')
    .eq('mailbox_id', mailboxId)
    .eq('campaign_id', campaignId)
    .in('status', ['pending', 'reserved', 'sending', 'sent', 'failed'])
    .limit(20);

  if (jobsError) {
    console.error(`[INTERVAL DIAGNOSTIC] Failed to load mailbox jobs: ${jobsError.message}`);
  }

  // Count intervals by status
  const statusCounts = {
    available: 0,
    locked: 0,
    scheduled: 0,
    completed: 0,
  };

  const futureIntervals = intervals?.filter(i => new Date(i.interval_time) > new Date(now)) || [];
  // Only check FUTURE intervals - past ones don't block (they'll be excluded from sequential check)
  const incompleteBeforeFirst = intervals?.filter(i => {
    if (!futureIntervals.length) return false;
    const firstFuture = futureIntervals[0];
    const intervalTime = new Date(i.interval_time);
    const nowTime = new Date(now);
    // Only consider incomplete intervals that are:
    // 1. Before the first future interval
    // 2. In the future (>= NOW) - past intervals don't block
    // 3. Not completed
    return intervalTime < new Date(firstFuture.interval_time) 
      && intervalTime >= nowTime 
      && i.status !== 'completed';
  }) || [];

  intervals?.forEach(i => {
    if (i.status in statusCounts) {
      statusCounts[i.status as keyof typeof statusCounts]++;
    }
  });

  console.log(`[INTERVAL DIAGNOSTIC] Campaign ${campaignId.substring(0, 8)}:`);
  console.log(`  - Last completed interval time: ${campaign?.last_completed_interval_time || 'NULL'}`);
  console.log(`  - Sending interval seconds: ${campaign?.sending_interval_seconds}`);
  console.log(`  - Total intervals found: ${intervals?.length || 0}`);
  console.log(`  - Status breakdown:`, statusCounts);
  console.log(`  - Future intervals (>${now}): ${futureIntervals.length}`);
  console.log(`  - Incomplete intervals before first future: ${incompleteBeforeFirst.length}`);
  
  if (incompleteBeforeFirst.length > 0) {
    console.log(`  - BLOCKING: Found ${incompleteBeforeFirst.length} incomplete FUTURE interval(s) before first future interval:`);
    incompleteBeforeFirst.slice(0, 3).forEach(i => {
      console.log(`    * ${i.interval_time} - status: ${i.status} ${i.locked_at ? `(locked at ${i.locked_at} by ${i.locked_by})` : ''}`);
    });
  } else {
    // Check if there are past incomplete intervals (shouldn't block but good to know)
    const pastIncomplete = intervals?.filter(i => {
      const intervalTime = new Date(i.interval_time);
      return intervalTime < new Date(now) && i.status !== 'completed';
    }) || [];
    if (pastIncomplete.length > 0) {
      console.log(`  - INFO: Found ${pastIncomplete.length} incomplete PAST interval(s) (won't block future assignments):`);
      pastIncomplete.slice(0, 2).forEach(i => {
        console.log(`    * ${i.interval_time} - status: ${i.status}`);
      });
    }
  }

  if (futureIntervals.length > 0) {
    console.log(`  - First 5 future intervals:`);
    futureIntervals.slice(0, 5).forEach(i => {
      const hasMailboxJob = mailboxJobs?.some(j => j.interval_id === i.id);
      console.log(`    * ${i.interval_time} - status: ${i.status} ${hasMailboxJob ? '(mailbox has job)' : ''} ${i.locked_at ? `(locked at ${i.locked_at})` : ''}`);
    });
  }

  if (mailboxJobs && mailboxJobs.length > 0) {
    console.log(`  - Mailbox ${mailboxId.substring(0, 8)} has ${mailboxJobs.length} job(s) in intervals`);
  }

  // Check if there are any intervals that should be available
  const shouldBeAvailable = futureIntervals.filter(i => {
    if (i.status === 'completed') return false;
    if (i.status === 'available') return true;
    if (i.status === 'scheduled') {
      // Check if mailbox already has job
      return !mailboxJobs?.some(j => j.interval_id === i.id);
    }
    return false;
  });

  console.log(`  - Intervals that SHOULD be available: ${shouldBeAvailable.length}`);
  if (shouldBeAvailable.length === 0 && futureIntervals.length > 0) {
    console.log(`  - WARNING: No available intervals despite ${futureIntervals.length} future intervals existing`);
  }
}

/**
 * Handle email node: create message_job using campaign intervals
 * 
 * This function:
 * 1. Assigns mailbox to lead (if needed)
 * 2. Calls atomic assign_message_job_to_interval function which:
 *    - Locks next available campaign interval
 *    - Checks if mailbox already has job in interval
 *    - Creates message_job if needed
 *    - Releases interval lock
 */
export async function handleEmailNode(
  enrollment: Enrollment,
  node: any,
  campaign: Campaign,
  rotationIndex: number,
  jitterPercentage: number,
  supabase: SupabaseClient
): Promise<MessageJob> {
  // 1. Load lead data (includes mailbox_id for consistency check)
  const { data: lead, error: leadError } = await supabase
    .from('leads')
    .select('*')
    .eq('id', enrollment.lead_id)
    .single();
  
  if (leadError || !lead) {
    const error = `Lead ${enrollment.lead_id} not found for enrollment ${enrollment.id}: ${leadError?.message || 'Lead not found'}`;
    console.error(error);
    throw new Error(error);
  }

  // 2. Determine mailbox assignment
  let mailbox: Mailbox;
  let isFirstEmail = false;

  if (!lead.mailbox_id) {
    // First email node - assign mailbox via round-robin
    isFirstEmail = true;
    
    // Check if any emails exist for this lead (handles branching scenario)
    const { data: existingJobs, error: checkError } = await supabase
      .from('message_jobs')
      .select('id')
      .eq('lead_id', enrollment.lead_id)
      .eq('campaign_id', enrollment.campaign_id)
      .limit(1)
      .maybeSingle();

    if (checkError) {
      throw new Error(`Failed to check existing message jobs: ${checkError.message}`);
    }

    if (existingJobs) {
      // Emails exist but mailbox_id is NULL - inconsistency
      throw new Error(`Inconsistency detected: Lead ${enrollment.lead_id} has message jobs but mailbox_id is NULL`);
    }

    // Select mailbox via round-robin
    const selectedMailbox = await selectMailbox(enrollment.campaign_id, supabase, rotationIndex);
    
    if (!selectedMailbox) {
      const error = `No available mailbox found for campaign ${enrollment.campaign_id} (enrollment ${enrollment.id}). Campaign must have at least one mailbox assigned.`;
      console.error(error);
      throw new Error(error);
    }

    console.log(`[MAILBOX DIST] Enrollment ${enrollment.id.substring(0, 8)}: Selected mailbox ${selectedMailbox.id.substring(0, 8)} via round-robin (rotationIndex: ${rotationIndex})`);

    // Atomically assign mailbox to lead
    // NOTE: Must use .is() for NULL checks, not .eq() - .eq(null) converts to string "null" causing PostgreSQL errors
    const { data: updatedLead, error: updateError } = await supabase
      .from('leads')
      .update({ mailbox_id: selectedMailbox.id })
      .eq('id', enrollment.lead_id)
      .is('mailbox_id', null) // Only update if still NULL (atomic check)
      .select()
      .single();

    if (updateError || !updatedLead) {
      // Another worker already assigned - reload lead to get assigned mailbox
      // Log the update error for debugging
      if (updateError) {
        console.error(`[MAILBOX ASSIGNMENT] Update failed for lead ${enrollment.lead_id}:`, updateError.message);
      }
      
      const { data: reloadedLead, error: reloadError } = await supabase
        .from('leads')
        .select('*')
        .eq('id', enrollment.lead_id)
        .single();

      if (reloadError) {
        console.error(`[MAILBOX ASSIGNMENT] Reload failed for lead ${enrollment.lead_id}:`, reloadError.message);
        throw new Error(`Failed to reload lead ${enrollment.lead_id} after race condition: ${reloadError.message}`);
      }

      if (!reloadedLead) {
        throw new Error(`Lead ${enrollment.lead_id} not found after race condition`);
      }

      if (!reloadedLead.mailbox_id) {
        // This shouldn't happen if the atomic update worked correctly
        // But if it does, we need to handle it
        console.error(`[MAILBOX ASSIGNMENT] Lead ${enrollment.lead_id} still has NULL mailbox_id after race condition. Update error: ${updateError?.message || 'No error'}`);
        throw new Error(`Failed to assign mailbox for lead ${enrollment.lead_id}: mailbox_id is still NULL after race condition. This may indicate a database consistency issue.`);
      }

      // Get the assigned mailbox
      const { data: assignedMailbox, error: mailboxError } = await supabase
        .from('mailboxes')
        .select('*')
        .eq('id', reloadedLead.mailbox_id)
        .single();

      if (mailboxError || !assignedMailbox) {
        throw new Error(`Assigned mailbox ${reloadedLead.mailbox_id} not found: ${mailboxError?.message}`);
      }

      mailbox = assignedMailbox as Mailbox;
      console.log(`[MAILBOX DIST] Enrollment ${enrollment.id.substring(0, 8)}: Using already-assigned mailbox ${mailbox.id.substring(0, 8)} (race condition - another worker assigned first)`);
    } else {
      mailbox = selectedMailbox;
      console.log(`[MAILBOX DIST] Enrollment ${enrollment.id.substring(0, 8)}: Successfully assigned mailbox ${mailbox.id.substring(0, 8)} to lead (first email)`);
    }
  } else {
    // Subsequent email node - use assigned mailbox
    // Validate mailbox is still assigned to campaign and available
    const { data: assignedMailbox, error: mailboxError } = await supabase
      .from('mailboxes')
      .select('*')
      .eq('id', lead.mailbox_id)
      .single();

    if (mailboxError || !assignedMailbox) {
      throw new Error(`Assigned mailbox ${lead.mailbox_id} not found for lead ${enrollment.lead_id}: ${mailboxError?.message}`);
    }

    // Check mailbox is still assigned to campaign
    const { data: campaignMailbox, error: campaignMailboxError } = await supabase
      .from('campaign_mailboxes')
      .select('mailbox_id')
      .eq('campaign_id', enrollment.campaign_id)
      .eq('mailbox_id', lead.mailbox_id)
      .maybeSingle();

    if (campaignMailboxError) {
      throw new Error(`Failed to verify mailbox assignment: ${campaignMailboxError.message}`);
    }

    if (!campaignMailbox) {
      throw new Error(`Mailbox ${lead.mailbox_id} is no longer assigned to campaign ${enrollment.campaign_id} (lead ${enrollment.lead_id})`);
    }

    // Check mailbox is available
    if (assignedMailbox.status !== 'connected' || assignedMailbox.smtp_status !== 'active') {
      throw new Error(`Assigned mailbox ${lead.mailbox_id} is not available (status: ${assignedMailbox.status}, smtp_status: ${assignedMailbox.smtp_status})`);
    }

    mailbox = assignedMailbox as Mailbox;
    console.log(`[MAILBOX DIST] Enrollment ${enrollment.id.substring(0, 8)}: Using already-assigned mailbox ${mailbox.id.substring(0, 8)} (lead already had mailbox)`);
  }

  // 3. Diagnose interval availability before attempting assignment
  await diagnoseIntervalAvailability(enrollment.campaign_id, mailbox.id, supabase);

  // 4. Detailed query to see what intervals would match the assignment criteria
  const now = new Date().toISOString();
  const { data: candidateIntervals, error: candidateError } = await supabase
    .from('campaign_intervals')
    .select(`
      id,
      interval_time,
      status,
      locked_at,
      locked_by
    `)
    .eq('campaign_id', enrollment.campaign_id)
    .gt('interval_time', now)
    .order('interval_time', { ascending: true })
    .limit(10);

  if (!candidateError && candidateIntervals) {
    console.log(`[INTERVAL ASSIGNMENT DEBUG] Found ${candidateIntervals.length} future intervals:`);
    for (const interval of candidateIntervals) {
      // Check if this interval would pass the sequential check
      const { data: blockingIntervals } = await supabase
        .from('campaign_intervals')
        .select('id, interval_time, status')
        .eq('campaign_id', enrollment.campaign_id)
        .lt('interval_time', interval.interval_time)
        .gte('interval_time', now)
        .neq('status', 'completed')
        .limit(1);

      // Check if mailbox already has job in this interval
      const { data: existingJob } = await supabase
        .from('message_jobs')
        .select('id, status')
        .eq('interval_id', interval.id)
        .eq('mailbox_id', mailbox.id)
        .in('status', ['pending', 'reserved', 'sending', 'sent', 'failed'])
        .maybeSingle();

      const isBlocked = (blockingIntervals?.length || 0) > 0;
      const mailboxHasJob = existingJob !== null;
      const isAssignable = !isBlocked && 
        (interval.status === 'available' || 
         (interval.status === 'scheduled' && !mailboxHasJob));

      console.log(`  - ${interval.interval_time} | status: ${interval.status} | blocked: ${isBlocked} | mailbox_has_job: ${mailboxHasJob} | assignable: ${isAssignable}`);
      if (isBlocked && blockingIntervals && blockingIntervals.length > 0) {
        console.log(`    └─ BLOCKED by: ${blockingIntervals[0].interval_time} (${blockingIntervals[0].status})`);
      }
      if (interval.status === 'scheduled' && mailboxHasJob) {
        console.log(`    └─ Mailbox already has job: ${existingJob?.id.substring(0, 8)} (${existingJob?.status})`);
      }
    }
  }

  // 5. Check if first interval can be locked (diagnostic)
  if (candidateIntervals && candidateIntervals.length > 0) {
    const firstInterval = candidateIntervals[0];
    if (firstInterval.status === 'scheduled') {
      // Check if this mailbox already has a job
      const { data: mailboxJobCheck } = await supabase
        .from('message_jobs')
        .select('id, status')
        .eq('interval_id', firstInterval.id)
        .eq('mailbox_id', mailbox.id)
        .in('status', ['pending', 'reserved', 'sending', 'sent', 'failed'])
        .maybeSingle();
      
      // Check if interval is currently locked
      const { data: intervalStatus } = await supabase
        .from('campaign_intervals')
        .select('status, locked_at, locked_by')
        .eq('id', firstInterval.id)
        .single();
      
      console.log(`[INTERVAL ASSIGNMENT DEBUG] First interval ${firstInterval.interval_time}: status=${intervalStatus?.status}, locked_at=${intervalStatus?.locked_at}, mailbox_has_job=${mailboxJobCheck !== null}`);
      
      // Check for blocking intervals
      const { data: blockingCheck } = await supabase
        .from('campaign_intervals')
        .select('id, interval_time, status')
        .eq('campaign_id', enrollment.campaign_id)
        .lt('interval_time', firstInterval.interval_time)
        .gte('interval_time', now)
        .neq('status', 'completed')
        .limit(1);
      
      console.log(`[INTERVAL ASSIGNMENT DEBUG] Sequential check: ${blockingCheck?.length || 0} blocking interval(s)`);
    }
  }

  // 6. Atomically assign message_job to interval
  // This function: locks interval, checks mailbox, creates job, releases lock
  // All in a single atomic transaction
  const workerId = process.env.WORKER_ID || 'scheduler';
  console.log(`[INTERVAL ASSIGNMENT] Attempting to assign job for campaign ${enrollment.campaign_id.substring(0, 8)}, mailbox ${mailbox.id.substring(0, 8)}`);
  
  const { data: result, error: assignError } = await supabase
    .rpc('assign_message_job_to_interval', {
    p_enrollment_id: enrollment.id,
    p_campaign_id: enrollment.campaign_id,
    p_lead_id: enrollment.lead_id,
    p_mailbox_id: mailbox.id,
    p_node_id: node.id,
    p_message_data: {
      node_config: node.node_data || {},
      lead_data: {
        email: lead.email,
        name: lead.name,
        first_name: lead.first_name,
        last_name: lead.last_name,
        },
      },
      p_jitter_percentage: jitterPercentage,
      p_worker_id: workerId
    });

  if (assignError) {
    console.error(`[INTERVAL ASSIGNMENT] RPC error for enrollment ${enrollment.id.substring(0, 8)}, mailbox ${mailbox.id.substring(0, 8)}: ${assignError.message}`);
    throw new Error(`Failed to assign message_job to interval: ${assignError.message}`);
  }

  console.log(`[INTERVAL ASSIGNMENT] RPC call completed for enrollment ${enrollment.id.substring(0, 8)}, mailbox ${mailbox.id.substring(0, 8)}. Result: ${result?.length || 0} row(s)`);

  if (!result || result.length === 0) {
    // No intervals available - debug why
    console.log(`[INTERVAL ASSIGNMENT DEBUG] RPC returned empty. Checking why...`);
    
    // Query again to see current state (may have changed during RPC call)
    const { data: intervalsAfter, error: intervalsAfterError } = await supabase
      .from('campaign_intervals')
      .select(`
        id,
        interval_time,
        status,
        locked_at,
        locked_by
      `)
      .eq('campaign_id', enrollment.campaign_id)
      .gt('interval_time', now)
      .order('interval_time', { ascending: true })
      .limit(5);

    if (!intervalsAfterError && intervalsAfter) {
      console.log(`[INTERVAL ASSIGNMENT DEBUG] After RPC call, ${intervalsAfter.length} future intervals exist:`);
      for (const interval of intervalsAfter) {
        // Re-check blocking and mailbox status
        const { data: blockingAfter } = await supabase
          .from('campaign_intervals')
          .select('id, interval_time, status')
          .eq('campaign_id', enrollment.campaign_id)
          .lt('interval_time', interval.interval_time)
          .gte('interval_time', now)
          .neq('status', 'completed')
          .limit(1);

        const { data: mailboxJobAfter } = await supabase
          .from('message_jobs')
          .select('id, status')
          .eq('interval_id', interval.id)
          .eq('mailbox_id', mailbox.id)
          .in('status', ['pending', 'reserved', 'sending', 'sent', 'failed'])
          .maybeSingle();

        const blocked = (blockingAfter?.length || 0) > 0;
        const hasJob = mailboxJobAfter !== null;
        const assignable = !blocked && 
          (interval.status === 'available' || 
           (interval.status === 'scheduled' && !hasJob));

        console.log(`  - ${interval.interval_time} | status: ${interval.status} | locked: ${interval.locked_at ? 'YES' : 'NO'} | blocked: ${blocked} | has_job: ${hasJob} | assignable: ${assignable}`);
      }
    }

    // Check total eligible mailboxes to see if all have jobs in first interval
    const { data: campaignMailboxes } = await supabase
      .from('campaign_mailboxes')
      .select(`
        mailbox_id,
        mailbox:mailboxes!inner(status, smtp_status)
      `)
      .eq('campaign_id', enrollment.campaign_id);

    const eligibleMailboxes = campaignMailboxes?.filter((cm: any) => 
      cm.mailbox?.status === 'connected' && cm.mailbox?.smtp_status === 'active'
    ) || [];

    console.log(`[INTERVAL ASSIGNMENT DEBUG] Campaign has ${eligibleMailboxes.length} eligible mailbox(es) (this mailbox: ${mailbox.id.substring(0, 8)})`);

    if (intervalsAfter && intervalsAfter.length > 0) {
      const firstInterval = intervalsAfter[0];
      
      // Get all mailboxes that have jobs in this interval
      const { data: allMailboxJobs } = await supabase
        .from('message_jobs')
        .select('mailbox_id, status')
        .eq('interval_id', firstInterval.id)
        .in('status', ['pending', 'reserved', 'sending', 'sent', 'failed']);

      const mailboxIdsWithJobs = new Set(allMailboxJobs?.map(j => j.mailbox_id) || []);
      const missingMailboxes = eligibleMailboxes.filter((cm: any) => !mailboxIdsWithJobs.has(cm.mailbox_id));

      // Check if first interval is currently locked
      const { data: firstIntervalStatus } = await supabase
        .from('campaign_intervals')
        .select('status, locked_at, locked_by')
        .eq('id', firstInterval.id)
        .single();

      console.log(`[INTERVAL ASSIGNMENT DEBUG] First interval ${firstInterval.interval_time} status: ${firstIntervalStatus?.status}, locked: ${firstIntervalStatus?.locked_at ? 'YES by ' + firstIntervalStatus?.locked_by : 'NO'}, has ${mailboxIdsWithJobs.size}/${eligibleMailboxes.length} mailbox jobs`);
      
      if (missingMailboxes.length > 0) {
        console.log(`[INTERVAL ASSIGNMENT DEBUG] ⚠️ First interval missing ${missingMailboxes.length} mailbox assignment(s) - this is why other intervals are blocked`);
        console.log(`[INTERVAL ASSIGNMENT DEBUG] Missing mailboxes: ${missingMailboxes.map((cm: any) => cm.mailbox_id.substring(0, 8)).join(', ')}`);
        console.log(`[INTERVAL ASSIGNMENT DEBUG] Current mailbox ${mailbox.id.substring(0, 8)} ${mailboxIdsWithJobs.has(mailbox.id) ? 'HAS' : 'DOES NOT HAVE'} a job in this interval`);
      }
    }

    // No intervals available - this is expected and normal
    // Interval maintenance runs every minute, so intervals may temporarily be exhausted
    // between maintenance cycles. This is not an error condition.
    
    // Update enrollment to retry in 5 minutes
    const retryAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    
    await supabase
      .from('enrollments')
      .update({
        next_run_at: retryAt,
      })
      .eq('id', enrollment.id)
      .eq('state', 'active'); // Only update active enrollments
    
    console.log(`[INTERVAL ASSIGNMENT] No intervals available for campaign ${enrollment.campaign_id.substring(0, 8)}. Enrollment will retry at ${retryAt}`);
    
    // Throw a specific error type that indicates this is a normal deferral (not a real error)
    // The caller will handle this silently without logging it as an error
    const deferError: any = new Error('DEFER_ENROLLMENT');
    deferError.isDeferral = true;
    deferError.retryAt = retryAt;
    throw deferError;
  }

  console.log(`[INTERVAL ASSIGNMENT] ✅ Successfully assigned job to interval ${result[0].interval_id} for enrollment ${enrollment.id.substring(0, 8)}, mailbox ${mailbox.id.substring(0, 8)}`);

  const jobResult = result[0] as any;

  if (!jobResult.is_new_job) {
    console.log(`[MAILBOX ASSIGNMENT] Mailbox ${mailbox.id} already has job in interval ${jobResult.interval_id}. Using existing job.`);
  }

  // Extract message job (without is_new_job field)
  const messageJob: MessageJob = {
    id: jobResult.id,
    enrollment_id: jobResult.enrollment_id,
    campaign_id: jobResult.campaign_id,
    lead_id: jobResult.lead_id,
    mailbox_id: jobResult.mailbox_id,
    node_id: jobResult.node_id,
    interval_id: jobResult.interval_id,
    status: jobResult.status,
    scheduled_at: jobResult.scheduled_at,
    message_data: jobResult.message_data,
  };

  // 4. Message job created - send workers will poll database directly using claim_message_jobs_ready RPC function
  // No SQS push needed - jobs are polled directly from database
  
  return messageJob;
}
