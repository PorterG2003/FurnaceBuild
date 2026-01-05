# Sending Interval & Mailbox Consistency Implementation Plan

## Overview

This plan implements two related features:
1. **Sending Interval Infrastructure**: Campaign-level sending interval (each mailbox sends one message per interval)
2. **Mailbox Consistency**: Lead-level mailbox assignment (round-robin for first email, consistent for subsequent)

## Goals

1. Each campaign has a `sending_interval_seconds` (e.g., 300 = 5 minutes)
2. Each mailbox in the campaign sends one message per interval (based on last send time)
3. Each lead is assigned a mailbox on first email node (round-robin)
4. All subsequent email nodes for that lead use the same mailbox (consistency)
5. Base time for scheduling is calculated from the mailbox's last send time + interval (not `NOW()`)
6. Jitter is applied correctly based on the interval-based base time

## Architecture

### Data Model Changes

#### 1. Add `sending_interval_seconds` to `campaigns` table

```sql
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS sending_interval_seconds INTEGER DEFAULT 300;

-- Add constraint: interval must be positive
ALTER TABLE campaigns ADD CONSTRAINT campaigns_sending_interval_check 
  CHECK (sending_interval_seconds IS NULL OR sending_interval_seconds > 0);

-- Comment
COMMENT ON COLUMN campaigns.sending_interval_seconds IS 'Interval between sends per mailbox (seconds). Campaign with 3 mailboxes and 300s interval = 3 messages every 5 minutes (one per mailbox). Default: 300 (5 minutes).';
```

#### 2. Add `mailbox_id` to `leads` table

```sql
ALTER TABLE leads ADD COLUMN IF NOT EXISTS mailbox_id UUID REFERENCES mailboxes(id);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_leads_mailbox_id ON leads(mailbox_id);

-- Comment
COMMENT ON COLUMN leads.mailbox_id IS 'Mailbox assigned to this lead for this campaign. Set on first email node via round-robin. Must remain consistent for all subsequent email nodes. NULL before first email node is processed.';
```

### Database Schema Changes

#### 3. Add Slot-Based Job Creation Function

**Location**: New Supabase migration file

**Purpose**: Atomically ensure only one message_job per mailbox per interval slot

**See**: "Database Function: Slot-Based Job Creation" section below for full implementation

### Core Logic Changes

#### 1. Mailbox Assignment Logic

**Location**: `workers/scheduler-worker/src/node-handlers/email-handler.ts`

**Flow**:
1. Load lead data (includes `mailbox_id`)
2. Check if mailbox is assigned:
   - If `lead.mailbox_id IS NULL`: First email node → assign mailbox
   - If `lead.mailbox_id IS NOT NULL`: Subsequent email node → use assigned mailbox
3. For first email node:
   - Query `message_jobs` to confirm no emails exist (handles branching)
   - If emails exist but `mailbox_id IS NULL`: Error/inconsistency (report)
   - If no emails exist: Use round-robin to select mailbox
   - Atomically assign: `UPDATE leads SET mailbox_id = ? WHERE id = ? AND mailbox_id IS NULL`
4. For subsequent email nodes:
   - Use `lead.mailbox_id`
   - Validate mailbox is still in campaign and available

#### 2. Sending Interval Calculation

**Location**: `workers/scheduler-worker/src/scheduling.ts` (new function)

**Function**: `calculateNextMailboxSendTime(campaignId, mailboxId, currentTime, campaignSchedule, supabase)`

**Note**: When there's no schedule, the function uses the campaign's `created_at` (campaign start time) as the base time instead of `currentTime`. This provides a predictable, non-jittered base time.

