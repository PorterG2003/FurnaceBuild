# Campaign Intervals Implementation Plan

## Overview

This plan implements a campaign intervals system that pre-creates time slots and uses atomic locking to ensure one message_job per mailbox per interval. This eliminates race conditions and simplifies slot-based scheduling.

## Goals

1. Pre-create campaign intervals (20+ ahead)
2. Atomic interval locking prevents race conditions
3. Guarantee one mailbox per interval
4. Simplify email node scheduling logic
5. Maintain intervals automatically

## Architecture Changes

### Current Flow
```
Scheduler → Calculate slot → Apply jitter → Atomic slot check → Create job
```

### New Flow
```
Scheduler → Lock interval → Check mailbox → Create job
```

### Worker Architecture

**Key Point**: We don't need more workers, but we do need tighter load control inside each scheduler worker instance:

1. **Main Loop** (existing): Processes enrollments in parallel using `Promise.allSettled`
2. **Interval Maintenance**: Background timer that runs every minute
3. **Processed Interval Check**: Background timer that runs every minute
4. **Stale Lock Cleanup**: Background timer that runs every 5 minutes
5. **Batch Interval Assignment**: Background timer that runs every 30 seconds

All tasks run in the same worker instance, but each periodic task should be **single-flight**. If a timer fires while the previous run is still active, the worker should skip that overlapping tick instead of stacking more Supabase work onto the system.

## Phase 1: Database Schema

### 1.1 Create `campaign_intervals` Table

**Migration**: `supabase/migrations/YYYYMMDDHHMMSS_create_campaign_intervals.sql`

```sql
-- ============================================
-- Migration: Create campaign_intervals table
-- ============================================
-- Pre-created time slots for campaigns
-- Scheduler locks intervals and assigns one message_job per mailbox per interval

CREATE TABLE IF NOT EXISTS campaign_intervals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  
  -- Interval time boundaries
  interval_start TIMESTAMPTZ NOT NULL,
  interval_end TIMESTAMPTZ NOT NULL,
  
  -- Status tracking
  status TEXT NOT NULL DEFAULT 'available', 
    -- 'available': Ready to be locked
    -- 'locked': Currently being processed by a scheduler
    -- 'scheduled': Has message_jobs assigned
    -- 'completed': All jobs sent (optional, for cleanup)
  
  -- Locking information
  locked_at TIMESTAMPTZ, -- Timestamp when lock was acquired (for stale lock detection)
  locked_by TEXT, -- Worker instance ID or process identifier (for debugging)
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT campaign_intervals_status_check 
    CHECK (status IN ('available', 'locked', 'scheduled', 'completed')),
  CONSTRAINT campaign_intervals_time_check 
    CHECK (interval_end > interval_start),
  
  -- One interval per campaign per start time
  UNIQUE(campaign_id, interval_start)
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_campaign_intervals_campaign_status 
  ON campaign_intervals(campaign_id, status, interval_start);

CREATE INDEX IF NOT EXISTS idx_campaign_intervals_campaign_start 
  ON campaign_intervals(campaign_id, interval_start);

CREATE INDEX IF NOT EXISTS idx_campaign_intervals_status_start 
  ON campaign_intervals(status, interval_start) 
  WHERE status = 'available';

-- Comments
COMMENT ON TABLE campaign_intervals IS 'Pre-created time slots for campaigns. Scheduler locks intervals and assigns one message_job per mailbox per interval.';
COMMENT ON COLUMN campaign_intervals.status IS 'available: Ready to lock, locked: Being processed, scheduled: Has jobs, completed: All sent';
COMMENT ON COLUMN campaign_intervals.locked_by IS 'Worker instance identifier for debugging and stale lock detection';
```

### 1.2 Add `interval_id` to `message_jobs` (Optional but Recommended)

**Migration**: `supabase/migrations/YYYYMMDDHHMMSS_add_interval_id_to_message_jobs.sql`

