# Simplified Scheduling Analysis

## Current Complexity

The current scheduling system has multiple layers:

1. **Slot-based calculation** - Rounds to interval boundaries from campaign start
2. **Schedule constraints** - Timezone, hours, days of week
3. **Mailbox minimum gap** - Enforces minimum time between sends
4. **Jitter application** - Random variation (but applied in wrong order)
5. **Atomic slot checking** - Database function to prevent duplicates
6. **Race condition handling** - FOR UPDATE SKIP LOCKED, etc.

## Simplified Approach

### Option 1: Simple Time-Based (No Slots)

**Concept**: Just calculate the next available time based on:
- Last send time from this mailbox (in this campaign)
- Campaign interval
- Mailbox minimum gap
- Schedule constraints
- Apply jitter

**Flow**:
```
1. Query: Last scheduled_at for this mailbox in this campaign
2. Calculate: max(last_send + interval, last_send + min_gap, NOW())
3. Apply schedule constraints
4. Apply jitter
5. Create message_job with scheduled_at
6. Done - no slot rounding, no atomic slot checking
```

**Send Worker**:
- Only claims jobs where `scheduled_at <= NOW()`
- Natural throttling - can't send until scheduled time

**Pros**:
- ✅ Much simpler code
- ✅ No slot rounding complexity
- ✅ No race conditions in slot checking
- ✅ Jitter works naturally
- ✅ Still respects intervals and gaps

**Cons**:
- ⚠️ Multiple enrollments could get same scheduled_at (but send worker handles this)
- ⚠️ Less "predictable" slots (but does that matter?)
- ⚠️ Need to ensure send workers respect scheduled_at

### Option 2: Simplified Slot-Based (Fix Current Issues)

**Concept**: Keep slots but simplify:
- Calculate slot FIRST (deterministic)
- Apply jitter WITHIN slot
- Simple atomic insert (no complex checking)

**Flow**:
```
1. Calculate slot: roundDown((NOW() - campaign_start) / interval) * interval + interval
2. Apply schedule constraints to slot
3. Check mailbox min gap
4. Apply jitter WITHIN slot (±small amount)
5. Simple INSERT with scheduled_at (let database unique constraint handle duplicates)
```

**Pros**:
- ✅ Keeps slot-based predictability
- ✅ Fixes jitter order issue
- ✅ Simpler than current atomic checking

**Cons**:
- ⚠️ Still has slot rounding complexity
- ⚠️ Need unique constraint on (mailbox_id, scheduled_at) or similar

## Comparison

### Current System
```
Complexity: ████████████ (12/10)
- Slot calculation from campaign start
- Schedule start time finding
- Mailbox gap enforcement
- Jitter application (wrong order)
- Atomic slot checking with tolerance windows
- Race condition handling
- Multiple database queries
```

### Option 1: Simple Time-Based
```
Complexity: ████ (4/10)
- Query last send time
- Calculate next time (max of options)
- Apply schedule constraints
- Apply jitter
- Insert job
```

### Option 2: Simplified Slot-Based
```
Complexity: ██████ (6/10)
- Calculate slot (simpler formula)
- Apply schedule constraints
- Check mailbox gap
- Apply jitter within slot
- Insert job (with unique constraint)
```

## Key Question: Do We Need Slots?

**What slots provide:**
- Predictable send times aligned to intervals
- Easier to reason about "one per mailbox per interval"
- Visual alignment in logs/dashboards

**What slots cost:**
- Complex rounding logic
- Race conditions in slot checking
- Jitter order issues
- Multiple database queries

**Alternative without slots:**
- Just ensure: last_send + interval <= next_send
- Send workers naturally throttle (only send when scheduled_at <= NOW())
- Simpler, still respects intervals

## Recommendation: Option 1 (Simple Time-Based)

**Why:**
1. **Simpler is better** - Less code = fewer bugs
2. **Send workers already handle timing** - They only claim jobs where scheduled_at <= NOW()
3. **Natural throttling** - If multiple jobs have same scheduled_at, send workers process them sequentially
4. **Still respects intervals** - Just calculate next time based on last send + interval
5. **No race conditions** - Simple INSERT, no complex checking