**Purpose**: Calculate the next base time for scheduling a message from this mailbox, based on:
- Campaign schedule (when emails are allowed to be sent)
- Campaign sending interval (how often the campaign sends messages)
- Mailbox minimum gap (minimum time between sends from this specific mailbox)
- Current time (don't schedule in the past)

**Key Insight**: The function calculates the next send time based on the campaign schedule and interval. It doesn't calculate from the last scheduled time (which has jitter applied). Instead, it enforces the mailbox's minimum gap to prevent sending too frequently.

**Detailed Algorithm**:

**Step 1: Load Campaign Interval and Start Time**
```typescript
// Query campaign for sending_interval_seconds and created_at (campaign start time)
const { data: campaign, error: campaignError } = await supabase
  .from('campaigns')
  .select('sending_interval_seconds, created_at')
  .eq('id', campaignId)
  .single();

if (campaignError || !campaign) {
  throw new Error(`Campaign ${campaignId} not found: ${campaignError?.message || 'Campaign not found'}`);
}

const intervalSeconds = campaign.sending_interval_seconds;
const campaignStartTime = new Date(campaign.created_at);
```

**Step 2: Validate Interval Exists**
```typescript
if (!intervalSeconds || intervalSeconds <= 0) {
  // Campaign must have a valid sending interval configured
  throw new Error(`Campaign ${campaignId} does not have a valid sending_interval_seconds configured`);
}
```

**Step 3: Calculate Campaign Interval Base Time (Slot-Based)**
```typescript
let campaignIntervalBaseTime: Date;

if (!campaignSchedule) {
  // No schedule constraints - calculate slot from campaign start time
  // Formula: (roundDown((Current time - Campaign start time) / interval) * interval) + interval
  const timeSinceStart = currentTime.getTime() - campaignStartTime.getTime();
  const intervalsElapsed = Math.floor(timeSinceStart / (intervalSeconds * 1000));
  const nextSlotTime = campaignStartTime.getTime() + ((intervalsElapsed + 1) * intervalSeconds * 1000);
  campaignIntervalBaseTime = new Date(nextSlotTime);
} else {
  // Campaign has schedule constraints - calculate slot from most recent schedule start
  // First, find the most recent schedule start time (could be today or earlier)
  // Then: (roundDown((Current time - Most recent schedule start) / interval) * interval) + interval
  
  // Find the most recent schedule start (beginning of current schedule window)
  const mostRecentScheduleStart = findMostRecentScheduleStart(currentTime, campaignSchedule);
  
  // Calculate slot-based time
  const timeSinceScheduleStart = currentTime.getTime() - mostRecentScheduleStart.getTime();
  const intervalsElapsed = Math.floor(timeSinceScheduleStart / (intervalSeconds * 1000));
  const nextSlotTime = mostRecentScheduleStart.getTime() + ((intervalsElapsed + 1) * intervalSeconds * 1000);
  const slotBasedTime = new Date(nextSlotTime);
  
  // Ensure the slot-based time is within the current schedule window
  // If it's outside, find the next allowed time in schedule
  try {
    campaignIntervalBaseTime = calculateNextAllowedTime(slotBasedTime, campaignSchedule);
  } catch (error) {
    throw new Error(`Failed to calculate next allowed time for schedule: ${error instanceof Error ? error.message : String(error)}`);
  }
}
```

**Helper Function: `findMostRecentScheduleStart`**
```typescript
function findMostRecentScheduleStart(currentTime: Date, schedule: CampaignSchedule): Date {
  // This function finds the most recent time when the schedule window started
  // For example, if schedule is 9 AM - 5 PM and current time is 2 PM:
  // - Most recent schedule start = 9 AM today
  
  // Implementation depends on schedule structure:
  // - If schedule has days_of_week: find most recent matching day + start_hour
  // - If schedule is 24/7: use campaign start time
  // - Otherwise: find most recent start_hour within current day
  
  // For now, simplified version (full implementation would handle days_of_week, timezone, etc.)
  const scheduleStartHour = schedule.start_hour || 0;
  const scheduleStartMinute = schedule.start_minute || 0;
  
  // Get current date in schedule timezone
  const tz = schedule.timezone || 'UTC';
  const currentInTz = convertToTimezone(currentTime, tz);
  
  // Create date for today at schedule start time
  const todayStart = new Date(currentInTz);
  todayStart.setHours(scheduleStartHour, scheduleStartMinute, 0, 0);
  
  // If today's start is in the past, use it; otherwise use yesterday's start
  if (todayStart <= currentInTz) {
    return todayStart;
  } else {
    // Use yesterday's start (or previous matching day if days_of_week specified)
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    return yesterdayStart;
  }
}
```

**Step 5: Query Mailbox Minimum Gap**
```typescript
// Get mailbox throttle configuration for minimum gap enforcement
// This is the minimum time between sends from this specific mailbox (e.g., 180 seconds = 3 minutes)
const { data: throttle, error: throttleError } = await supabase
  .from('mailbox_throttles')
  .select('min_gap_seconds')
  .eq('mailbox_id', mailboxId)
  .eq('date', new Date().toISOString().split('T')[0]) // Today's date
  .maybeSingle(); // Use maybeSingle() since throttle might not exist yet

if (throttleError) {
  throw new Error(`Failed to query mailbox throttle for mailbox ${mailboxId}: ${throttleError.message}`);
}

// Get minimum gap (default to 180 seconds if not configured)
const minGapSeconds = throttle?.min_gap_seconds ?? 180;
```

**Step 6: Query Last Mailbox Scheduled Time (For Minimum Gap Enforcement)**
```typescript
// Get the most recent scheduled_at for this mailbox
// We use scheduled_at because if a message is already scheduled (even if not yet sent),
// we shouldn't schedule another one within the gap time
// This prevents scheduling too many messages too close together
const { data: lastJob, error: queryError } = await supabase
  .from('message_jobs')
  .select('scheduled_at')
  .eq('campaign_id', campaignId)
  .eq('mailbox_id', mailboxId)
  .in('status', ['pending', 'reserved', 'sending', 'sent']) // Count scheduled and sent messages
  .order('scheduled_at', { ascending: false })
  .limit(1)
  .maybeSingle(); // Use maybeSingle() since no jobs is valid (first send)

if (queryError) {
  throw new Error(`Failed to query last scheduled time for mailbox ${mailboxId} in campaign ${campaignId}: ${queryError.message}`);
}

const lastScheduledTime = lastJob?.scheduled_at ? new Date(lastJob.scheduled_at) : null;
```

**Step 7: Calculate Minimum Time (Mailbox Gap Enforcement)**
```typescript
let mailboxMinTime: Date;

if (!lastScheduledTime) {
  // No previous scheduled messages from this mailbox - use campaign interval base time
  mailboxMinTime = campaignIntervalBaseTime;
} else {
  // Previous scheduled messages exist from this mailbox - must wait at least min_gap_seconds after last scheduled time
  // This enforces the mailbox's minimum gap (prevents scheduling too many messages too close together)
  // We use scheduled_at (not sent_at) because if a message is already scheduled, we shouldn't schedule another one too close
  mailboxMinTime = new Date(lastScheduledTime.getTime() + (minGapSeconds * 1000));
  
  // Ensure mailboxMinTime is not in the past (shouldn't happen - indicates data inconsistency)
  if (mailboxMinTime < currentTime) {
    throw new Error(`Calculated mailboxMinTime (${mailboxMinTime}) is in the past. Last scheduled: ${lastScheduledTime}, Min gap: ${minGapSeconds}s, Current: ${currentTime}`);
  }
}
```

**Step 8: Calculate Final Base Time**
```typescript
// Use whichever is later: campaign interval base time or mailbox minimum gap time
// This ensures we respect both campaign interval AND mailbox minimum gap
let baseTime = campaignIntervalBaseTime > mailboxMinTime ? campaignIntervalBaseTime : mailboxMinTime;

// Final validation: ensure baseTime is not in the past
// If calculated time is in the past, use currentTime instead
if (baseTime < currentTime) {
  // This can happen if campaign start time is in the past and no schedule
  // Use current time as the base (can't schedule in the past)
  baseTime = currentTime;
}

return baseTime;
```

**Complete Function Signature**:
```typescript
export async function calculateNextMailboxSendTime(
  campaignId: string,
  mailboxId: string,
  currentTime: Date,
  campaignSchedule: CampaignSchedule | null,
  supabase: SupabaseClient
): Promise<Date>
```

**Example Scenarios**:

**Scenario 1: First Send, No Schedule, Campaign Start in Past**
- `currentTime = T0`
- `campaignStartTime = T0 - 1 hour` (campaign started 1 hour ago)
- `intervalSeconds = 300` (5 minutes)
- `campaignSchedule = null` (no schedule constraints)
- `lastCampaignSendTime = null` (no previous sends in campaign)
- `lastScheduledTime = null` (no previous scheduled messages from this mailbox)
- **Calculation**:
  - `campaignIntervalBaseTime = T0 - 1 hour` (campaign start time, since no schedule and no previous sends)
  - `mailboxMinTime = T0 - 1 hour` (no previous sends, use campaign interval base)
  - `baseTime = max(T0 - 1 hour, T0 - 1 hour) = T0 - 1 hour`
  - Final validation: `baseTime < currentTime` → use `currentTime`
  - **Result**: `T0` (can send immediately, campaign start was in the past)

**Scenario 1b: First Send, No Schedule, Campaign Start in Future**
- `currentTime = T0`
- `campaignStartTime = T0 + 1 hour` (campaign starts in 1 hour - future campaign)
- `intervalSeconds = 300` (5 minutes)
- `campaignSchedule = null` (no schedule constraints)
- `minGapSeconds = 180` (3 minutes - mailbox minimum gap)
- `lastCampaignSendTime = null` (no previous sends in campaign)
- `lastScheduledTime = null` (no previous scheduled messages from this mailbox)
- **Calculation**:
  - `campaignIntervalBaseTime = T0 + 1 hour` (campaign start time, since no schedule and no previous sends)
  - `mailboxMinTime = T0 + 1 hour` (no previous sends, use campaign interval base)
  - `baseTime = max(T0 + 1 hour, T0 + 1 hour) = T0 + 1 hour`
  - Final validation: `baseTime >= currentTime` → use `baseTime`
  - **Result**: `T0 + 1 hour` (wait for campaign start time)

**Scenario 2: First Send, Outside Schedule**
- `currentTime = T0` (8:00 AM)
- `intervalSeconds = 300`
- `campaignSchedule = { start_hour: 9, end_hour: 17 }` (9 AM - 5 PM)
- `lastSendTime = null`
- **Result**: `T0 + 1 hour` (9:00 AM - next allowed time in schedule)

**Scenario 3: Subsequent Send, No Schedule**
- `currentTime = T0 + 310s` (5 minutes 10 seconds after first send)
- `campaignStartTime = T0 - 1 hour` (campaign started 1 hour ago)
- `intervalSeconds = 300` (5 minutes - campaign interval)
- `campaignSchedule = null`
- `minGapSeconds = 180` (3 minutes - mailbox minimum gap)
- `lastSentTime = T0` (first email was sent at T0)
- **Calculation**:
  - `scheduleBaseTime = T0 - 1 hour` (campaign start time, since no schedule)
  - `mailboxMinTime = T0 + 180s` (last scheduled + min gap = T0 + 3 minutes)
  - `baseTime = max(T0 - 1 hour, T0 + 180s) = T0 + 180s` (use minTime since it's later)
  - Final validation: `baseTime >= currentTime` → use `baseTime`
  - **Result**: `T0 + 180s` (must wait for mailbox minimum gap, campaign start time is in the past)

**Scenario 4: Subsequent Send, Campaign Interval Not Met, No Schedule**
- `currentTime = T0 + 100s` (1 minute 40 seconds after campaign start)
- `campaignStartTime = T0` (campaign started at T0)
- `intervalSeconds = 300` (5 minutes - campaign interval)
- `campaignSchedule = null`
- `minGapSeconds = 180` (3 minutes - mailbox minimum gap)
- `lastScheduledTime = T0` (last scheduled message from THIS mailbox was at T0)
- **Calculation**:
  - `timeSinceStart = 100s`
  - `intervalsElapsed = floor(100 / 300) = 0`
  - `campaignIntervalBaseTime = T0 + (0 + 1) * 300s = T0 + 300s` (next slot)
  - `mailboxMinTime = T0 + 180s` (last mailbox scheduled + min gap = T0 + 3 minutes)
  - `baseTime = max(T0 + 300s, T0 + 180s) = T0 + 300s` (use campaign interval since it's later)
  - Final validation: `baseTime >= currentTime` → use `baseTime`
  - **Result**: `T0 + 300s` (must wait for next slot, even though mailbox min gap is met)

**Scenario 5: Subsequent Send, Min Gap Met But Outside Schedule**
- `currentTime = T0 + 400s` (6 minutes 40 seconds after first send, 6:40 AM)
- `campaignStartTime = T0 - 1 hour` (campaign started at 5:00 AM)
- `intervalSeconds = 300` (5 minutes - campaign interval)
- `campaignSchedule = { start_hour: 9, end_hour: 17 }` (9 AM - 5 PM)
- `minGapSeconds = 180` (3 minutes - mailbox minimum gap)
- `lastSentTime = T0` (first email was sent at 6:00 AM)
- **Calculation**:
  - `scheduleBaseTime = T0 + 1 hour` (9:00 AM - next allowed time in schedule)
  - `mailboxMinTime = T0 + 180s` (6:03 AM - last scheduled + min gap)
  - `baseTime = max(T0 + 1 hour, T0 + 180s) = T0 + 1 hour` (9:00 AM - must wait for schedule)
  - **Result**: `T0 + 1 hour` (9:00 AM - must wait for schedule, even though min gap is met)

**Scenario 6: Subsequent Send, Schedule Window Passed**
- `currentTime = T0 + 10 hours` (6:00 PM, after schedule ends)
- `campaignStartTime = T0 - 1 hour` (campaign started at 7:00 AM)
- `intervalSeconds = 300` (5 minutes - campaign interval)
- `campaignSchedule = { start_hour: 9, end_hour: 17 }` (9 AM - 5 PM)
- `minGapSeconds = 180` (3 minutes - mailbox minimum gap)
- `lastSentTime = T0` (first email was sent at 8:00 AM)
- **Calculation**:
  - `scheduleBaseTime = T0 + 1 day + 1 hour` (9:00 AM next day - next allowed time)
  - `mailboxMinTime = T0 + 180s` (8:03 AM - last scheduled + min gap, but this is in the past)
  - `baseTime = max(T0 + 1 day + 1 hour, T0 + 180s) = T0 + 1 day + 1 hour` (9:00 AM next day)
  - **Result**: `T0 + 1 day + 1 hour` (9:00 AM next day - must wait for schedule)

**Error Handling**:

1. **Campaign not found**: Throw error
2. **Mailbox not in campaign**: Throw error (validate mailbox is assigned to campaign)
3. **Invalid interval**: Throw error if `intervalSeconds` is null, undefined, or <= 0
4. **Database query fails**: Throw error (don't fallback)
5. **Schedule calculation fails**: Throw error (from `calculateNextAllowedTime` - it should handle errors internally, but if it returns invalid data, throw)

**Key Design Decisions**:

1. **Use `scheduled_at` not `sent_at`**: 
   - Accounts for pending/reserved jobs that haven't been sent yet
   - Prevents scheduling too many jobs before previous ones are sent
   - More accurate for interval enforcement

2. **Schedule takes precedence over interval**:
   - If interval is met but we're outside schedule, wait for schedule
   - If schedule allows but interval not met, wait for interval
   - Use `max(scheduleBaseTime, minTime)` to respect both

3. **Base time calculation**:
   - If schedule exists: Use next allowed time in schedule (from `calculateNextAllowedTime`)
   - If no schedule: Use campaign start time (`created_at`) as base (predictable, not jittered)
   - If campaign start time is in the past: Use `currentTime` (can't schedule in the past)
   - If no previous sends: Can happen at schedule base time (or campaign start if no schedule)
   - If previous sends exist: Must wait for interval

4. **Jitter applied later**:
   - This function returns the base time
   - `calculateScheduledAt()` will apply jitter to this base time
   - Keeps concerns separated

#### 3. Update Email Handler

**Location**: `workers/scheduler-worker/src/node-handlers/email-handler.ts`

**Changes**:
1. Load lead data (includes `mailbox_id`)
2. Determine mailbox:
   - If `lead.mailbox_id IS NULL`: First email → assign via round-robin
   - If `lead.mailbox_id IS NOT NULL`: Subsequent email → use assigned mailbox
3. Calculate base time:
   - Call `calculateNextMailboxSendTime(campaignId, mailboxId, currentTime, campaign.schedule, supabase)`
   - Function will throw error if campaign has no interval configured
4. Calculate scheduled_at:
   - Call `calculateScheduledAt(baseTime, campaign.schedule, jitterPercentage)`
   - This applies schedule constraints and jitter
5. Create message_job with calculated `scheduled_at`

#### 4. Update Jitter Calculation

**Location**: `workers/scheduler-worker/src/scheduling.ts` (`applyJitter` function)

**Current Issue**: Jitter is calculated based on `timeDiff = scheduledTime - baseTime`, but if `scheduledTime == baseTime`, jitter range is 0.

**Fix**: With interval-based base time, `scheduledTime` will differ from `baseTime` (due to schedule constraints or interval spacing), so jitter will work correctly.

**No changes needed** - jitter calculation is correct, it just needs proper base time (which we're now providing).

### Error Handling & Validation

#### 1. First Email Node Detection

**Check**: Query `message_jobs` to see if any emails exist for this lead/campaign
- If count = 0 AND `mailbox_id IS NULL`: First email node → assign mailbox
- If count > 0 AND `mailbox_id IS NOT NULL`: Subsequent email node → use assigned mailbox
- If count > 0 AND `mailbox_id IS NULL`: **Error** - inconsistency (report)
- If count = 0 AND `mailbox_id IS NOT NULL`: **Error** - inconsistency (report)

#### 2. Mailbox Validation

**Before using assigned mailbox**:
- Check mailbox is still assigned to campaign: Query `campaign_mailboxes`
- Check mailbox is available: `mailbox.status = 'connected' AND mailbox.smtp_status = 'active'`
- If mailbox is invalid: **Error** - throw error and pause enrollment

#### 3. Race Condition Handling

**Mailbox Assignment**:
- Use atomic UPDATE: `UPDATE leads SET mailbox_id = ? WHERE id = ? AND mailbox_id IS NULL`
- If UPDATE affects 0 rows: Another worker already assigned → reload lead and use assigned mailbox
- Log race condition (for monitoring)

**Slot-Based Scheduling (One Message Per Slot Per Mailbox)**:
- **Problem**: Multiple enrollments could calculate the same slot time and try to create message_jobs for the same mailbox
- **Solution**: Use atomic database function `create_message_job_if_slot_available` that:
  1. Rounds `scheduled_at` to slot boundary (based on campaign interval)
  2. Checks if message_job already exists for this mailbox at this slot
  3. Atomically inserts only if slot is available
  4. Returns the created job or existing job if slot is taken
- **Implementation**: See "Database Function: Slot-Based Job Creation" section below

#### 4. Multiple "First" Email Nodes (Branching)

**Scenario**: Lead reaches multiple "first" email nodes due to branching
- First branch processed: Assigns mailbox via round-robin
- Second branch processed: `mailbox_id IS NOT NULL` → use assigned mailbox (maintain consistency)
- This is correct behavior (not an error)

**Error Case**: If `mailbox_id IS NULL` but emails exist → inconsistency (report)

## Implementation Steps

### Phase 1: Database Schema Changes

1. **Add `sending_interval_seconds` to campaigns**
   - Migration: `ALTER TABLE campaigns ADD COLUMN sending_interval_seconds INTEGER NOT NULL DEFAULT 300`
   - Add constraint: `CHECK (sending_interval_seconds > 0)`
   - Update TypeScript types
   - All existing campaigns will get default 300, but it's required going forward

2. **Add `mailbox_id` to leads**
   - Migration: `ALTER TABLE leads ADD COLUMN mailbox_id UUID REFERENCES mailboxes(id)`
   - Add index: `CREATE INDEX idx_leads_mailbox_id ON leads(mailbox_id)`
   - Update TypeScript types

### Phase 2: Interval Calculation Function

1. **Create `calculateNextMailboxSendTime()` function**
   - Location: `workers/scheduler-worker/src/scheduling.ts`
   - Parameters: `campaignId, mailboxId, currentTime, campaignSchedule, supabase`
   - Returns: `Date` (next send time for this mailbox based on schedule + interval)
   - Throws errors for: Missing interval, invalid interval, past times, database failures

2. **Test interval calculation**
   - Unit tests for various scenarios
   - Edge cases: No previous sends, multiple intervals, past times

### Phase 3: Mailbox Assignment Logic

1. **Update email handler to check mailbox assignment**
   - Load lead data (includes `mailbox_id`)
   - Check if mailbox is assigned
   - Query `message_jobs` to confirm first email node

2. **Implement round-robin assignment**
   - Function: `assignMailboxToLead(campaignId, leadId, supabase)`
   - Load campaign mailboxes (ordered by `created_at`)
   - Calculate round-robin: Count leads per mailbox, assign to mailbox with fewest
   - Atomic assignment: `UPDATE leads SET mailbox_id = ? WHERE id = ? AND mailbox_id IS NULL`
   - Return assigned mailbox

3. **Implement mailbox validation**
   - Function: `validateMailboxForCampaign(mailboxId, campaignId, supabase)`
   - Check mailbox is in campaign
   - Check mailbox is available
   - Return validation result

### Phase 4: Update Email Handler

1. **Integrate mailbox assignment**
   - Check if mailbox is assigned
   - If not assigned: Call `assignMailboxToLead()`
   - If assigned: Use `lead.mailbox_id` and validate

2. **Integrate interval calculation**
   - Call `calculateNextMailboxSendTime(campaignId, mailboxId, currentTime, campaign.schedule, supabase)`
   - Function will throw error if campaign has no interval configured
   - Use returned time as `baseTime`

3. **Update scheduled_at calculation**
   - Call `calculateScheduledAt(baseTime, campaign.schedule, jitterPercentage)`
   - This applies schedule constraints and jitter correctly

### Phase 5: Error Handling & Reporting

1. **Implement error checks**
   - First email node detection (check `message_jobs`)
   - Mailbox validation (campaign assignment, availability)
   - Inconsistency detection (`mailbox_id` vs `message_jobs`)

2. **Error reporting**
   - Log errors with context
   - Report inconsistencies (for monitoring)
   - Throw errors for invalid configurations (pause enrollment on error)

### Phase 6: Testing

1. **Unit tests**
   - Slot calculation function
   - Mailbox assignment logic
   - Round-robin distribution
   - Error handling

2. **Integration tests**
   - First email node → mailbox assignment
   - Subsequent email nodes → use assigned mailbox
   - Sending interval spacing
   - Jitter application
   - Branching scenarios

3. **Manual testing**
   - Create test campaign with multiple mailboxes
   - Create test leads
   - Verify mailbox assignment
   - Verify sending interval spacing
   - Verify jitter application

## Example Flow

### Scenario: Campaign with 3 mailboxes, 5-minute (300s) interval

**Setup**:
- Campaign: `sending_interval_seconds = 300`
- Mailboxes: A, B, C

**Timeline**:

1. **T0: Lead 1, First Email Node**
   - Check: `mailbox_id IS NULL`, no `message_jobs` → First email
   - Round-robin: Assign Mailbox A (fewest leads)
   - Interval calculation: No previous sends for Mailbox A → `baseTime = T0`
   - Schedule: `T0` (with schedule constraints + jitter)

2. **T0+10s: Lead 2, First Email Node**
   - Check: `mailbox_id IS NULL`, no `message_jobs` → First email
   - Round-robin: Assign Mailbox B (fewest leads)
   - Interval calculation: No previous sends for Mailbox B → `baseTime = T0+10s`
   - Schedule: `T0+10s` (with schedule constraints + jitter)

3. **T0+20s: Lead 3, First Email Node**
   - Check: `mailbox_id IS NULL`, no `message_jobs` → First email
   - Round-robin: Assign Mailbox C (fewest leads)
   - Interval calculation: No previous sends for Mailbox C → `baseTime = T0+20s`
   - Schedule: `T0+20s` (with schedule constraints + jitter)

4. **T0+300s: Lead 1, Second Email Node**
   - Check: `mailbox_id IS NOT NULL` (Mailbox A) → Subsequent email
   - Use Mailbox A (consistency)
   - Interval calculation: 
     - Schedule base: `calculateNextAllowedTime(T0+300s, schedule)` → `T0+300s` (within schedule)
     - Min time: Last send was at `T0` → `T0 + 300s = T0+300s`
     - `baseTime = max(T0+300s, T0+300s) = T0+300s`
   - Schedule: `T0+300s` (with schedule constraints + jitter)

5. **T0+310s: Lead 2, Second Email Node**
   - Check: `mailbox_id IS NOT NULL` (Mailbox B) → Subsequent email
   - Use Mailbox B (consistency)
   - Interval calculation:
     - Schedule base: `calculateNextAllowedTime(T0+310s, schedule)` → `T0+310s` (within schedule)
     - Min time: Last send was at `T0+10s` → `T0+10s + 300s = T0+310s`
     - `baseTime = max(T0+310s, T0+310s) = T0+310s`
   - Schedule: `T0+310s` (with schedule constraints + jitter)

## Error Handling

1. **Campaigns without `sending_interval_seconds`**:
   - Column is `NOT NULL` with default, so this shouldn't happen
   - If somehow NULL: Throw error - campaigns must have a valid interval configured

2. **Leads without `mailbox_id`**:
   - If `mailbox_id IS NULL`: Assign via round-robin (first email node)
   - This is expected behavior for first email node, not an error

## Migration Strategy

1. **Deploy schema changes** (Phase 1)
   - Add columns with defaults (non-breaking)
   - Existing campaigns get `sending_interval_seconds = 300` (default)
   - Existing leads get `mailbox_id = NULL` (will be assigned on first email)

2. **Deploy code changes** (Phases 2-4)
   - New logic requires `sending_interval_seconds` to be set (NOT NULL constraint)
   - Will throw error if interval is missing or invalid
   - No backward compatibility - errors are thrown for invalid configurations

3. **Monitor and validate** (Phase 5-6)
   - Check mailbox assignments are working
   - Check sending intervals are correct
   - Check jitter is applied correctly

## Success Criteria

1. ✅ Each lead gets assigned a mailbox on first email node (round-robin)
2. ✅ All subsequent email nodes for a lead use the same mailbox (consistency)
3. ✅ Messages are scheduled with proper spacing based on sending interval
4. ✅ Each mailbox sends one message per interval (based on last send time + interval)
5. ✅ Jitter is applied correctly (based on interval-based base time)
6. ✅ Schedule constraints are respected
7. ✅ Error cases are detected and reported
8. ✅ Errors are thrown for invalid configurations (no backward compatibility)

## Open Questions

1. **Round-robin algorithm**: Simple count-based or load-based (fewest leads)?
   - **Recommendation**: Start with simple count-based, can optimize later

2. **Error handling**: If mailbox is removed/unavailable, pause enrollment or reassign?
   - **Recommendation**: Pause enrollment and report error (maintain consistency)

3. **First send timing**: Start immediately or wait for first interval?
   - **Recommendation**: Start immediately (first send at T0, then intervals)

4. **Interval calculation**: Use `scheduled_at` or `sent_at` for last send time?
   - **Recommendation**: Use `scheduled_at` (more predictable, accounts for pending sends)