```sql
-- ============================================
-- Migration: Add interval_id to message_jobs
-- ============================================
-- Track which interval a message_job belongs to
-- Helps with debugging and ensures one mailbox per interval

ALTER TABLE message_jobs 
  ADD COLUMN IF NOT EXISTS interval_id UUID REFERENCES campaign_intervals(id);

CREATE INDEX IF NOT EXISTS idx_message_jobs_interval_id 
  ON message_jobs(interval_id);

CREATE INDEX IF NOT EXISTS idx_message_jobs_mailbox_interval 
  ON message_jobs(mailbox_id, interval_id) 
  WHERE interval_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_message_jobs_enrollment_node_status
  ON message_jobs(enrollment_id, node_id, status);

COMMENT ON COLUMN message_jobs.interval_id IS 'Campaign interval this message_job belongs to. Ensures one mailbox per interval.';
```

The additional `(enrollment_id, node_id, status)` index supports the scheduler's batched duplicate-check path before `batch_assign_jobs_to_interval` runs. That lookup should use one RPC-backed query for many candidate pairs instead of one REST query per enrollment.

### 1.3 Create Atomic Interval Assignment Function

**Migration**: `supabase/migrations/YYYYMMDDHHMMSS_create_assign_message_job_to_interval_function.sql`

```sql
-- ============================================
-- Migration: Create assign_message_job_to_interval function
-- ============================================
-- Atomically: locks interval, checks mailbox, creates message_job
-- Returns the created message_job or existing job if mailbox already assigned
-- This ensures the entire operation is atomic - no race conditions

CREATE OR REPLACE FUNCTION assign_message_job_to_interval(
  p_enrollment_id UUID,
  p_campaign_id UUID,
  p_lead_id UUID,
  p_mailbox_id UUID,
  p_node_id UUID,
  p_message_data JSONB,
  p_jitter_percentage NUMERIC DEFAULT 10.0,
  p_worker_id TEXT DEFAULT 'scheduler'
)
RETURNS TABLE (
  id UUID,
  enrollment_id UUID,
  campaign_id UUID,
  lead_id UUID,
  mailbox_id UUID,
  node_id UUID,
  interval_id UUID,
  status TEXT,
  scheduled_at TIMESTAMPTZ,
  message_data JSONB,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  is_new_job BOOLEAN
) AS $$
DECLARE
  v_interval_id UUID;
  v_interval_start TIMESTAMPTZ;
  v_interval_end TIMESTAMPTZ;
  v_existing_job_id UUID;
  v_new_job_id UUID;
  v_scheduled_at TIMESTAMPTZ;
  v_interval_duration_seconds NUMERIC;
  v_jitter_range_seconds NUMERIC;
  v_jitter_offset_seconds NUMERIC;
  v_base_time TIMESTAMPTZ;
BEGIN
  -- Step 1: Atomically lock next available interval
  UPDATE campaign_intervals
  SET 
    status = 'locked',
    locked_at = NOW(),
    locked_by = p_worker_id,
    updated_at = NOW()
  WHERE id = (
    SELECT ci.id
    FROM campaign_intervals ci
    WHERE ci.campaign_id = p_campaign_id
      AND ci.status = 'available'
      AND ci.interval_start > NOW() -- Only future intervals
    ORDER BY ci.interval_start ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED -- Prevent concurrent locks
  )
  RETURNING 
    campaign_intervals.id,
    campaign_intervals.interval_start,
    campaign_intervals.interval_end
  INTO v_interval_id, v_interval_start, v_interval_end;
  
  -- If no interval was locked, return empty
  IF v_interval_id IS NULL THEN
    RETURN;
  END IF;
  
  -- Step 2: Check if mailbox already has job in this interval (atomic check)
  SELECT mj.id INTO v_existing_job_id
  FROM message_jobs mj
  WHERE mj.mailbox_id = p_mailbox_id
    AND mj.interval_id = v_interval_id
    AND mj.status IN ('pending', 'reserved', 'sending')
  LIMIT 1
  FOR UPDATE; -- Lock the row if it exists
  
  -- Step 3: If mailbox already has job, return existing job and release interval
  IF v_existing_job_id IS NOT NULL THEN
    -- Release interval lock (mark as scheduled since it has a job)
    UPDATE campaign_intervals
    SET 
      status = 'scheduled',
      locked_at = NULL,
      locked_by = NULL,
      updated_at = NOW()
    WHERE id = v_interval_id;
    
    -- Return existing job
    RETURN QUERY
    SELECT 
      mj.id,
      mj.enrollment_id,
      mj.campaign_id,
      mj.lead_id,
      mj.mailbox_id,
      mj.node_id,
      mj.interval_id,
      mj.status,
      mj.scheduled_at,
      mj.message_data,
      mj.created_at,
      mj.updated_at,
      false AS is_new_job
    FROM message_jobs mj
    WHERE mj.id = v_existing_job_id;
    
    RETURN;
  END IF;
  
  -- Step 4: Mailbox doesn't have job - calculate scheduled_at with jitter within interval
  -- Calculate base time (middle of interval)
  v_interval_duration_seconds := EXTRACT(EPOCH FROM (v_interval_end - v_interval_start));
  v_base_time := v_interval_start + (v_interval_duration_seconds / 2) * INTERVAL '1 second';
  
  -- Calculate jitter within interval bounds
  v_jitter_range_seconds := v_interval_duration_seconds * (p_jitter_percentage / 100.0);
  -- Random jitter: -jitter_range to +jitter_range
  v_jitter_offset_seconds := (RANDOM() * 2 - 1) * v_jitter_range_seconds;
  v_scheduled_at := v_base_time + (v_jitter_offset_seconds || ' seconds')::INTERVAL;
  
  -- Clamp to interval bounds
  IF v_scheduled_at < v_interval_start THEN
    v_scheduled_at := v_interval_start;
  END IF;
  IF v_scheduled_at > v_interval_end THEN
    v_scheduled_at := v_interval_end;
  END IF;
  
  -- Step 5: Create new message_job
  INSERT INTO message_jobs (
    enrollment_id,
    campaign_id,
    lead_id,
    mailbox_id,
    node_id,
    interval_id,
    scheduled_at,
    status,
    message_data
  )
  VALUES (
    p_enrollment_id,
    p_campaign_id,
    p_lead_id,
    p_mailbox_id,
    p_node_id,
    v_interval_id,
    v_scheduled_at,
    'pending',
    p_message_data
  )
  RETURNING message_jobs.id INTO v_new_job_id;
  
  -- Step 5: Mark interval as scheduled and release lock
  UPDATE campaign_intervals
  SET 
    status = 'scheduled',
    locked_at = NULL,
    locked_by = NULL,
    updated_at = NOW()
  WHERE id = v_interval_id;
  
  -- Step 6: Return new job
  RETURN QUERY
  SELECT 
    mj.id,
    mj.enrollment_id,
    mj.campaign_id,
    mj.lead_id,
    mj.mailbox_id,
    mj.node_id,
    mj.interval_id,
    mj.status,
    mj.scheduled_at,
    mj.message_data,
    mj.created_at,
    mj.updated_at,
    true AS is_new_job
  FROM message_jobs mj
  WHERE mj.id = v_new_job_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION assign_message_job_to_interval IS 'Atomically locks interval, checks mailbox, and creates message_job. Ensures one mailbox per interval. Returns existing job if mailbox already assigned.';

**Why we need `locked_at` and `locked_by` fields**:

Even though the function is atomic, we still need these fields for:

1. **Stale Lock Cleanup** (REQUIRED)
   - If database connection is lost mid-transaction, the lock remains
   - Cleanup function needs `locked_at` to detect locks older than timeout
   - Without `locked_at`, we can't tell how long a lock has been held

2. **Debugging** (Helpful)
   - `locked_by` identifies which worker held a lock if issues occur
   - Useful for troubleshooting when locks aren't released

3. **Monitoring** (Helpful)
   - Can detect if locks are held too long (indicates problems)
   - Can alert if locks are held > 1 second (should be milliseconds)

4. **Edge Cases** (Safety net)
   - Database deadlocks can hold locks until resolved
   - Long-running functions hold locks for their duration
   - Database crashes/recovery may not release locks properly

**In normal operation**: Locks are held for milliseconds and immediately released, so these fields are rarely seen. But they're essential for handling edge cases and stale lock cleanup.
```

