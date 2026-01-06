# Campaign Intervals Approach - Analysis

## Concept

Instead of calculating slots on-the-fly or using a dedicated email worker, we pre-create **campaign intervals** and let the scheduler lock and assign jobs to them.

## Architecture

### New Table: `campaign_intervals`

```sql
CREATE TABLE campaign_intervals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id),
  interval_start TIMESTAMPTZ NOT NULL,
  interval_end TIMESTAMPTZ NOT NULL,
  status TEXT DEFAULT 'available', -- 'available', 'locked', 'scheduled', 'completed'
  locked_at TIMESTAMPTZ,
  locked_by TEXT, -- Worker instance ID or similar
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(campaign_id, interval_start)
);

CREATE INDEX idx_campaign_intervals_campaign_status 
  ON campaign_intervals(campaign_id, status, interval_start);
```

### Flow

```
1. Scheduler maintains 20+ intervals ahead
   └─► Periodically creates new intervals for campaigns

2. Scheduler processes enrollments
   └─► Finds email node
   └─► Locks next available interval (atomic)
   └─► Assigns one message_job per mailbox for that interval
   └─► Marks interval as 'scheduled'
   └─► Releases lock

3. Send worker (unchanged)
   └─► Polls message_jobs where scheduled_at <= NOW()
```

## Detailed Flow

### Step 1: Maintain Intervals (Scheduler Background Task)

```typescript
async function maintainCampaignIntervals() {
  // For each active campaign
  const campaigns = await getActiveCampaigns();
  
  for (const campaign of campaigns) {
    // Check how many intervals we have ahead
    const latestInterval = await getLatestInterval(campaign.id);
    const now = new Date();
    const intervalsNeeded = 20;
    const intervalSeconds = campaign.sending_interval_seconds;
    
    // Calculate how many intervals to create
    const latestEnd = latestInterval?.interval_end || campaign.created_at;
    const intervalsAhead = Math.floor(
      (latestEnd.getTime() - now.getTime()) / (intervalSeconds * 1000)
    );
    
    if (intervalsAhead < intervalsNeeded) {
      // Create missing intervals
      const intervalsToCreate = intervalsNeeded - intervalsAhead;
      await createIntervals(campaign.id, latestEnd, intervalsToCreate, intervalSeconds);
    }
  }
}
```

### Step 2: Process Email Node (Scheduler Main Loop)

```typescript
async function handleEmailNode(enrollment, node, campaign) {
  // 1. Assign mailbox (if needed) - same as before
  const mailbox = await assignMailbox(enrollment.lead_id, campaign.id);
  
  // 2. Lock next available interval
  const interval = await lockNextAvailableInterval(campaign.id);
  
  if (!interval) {
    throw new Error('No available intervals - should not happen if maintenance is working');
  }
  
  // 3. Check if mailbox already has a job in this interval
  const existingJob = await checkMailboxInInterval(mailbox.id, interval.id);
  
  if (existingJob) {
    // Mailbox already scheduled for this interval - use existing job
    await releaseIntervalLock(interval.id);
    return existingJob;
  }
  
  // 4. Calculate scheduled_at within interval
  const scheduledAt = calculateScheduledAtInInterval(
    interval.interval_start,
    interval.interval_end,
    campaign.schedule,
    jitterPercentage
  );
  
  // 5. Create message_job
  const messageJob = await createMessageJob({
    enrollment_id: enrollment.id,
    campaign_id: campaign.id,
    lead_id: enrollment.lead_id,
    mailbox_id: mailbox.id,
    node_id: node.id,
    scheduled_at: scheduledAt,
    status: 'pending',
    ...
  });
  
  // 6. Mark interval as scheduled (if all mailboxes assigned)
  await markIntervalScheduled(interval.id);
  
  return messageJob;
}
```

### Step 3: Lock Interval (Atomic)

```sql
-- Atomic lock of next available interval
UPDATE campaign_intervals
SET status = 'locked',
    locked_at = NOW(),
    locked_by = $worker_id
WHERE id = (
  SELECT id
  FROM campaign_intervals
  WHERE campaign_id = $campaign_id
    AND status = 'available'
    AND interval_start > NOW()
  ORDER BY interval_start ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
RETURNING *;
```

## Benefits

### 1. No Race Conditions
- **Atomic interval locking** - Only one scheduler can lock an interval
- **One mailbox per interval** - Guaranteed by design
- **No complex slot checking** - Interval is the slot