**Implementation:**
```typescript
// Simplified calculateNextMailboxSendTime
async function calculateNextMailboxSendTime(
  campaignId: string,
  mailboxId: string,
  currentTime: Date,
  campaignSchedule: CampaignSchedule | null,
  supabase: SupabaseClient
): Promise<Date> {
  // 1. Load campaign interval
  const campaign = await loadCampaign(campaignId);
  const intervalSeconds = campaign.sending_interval_seconds;
  
  // 2. Query last scheduled time for this mailbox in this campaign
  const lastJob = await supabase
    .from('message_jobs')
    .select('scheduled_at')
    .eq('mailbox_id', mailboxId)
    .eq('campaign_id', campaignId)
    .in('status', ['pending', 'reserved', 'sending', 'sent'])
    .order('scheduled_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  
  // 3. Calculate next time
  let nextTime: Date;
  if (lastJob?.scheduled_at) {
    const lastSend = new Date(lastJob.scheduled_at);
    const intervalTime = new Date(lastSend.getTime() + (intervalSeconds * 1000));
    const minGapTime = new Date(lastSend.getTime() + (180 * 1000)); // 180s default
    nextTime = new Date(Math.max(intervalTime.getTime(), minGapTime.getTime()));
  } else {
    // First send - use current time
    nextTime = currentTime;
  }
  
  // 4. Apply schedule constraints
  if (campaignSchedule) {
    if (!isWithinSchedule(nextTime, campaignSchedule)) {
      nextTime = calculateNextAllowedTime(nextTime, campaignSchedule);
    }
  }
  
  // 5. Ensure not in past
  if (nextTime < currentTime) {
    nextTime = currentTime;
  }
  
  return nextTime;
}

// In email-handler.ts
const baseTime = await calculateNextMailboxSendTime(...);
const scheduledAt = calculateScheduledAt(baseTime, schedule, jitter); // Apply jitter
// Simple INSERT - no slot checking needed
await supabase.from('message_jobs').insert({
  enrollment_id,
  campaign_id,
  lead_id,
  mailbox_id,
  node_id,
  scheduled_at: scheduledAt,
  status: 'pending',
  message_data
});
```

**Send Worker:**
- Already only claims jobs where `scheduled_at <= NOW()`
- Natural throttling - processes jobs in order
- If multiple jobs have same scheduled_at, they're processed sequentially

## Do We Need Another Worker?

**Short answer: No.**

The send worker already handles timing correctly:
- Only claims jobs where `scheduled_at <= NOW()`
- Processes jobs in order (by scheduled_at)
- Natural throttling through database polling

**What we'd need another worker for:**
- If we wanted to "pre-schedule" jobs far in advance
- If we wanted to batch schedule multiple jobs
- If we wanted to optimize scheduling across campaigns

**But we don't need that** - the current approach is fine:
- Scheduler creates jobs with scheduled_at
- Send worker only processes when time comes
- Simple and effective

## Migration Path

If we simplify:

1. **Remove slot-based logic** from `calculateNextMailboxSendTime`
2. **Remove `create_message_job_if_slot_available` function**
3. **Simplify to simple INSERT** in email-handler
4. **Add unique constraint** on `(mailbox_id, scheduled_at)` if needed (optional)
5. **Keep send worker as-is** (already handles timing correctly)

**Risk:**
- Low - send workers already respect scheduled_at
- If duplicate scheduled_at for same mailbox, send workers process sequentially
- Natural throttling through database polling

## Conclusion

**Current system is over-engineered** for what it needs to do. A simple time-based approach would:
- ✅ Be much simpler
- ✅ Still respect intervals and gaps
- ✅ Still work with send workers
- ✅ Have fewer bugs
- ✅ Be easier to maintain

**No additional worker needed** - send workers already handle timing correctly.