**Note**: This function handles the entire flow atomically:
1. Locks interval (sets `locked_at` and `locked_by`)
2. Checks if mailbox has job
3. Creates job if needed
4. Releases lock (clears `locked_at` and `locked_by`)

All in a single transaction - no race conditions possible.

**Why we still need `locked_at` and `locked_by`**:
- **Stale lock cleanup**: If database connection is lost mid-transaction, lock remains. Cleanup function needs `locked_at` to detect stale locks.
- **Debugging**: `locked_by` identifies which worker held a lock if issues occur.
- **Monitoring**: Can detect if locks are held too long (indicates problems).
- **Edge cases**: Database deadlocks, long-running functions, or crashes can leave locks in place.

In normal operation, locks are held for milliseconds and immediately released, so these fields are rarely seen. But they're essential for handling edge cases.

### 1.4 Create Interval Release Function (Optional - for error handling)

**Migration**: `supabase/migrations/YYYYMMDDHHMMSS_create_release_campaign_interval_function.sql`

```sql
-- ============================================
-- Migration: Create release_campaign_interval function
-- ============================================
-- Releases a locked interval (for error handling only)
-- Note: The assign_message_job_to_interval function handles normal release
-- This is only needed if we need to manually release a lock (e.g., on error)

CREATE OR REPLACE FUNCTION release_campaign_interval(
  p_interval_id UUID,
  p_new_status TEXT DEFAULT 'available'
)
RETURNS VOID AS $$
BEGIN
  -- Validate status
  IF p_new_status NOT IN ('available', 'scheduled') THEN
    RAISE EXCEPTION 'Invalid status: %', p_new_status;
  END IF;
  
  -- Release the lock
  UPDATE campaign_intervals
  SET 
    status = p_new_status,
    locked_at = NULL,
    locked_by = NULL,
    updated_at = NOW()
  WHERE id = p_interval_id
    AND status = 'locked'; -- Only release if currently locked
  
  IF NOT FOUND THEN
    RAISE WARNING 'Interval % was not locked or does not exist', p_interval_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION release_campaign_interval IS 'Releases a locked interval (for error handling). Normal flow uses assign_message_job_to_interval which handles release automatically.';
```