### 2. Simpler Logic
- **Pre-created intervals** - No on-the-fly slot calculation
- **Clear assignment** - One job per mailbox per interval
- **Predictable** - Intervals are fixed, just assign to them

### 3. No Extra Worker
- **Scheduler handles everything** - Maintains intervals and assigns jobs
- **Simpler architecture** - One less worker to manage
- **Same polling pattern** - Scheduler already polls enrollments

### 4. Better Visibility
- **See future intervals** - Know what's scheduled ahead
- **Monitor interval usage** - Track which intervals are locked/scheduled
- **Easier debugging** - Clear view of scheduling state

## Comparison

### Current Approach (Complex)
```
Scheduler → Calculate slot → Apply jitter → Atomic slot check → Create job
Issues:
- Race conditions in slot checking
- Complex atomic functions
- Jitter order problems
- Multiple workers can conflict
```

### Dedicated Email Worker
```
Scheduler → Update enrollment
Email Worker → Assign mailbox → Calculate slot → Create job
Benefits:
- Sequential processing (no race conditions)
- Separation of concerns
Costs:
- Extra worker
- Extra polling
```

### Campaign Intervals Approach
```
Scheduler → Lock interval → Assign mailbox → Create job
Benefits:
- Atomic interval locking (no race conditions)
- Pre-created slots (predictable)
- One mailbox per interval (guaranteed)
- No extra worker
Costs:
- Extra table (campaign_intervals)
- Background maintenance task
```

## Implementation Details

### Interval Creation

```typescript
async function createIntervals(
  campaignId: string,
  startFrom: Date,
  count: number,
  intervalSeconds: number
) {
  const intervals = [];
  let currentStart = new Date(startFrom);
  
  for (let i = 0; i < count; i++) {
    const intervalEnd = new Date(currentStart.getTime() + (intervalSeconds * 1000));
    
    intervals.push({
      campaign_id: campaignId,
      interval_start: currentStart,
      interval_end: intervalEnd,
      status: 'available'
    });
    
    currentStart = intervalEnd;
  }
  
  await supabase.from('campaign_intervals').insert(intervals);
}
```

### Interval Locking

```typescript
async function lockNextAvailableInterval(campaignId: string): Promise<Interval | null> {
  const { data, error } = await supabase.rpc('lock_campaign_interval', {
    p_campaign_id: campaignId,
    p_worker_id: process.env.WORKER_ID || 'scheduler'
  });
  
  return data || null;
}
```

**SQL Function**:
```sql
CREATE OR REPLACE FUNCTION lock_campaign_interval(
  p_campaign_id UUID,
  p_worker_id TEXT
)
RETURNS TABLE (
  id UUID,
  campaign_id UUID,
  interval_start TIMESTAMPTZ,
  interval_end TIMESTAMPTZ,
  status TEXT
) AS $$
DECLARE
  v_interval_id UUID;
BEGIN
  -- Atomic lock
  UPDATE campaign_intervals
  SET status = 'locked',
      locked_at = NOW(),
      locked_by = p_worker_id
  WHERE id = (
    SELECT ci.id
    FROM campaign_intervals ci
    WHERE ci.campaign_id = p_campaign_id
      AND ci.status = 'available'
      AND ci.interval_start > NOW()
    ORDER BY ci.interval_start ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING campaign_intervals.id INTO v_interval_id;
  
  IF v_interval_id IS NULL THEN
    RETURN; -- No available interval
  END IF;
  
  -- Return locked interval
  RETURN QUERY
  SELECT 
    ci.id,
    ci.campaign_id,
    ci.interval_start,
    ci.interval_end,
    ci.status
  FROM campaign_intervals ci
  WHERE ci.id = v_interval_id;
END;
$$ LANGUAGE plpgsql;
```

### Mailbox Assignment Per Interval

```typescript
async function checkMailboxInInterval(
  mailboxId: string,
  intervalId: string
): Promise<MessageJob | null> {
  const { data } = await supabase
    .from('message_jobs')
    .select('*')
    .eq('mailbox_id', mailboxId)
    .eq('interval_id', intervalId) // Need to add this column
    .maybeSingle();
  
  return data || null;
}
```

**Note**: Would need to add `interval_id` to `message_jobs` table to track which interval a job belongs to.

## Schedule Constraints

### Handling Campaign Schedules

When creating intervals, need to respect schedule constraints:

```typescript
function calculateIntervalTimes(
  baseTime: Date,
  intervalSeconds: number,
  schedule: CampaignSchedule | null
): { start: Date, end: Date } {
  let intervalStart = baseTime;
  
  // Apply schedule constraints
  if (schedule) {
    if (!isWithinSchedule(intervalStart, schedule)) {
      intervalStart = calculateNextAllowedTime(intervalStart, schedule);
    }
  }
  
  const intervalEnd = new Date(intervalStart.getTime() + (intervalSeconds * 1000));
  
  // Ensure interval_end is also within schedule
  if (schedule && !isWithinSchedule(intervalEnd, schedule)) {
    // Adjust to end of schedule window
    intervalEnd = calculateScheduleEnd(intervalStart, schedule);
  }
  
  return { start: intervalStart, end: intervalEnd };
}
```

## Jitter Application

Jitter is applied within the interval:

```typescript
function calculateScheduledAtInInterval(
  intervalStart: Date,
  intervalEnd: Date,
  schedule: CampaignSchedule | null,
  jitterPercentage: number
): string {
  // Base time is middle of interval
  const baseTime = new Date(
    intervalStart.getTime() + (intervalEnd.getTime() - intervalStart.getTime()) / 2
  );
  
  // Apply schedule constraints (if needed)
  let scheduledTime = baseTime;
  if (schedule) {
    if (!isWithinSchedule(scheduledTime, schedule)) {
      scheduledTime = calculateNextAllowedTime(scheduledTime, schedule);
    }
  }
  
  // Apply jitter within interval bounds
  const jitterRange = (intervalEnd.getTime() - intervalStart.getTime()) * (jitterPercentage / 100);
  const jitter = (Math.random() * 2 - 1) * jitterRange;
  const jitteredTime = new Date(scheduledTime.getTime() + jitter);
  
  // Clamp to interval bounds
  if (jitteredTime < intervalStart) return intervalStart.toISOString();
  if (jitteredTime > intervalEnd) return intervalEnd.toISOString();
  
  return jitteredTime.toISOString();
}
```

## Maintenance Task

Scheduler runs interval maintenance periodically:

```typescript
class SchedulerWorker {
  private intervalMaintenanceInterval = 60000; // Every minute
  
  async start() {
    // Start interval maintenance
    this.startIntervalMaintenance();
    
    // Main enrollment processing loop
    while (this.running) {
      await this.processEnrollments();
      await this.sleep(5000);
    }
  }
  
  private async startIntervalMaintenance() {
    setInterval(async () => {
      try {
        await this.maintainCampaignIntervals();
      } catch (error) {
        console.error('Interval maintenance error:', error);
      }
    }, this.intervalMaintenanceInterval);
  }
}
```

## Advantages Over Other Approaches

### vs Current Approach
- ✅ **No race conditions** - Atomic interval locking
- ✅ **Simpler logic** - Pre-created intervals, just assign
- ✅ **Predictable** - Fixed intervals, no complex calculations
- ✅ **No jitter order issues** - Jitter applied within interval

### vs Dedicated Email Worker
- ✅ **No extra worker** - Scheduler handles everything
- ✅ **Simpler architecture** - One less component
- ✅ **Same polling pattern** - No new polling logic needed
- ⚠️ **Extra table** - But provides better visibility

## Potential Issues & Solutions

### Issue 1: Interval Maintenance Failure
**Problem**: If maintenance fails, we might run out of intervals

**Solution**: 
- Monitor interval count
- Alert if intervals < 10
- Maintenance runs frequently (every minute)
- Can manually create intervals if needed

### Issue 2: Locked Intervals Not Released
**Problem**: If scheduler crashes while holding lock

**Solution**:
- Add timeout to locks (e.g., 5 minutes)
- Background task releases stale locks
- `locked_at` timestamp for timeout checking

### Issue 3: Schedule Constraints
**Problem**: Intervals need to respect campaign schedules

**Solution**:
- When creating intervals, skip times outside schedule
- Or create intervals but mark as "outside schedule"
- Adjust interval boundaries to fit schedule windows

## Schema Changes Needed

1. **New table**: `campaign_intervals`
2. **Add column**: `message_jobs.interval_id` (optional, for tracking)
3. **Indexes**: On `campaign_intervals(campaign_id, status, interval_start)`

## Summary

This approach is **elegant** because:
- ✅ Solves race conditions with atomic interval locking
- ✅ Guarantees one mailbox per interval
- ✅ Pre-creates slots (predictable)
- ✅ No extra worker needed
- ✅ Simpler logic than current approach
- ✅ Better visibility into future scheduling

**Trade-off**: Extra table and maintenance task, but provides significant benefits.