**Note**: This function is optional and only needed for error handling. The main `assign_message_job_to_interval` function handles interval locking and releasing automatically.

### 1.5 Create Stale Lock Cleanup Function

**Migration**: `supabase/migrations/YYYYMMDDHHMMSS_create_cleanup_stale_interval_locks_function.sql`

```sql
-- ============================================
-- Migration: Create cleanup_stale_interval_locks function
-- ============================================
-- Releases intervals that have been locked for too long (stale locks)
-- Should be run periodically (e.g., every 5 minutes)
--
-- Why we need locked_at even with atomic function:
-- 1. Database connection lost mid-transaction → lock left in place
-- 2. Database deadlock → lock held until resolved
-- 3. Long-running function → lock held for duration
-- 4. Database crash/recovery → locks may not be released
--
-- locked_at is REQUIRED for this function to work

CREATE OR REPLACE FUNCTION cleanup_stale_interval_locks(
  p_lock_timeout_minutes INTEGER DEFAULT 5
)
RETURNS INTEGER AS $$
DECLARE
  v_released_count INTEGER;
BEGIN
  -- Release intervals locked for more than timeout
  -- locked_at is REQUIRED here - we need to know how long lock has been held
  UPDATE campaign_intervals
  SET 
    status = 'available',
    locked_at = NULL,
    locked_by = NULL,
    updated_at = NOW()
  WHERE status = 'locked'
    AND locked_at < NOW() - (p_lock_timeout_minutes || ' minutes')::INTERVAL;
  
  GET DIAGNOSTICS v_released_count = ROW_COUNT;
  
  RETURN v_released_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION cleanup_stale_interval_locks IS 'Releases intervals that have been locked for longer than the timeout. Prevents deadlocks from crashed workers. REQUIRES locked_at field to determine lock age.';
```

## Phase 2: Scheduler Worker Changes

### 2.1 Create Interval Management Module

**File**: `workers/scheduler-worker/src/interval-management.ts`

```typescript
import { SupabaseClient } from '@supabase/supabase-js';
import type { CampaignSchedule } from './types.js';

export interface CampaignInterval {
  id: string;
  campaign_id: string;
  interval_start: string;
  interval_end: string;
  status: 'available' | 'locked' | 'scheduled' | 'completed';
}

const MIN_INTERVALS_AHEAD = 20;
const INTERVAL_MAINTENANCE_INTERVAL_MS = 60000; // 1 minute

/**
 * Maintain campaign intervals - ensure we have enough intervals ahead
 */
export async function maintainCampaignIntervals(
  supabase: SupabaseClient
): Promise<void> {
  // Get all active campaigns
  const { data: campaigns, error } = await supabase
    .from('campaigns')
    .select('id, sending_interval_seconds, created_at, schedule')
    .not('sending_interval_seconds', 'is', null);
  
  if (error) {
    console.error('Error loading campaigns for interval maintenance:', error);
    return;
  }
  
  if (!campaigns || campaigns.length === 0) {
    return;
  }
  
  for (const campaign of campaigns) {
    try {
      await ensureCampaignIntervals(
        campaign.id,
        campaign.sending_interval_seconds,
        campaign.created_at,
        campaign.schedule,
        MIN_INTERVALS_AHEAD,
        supabase
      );
    } catch (error) {
      console.error(`Error maintaining intervals for campaign ${campaign.id}:`, error);
    }
  }
}

/**
 * Ensure a campaign has enough intervals ahead
 */
async function ensureCampaignIntervals(
  campaignId: string,
  intervalSeconds: number,
  campaignStartTime: string,
  schedule: CampaignSchedule | null,
  minIntervalsAhead: number,
  supabase: SupabaseClient
): Promise<void> {
  // Get latest interval for this campaign
  const { data: latestInterval, error: latestError } = await supabase
    .from('campaign_intervals')
    .select('interval_end')
    .eq('campaign_id', campaignId)
    .order('interval_end', { ascending: false })
    .limit(1)
    .maybeSingle();
  
  if (latestError) {
    throw new Error(`Failed to get latest interval: ${latestError.message}`);
  }
  
  const now = new Date();
  const latestEnd = latestInterval 
    ? new Date(latestInterval.interval_end)
    : new Date(campaignStartTime);
  
  // Calculate how many intervals we have ahead
  const intervalsAhead = Math.floor(
    (latestEnd.getTime() - now.getTime()) / (intervalSeconds * 1000)
  );
  
  if (intervalsAhead >= minIntervalsAhead) {
    return; // We have enough intervals
  }
  
  // Calculate how many intervals to create
  const intervalsToCreate = minIntervalsAhead - intervalsAhead + 5; // Add buffer
  
  // Create intervals
  await createCampaignIntervals(
    campaignId,
    latestEnd,
    intervalsToCreate,
    intervalSeconds,
    schedule,
    supabase
  );
}

/**
 * Create campaign intervals
 */
async function createCampaignIntervals(
  campaignId: string,
  startFrom: Date,
  count: number,
  intervalSeconds: number,
  schedule: CampaignSchedule | null,
  supabase: SupabaseClient
): Promise<void> {
  const intervals = [];
  let currentStart = new Date(startFrom);
  
  for (let i = 0; i < count; i++) {
    // Calculate interval boundaries
    let intervalStart = new Date(currentStart);
    let intervalEnd = new Date(currentStart.getTime() + (intervalSeconds * 1000));
    
    // Apply schedule constraints if needed
    if (schedule) {
      const adjusted = adjustIntervalForSchedule(
        intervalStart,
        intervalEnd,
        schedule
      );
      intervalStart = adjusted.start;
      intervalEnd = adjusted.end;
    }
    
    intervals.push({
      campaign_id: campaignId,
      interval_start: intervalStart.toISOString(),
      interval_end: intervalEnd.toISOString(),
      status: 'available'
    });
    
    currentStart = intervalEnd;
  }
  
  // Insert intervals (ignore conflicts for idempotency)
  const { error } = await supabase
    .from('campaign_intervals')
    .upsert(intervals, {
      onConflict: 'campaign_id,interval_start',
      ignoreDuplicates: true
    });
  
  if (error) {
    throw new Error(`Failed to create intervals: ${error.message}`);
  }
  
  console.log(`Created ${intervals.length} intervals for campaign ${campaignId}`);
}

/**
 * Adjust interval boundaries to fit within schedule
 */
function adjustIntervalForSchedule(
  start: Date,
  end: Date,
  schedule: CampaignSchedule
): { start: Date, end: Date } {
  // TODO: Implement schedule constraint logic
  // For now, return as-is
  // In future: adjust to fit within schedule windows
  return { start, end };
}
```

### 2.2 Update Email Handler

**File**: `workers/scheduler-worker/src/node-handlers/email-handler.ts`

Replace the current `handleEmailNode` function:

```typescript
import { SupabaseClient } from '@supabase/supabase-js';
import type { Enrollment, MessageJob, Lead, Mailbox, Campaign } from '../types.js';
import { selectMailbox } from '../mailbox-selection.js';
import { calculateScheduledAtInInterval } from '../scheduling.js';

/**
 * Handle email node: create message_job using campaign intervals
 * 
 * This function:
 * 1. Assigns mailbox to lead (if needed)
 * 2. Locks next available campaign interval
 * 3. Checks if mailbox already has job in interval
 * 4. Creates message_job if needed
 * 5. Releases interval lock
 */
export async function handleEmailNode(
  enrollment: Enrollment,
  node: any,
  campaign: Campaign,
  rotationIndex: number,
  jitterPercentage: number,
  supabase: SupabaseClient
): Promise<MessageJob> {
  // 1. Load lead data
  const { data: lead, error: leadError } = await supabase
    .from('leads')
    .select('*')
    .eq('id', enrollment.lead_id)
    .single();
  
  if (leadError || !lead) {
    throw new Error(`Lead ${enrollment.lead_id} not found: ${leadError?.message || 'Lead not found'}`);
  }

  // 2. Assign mailbox (if needed) - same logic as before
  let mailbox: Mailbox;
  
  if (!lead.mailbox_id) {
    // First email - assign mailbox
    const selectedMailbox = await selectMailbox(enrollment.campaign_id, supabase, rotationIndex);
    
    if (!selectedMailbox) {
      throw new Error(`No available mailbox found for campaign ${enrollment.campaign_id}`);
    }

    // Atomically assign mailbox
    const { data: updatedLead, error: updateError } = await supabase
      .from('leads')
      .update({ mailbox_id: selectedMailbox.id })
      .eq('id', enrollment.lead_id)
      .is('mailbox_id', null)
      .select()
      .single();

    if (updateError || !updatedLead) {
      // Race condition - reload lead
      const { data: reloadedLead } = await supabase
        .from('leads')
        .select('*')
        .eq('id', enrollment.lead_id)
        .single();

      if (!reloadedLead?.mailbox_id) {
        throw new Error(`Failed to assign mailbox for lead ${enrollment.lead_id}`);
      }

      const { data: assignedMailbox } = await supabase
        .from('mailboxes')
        .select('*')
        .eq('id', reloadedLead.mailbox_id)
        .single();

      if (!assignedMailbox) {
        throw new Error(`Assigned mailbox ${reloadedLead.mailbox_id} not found`);
      }

      mailbox = assignedMailbox as Mailbox;
    } else {
      mailbox = selectedMailbox;
    }
  } else {
    // Subsequent email - use assigned mailbox
    const { data: assignedMailbox, error: mailboxError } = await supabase
      .from('mailboxes')
      .select('*')
      .eq('id', lead.mailbox_id)
      .single();

    if (mailboxError || !assignedMailbox) {
      throw new Error(`Assigned mailbox ${lead.mailbox_id} not found: ${mailboxError?.message}`);
    }

    mailbox = assignedMailbox as Mailbox;
  }

  // 3. Atomically assign message_job to interval
  // This function does everything atomically:
  // - Locks next available interval
  // - Checks if mailbox already has job in interval
  // - Creates message_job if needed (with jitter within interval)
  // - Releases interval lock
  // All in a single database transaction - no race conditions possible
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
      p_worker_id: process.env.WORKER_ID || 'scheduler'
    });

  if (assignError) {
    throw new Error(`Failed to assign message_job to interval: ${assignError.message}`);
  }

  if (!result || result.length === 0) {
    throw new Error(`No available intervals for campaign ${enrollment.campaign_id}. Interval maintenance may not be running.`);
  }

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
    status: jobResult.status,
    scheduled_at: jobResult.scheduled_at,
    message_data: jobResult.message_data,
  };

  return messageJob;
}
```

### 2.3 Add Scheduling Helper Function

**File**: `workers/scheduler-worker/src/scheduling.ts`

Add new function:

```typescript
/**
 * Calculate scheduled_at within an interval, applying jitter
 */
export function calculateScheduledAtInInterval(
  intervalStart: Date,
  intervalEnd: Date,
  schedule: CampaignSchedule | null,
  jitterPercentage: number
): string {
  // Base time is middle of interval
  const intervalDuration = intervalEnd.getTime() - intervalStart.getTime();
  const baseTime = new Date(intervalStart.getTime() + intervalDuration / 2);
  
  // Apply schedule constraints if needed
  let scheduledTime = baseTime;
  if (schedule) {
    if (!isWithinSchedule(scheduledTime, schedule)) {
      scheduledTime = calculateNextAllowedTime(scheduledTime, schedule);
    }
  }
  
  // Apply jitter within interval bounds
  const jitterRange = intervalDuration * (jitterPercentage / 100);
  const jitter = (Math.random() * 2 - 1) * jitterRange; // Random between -jitterRange and +jitterRange
  const jitteredTime = new Date(scheduledTime.getTime() + jitter);
  
  // Clamp to interval bounds
  if (jitteredTime < intervalStart) {
    return intervalStart.toISOString();
  }
  if (jitteredTime > intervalEnd) {
    return intervalEnd.toISOString();
  }
  
  return jitteredTime.toISOString();
}
```

### 2.4 Update Scheduler Worker Main Loop

**File**: `workers/scheduler-worker/src/worker.ts`

**Key Point**: No additional workers needed! The scheduler worker runs multiple parallel tasks:
- **Main loop**: Processes enrollments (already parallel with `Promise.allSettled`)
- **Interval maintenance**: Background task (runs every minute)
- **Stale lock cleanup**: Background task (runs every 5 minutes)

All tasks run concurrently in the same worker instance using async/parallel processing.

Add interval maintenance:

```typescript
import { maintainCampaignIntervals } from './interval-management.js';
import { cleanupStaleIntervalLocks } from './interval-cleanup.js';

export class SchedulerWorker {
  private intervalMaintenanceTimer?: NodeJS.Timeout;
  private staleLockCleanupTimer?: NodeJS.Timeout;

  async start(): Promise<void> {
    console.log('Scheduler worker starting...');
    this.running = true;

    // Start interval maintenance (runs every minute)
    this.startIntervalMaintenance();
    
    // Start stale lock cleanup (runs every 5 minutes)
    this.startStaleLockCleanup();

    // Main enrollment processing loop
    while (this.running) {
      try {
        await this.processEnrollments();
        await this.sleep(5000);
      } catch (error) {
        console.error('[SCHEDULER] Error in main loop:', error);
        await this.sleep(5000);
      }
    }
  }

  stop(): void {
    this.running = false;
    if (this.intervalMaintenanceTimer) {
      clearInterval(this.intervalMaintenanceTimer);
    }
    if (this.staleLockCleanupTimer) {
      clearInterval(this.staleLockCleanupTimer);
    }
  }

  private startIntervalMaintenance(): void {
    // Run immediately, then every minute
    maintainCampaignIntervals(this.supabase).catch(err => {
      console.error('[INTERVAL MAINTENANCE] Error:', err);
    });

    this.intervalMaintenanceTimer = setInterval(() => {
      maintainCampaignIntervals(this.supabase).catch(err => {
        console.error('[INTERVAL MAINTENANCE] Error:', err);
      });
    }, 60000); // 1 minute
  }

  private startStaleLockCleanup(): void {
    // Run every 5 minutes
    this.staleLockCleanupTimer = setInterval(async () => {
      try {
        const { data, error } = await this.supabase.rpc('cleanup_stale_interval_locks', {
          p_lock_timeout_minutes: 5
        });
        
        if (error) {
          console.error('[STALE LOCK CLEANUP] Error:', error);
        } else if (data > 0) {
          console.log(`[STALE LOCK CLEANUP] Released ${data} stale locks`);
        }
      } catch (error) {
        console.error('[STALE LOCK CLEANUP] Error:', error);
      }
    }, 300000); // 5 minutes
  }
}
```

## Phase 3: Remove Old Slot-Based Logic

### 3.1 Remove `create_message_job_if_slot_available` Function

**Migration**: `supabase/migrations/YYYYMMDDHHMMSS_remove_slot_based_function.sql`

```sql
-- Remove old slot-based function (no longer needed)
DROP FUNCTION IF EXISTS create_message_job_if_slot_available(
  UUID, UUID, UUID, UUID, UUID, TIMESTAMPTZ, JSONB, INTEGER
);
```

### 3.2 Simplify `calculateNextMailboxSendTime`

**File**: `workers/scheduler-worker/src/scheduling.ts`

**Note**: This function is no longer needed for email nodes, but may still be used for other purposes. Can be simplified or removed if only used for emails.

## Phase 4: Testing

### 4.1 Unit Tests

- Test interval creation
- Test interval locking (atomic behavior)
- Test mailbox assignment per interval
- Test jitter calculation within interval
- Test stale lock cleanup

### 4.2 Integration Tests

- Test scheduler maintains intervals
- Test email node processing with intervals
- Test concurrent scheduler instances (should not conflict)
- Test interval maintenance under load

### 4.3 Manual Testing Checklist

- [ ] Intervals are created for campaigns
- [ ] Scheduler maintains 20+ intervals ahead
- [ ] Email nodes create message_jobs with correct interval_id
- [ ] One mailbox per interval (no duplicates)
- [ ] Jitter is applied within interval bounds
- [ ] Stale locks are cleaned up
- [ ] Schedule constraints are respected

## Phase 5: Migration Strategy

### 5.1 Pre-Migration

1. Deploy database migrations
2. Run interval creation for existing campaigns
3. Verify intervals are created correctly

### 5.2 Migration

1. Deploy updated scheduler worker
2. Monitor interval maintenance
3. Verify email nodes use new logic
4. Monitor for errors

### 5.3 Post-Migration

1. Remove old slot-based function (after verification)
2. Clean up any unused code
3. Monitor performance

## Phase 6: Monitoring & Alerts

### 6.1 Metrics to Monitor

- Number of available intervals per campaign
- Interval lock duration
- Stale locks released
- Email jobs created per interval
- Interval maintenance errors

### 6.2 Alerts

- Alert if intervals < 10 for any campaign
- Alert if stale lock cleanup releases > 5 locks
- Alert if interval maintenance fails repeatedly

## Implementation Order

1. **Phase 1**: Database schema (migrations)
2. **Phase 2.1**: Interval management module
3. **Phase 2.2**: Update email handler
4. **Phase 2.3**: Add scheduling helper
5. **Phase 2.4**: Update scheduler worker main loop
6. **Phase 4**: Testing
7. **Phase 3**: Remove old logic (after verification)
8. **Phase 6**: Monitoring

## Rollback Plan

If issues occur:

1. Revert scheduler worker to previous version
2. Old slot-based function can be restored if needed
3. Intervals table can remain (doesn't break old code)
4. `interval_id` column is optional (nullable)

## Success Criteria

- ✅ No race conditions in email scheduling
- ✅ One mailbox per interval guaranteed
- ✅ Intervals maintained automatically
- ✅ Simpler code than current approach
- ✅ Better visibility into future scheduling
- ✅ No performance degradation

