# What Does "Processed" Mean for Intervals?

## Current Definition

An interval is considered **"processed"** when:
- **All mailboxes have message_jobs assigned** to the interval
- **All message_jobs have status `'sent'` or `'failed'`** (completed)
- **`last_processed_interval_end` is updated** to that interval's end time

## How It Works

### Step-by-Step Flow

1. **Interval starts as `'available'`**
   - No message jobs assigned yet
   - Can be locked by scheduler

2. **Scheduler locks interval** (`status = 'locked'`)
   - Checks if mailbox already has job in this interval
   - If yes: Returns existing job, marks interval as `'scheduled'`, updates `last_processed_interval_end`
   - If no: Creates new message_job, marks interval as `'scheduled'`, updates `last_processed_interval_end`

3. **Interval is now `'scheduled'`**
   - Has at least one message_job assigned
   - `last_processed_interval_end` has been updated
   - **This interval is considered "processed"**

4. **Next interval can now be processed**
   - Sequential check: `interval_start >= last_processed_interval_end`
   - Ensures intervals are processed in order

## Key Points

### 1. "Processed" = "Has at least one job assigned"

An interval is marked as processed as soon as **any mailbox** gets a job assigned to it. We don't wait for all mailboxes to be assigned.

**Example:**
- Campaign has 3 mailboxes (A, B, C)
- Interval 1: Mailbox A gets job → Interval 1 is "processed" → `last_processed_interval_end = interval_1_end`
- Interval 2: Mailbox B tries to get job → Gets Interval 2 (because Interval 1 is already processed)
- Interval 3: Mailbox C tries to get job → Gets Interval 3

**Result:** Each mailbox gets a different interval, which is correct for sequential processing.

### 2. Multiple Mailboxes Can Share an Interval (But Don't)

The system ensures **one mailbox per interval**, but the "processed" check happens after the first job is assigned. This means:

- If Mailbox A gets Interval 1, it's marked as processed
- If Mailbox B tries to get a job, it will get Interval 2 (not Interval 1, because Interval 1 already has Mailbox A's job)
- This naturally distributes mailboxes across intervals

### 3. Why Not Wait for All Mailboxes?

**Question:** Should we wait until ALL mailboxes have jobs in Interval 1 before moving to Interval 2?

**Answer:** No, because:
- The function ensures one mailbox per interval anyway
- If we waited, we'd block processing unnecessarily
- The current approach naturally distributes mailboxes across sequential intervals

## Current Implementation

### When `last_processed_interval_end` is Updated

The function updates `last_processed_interval_end` in two cases:

1. **New job created** (Step 7):
   ```sql
   UPDATE campaigns
   SET last_processed_interval_end = v_interval_end
   WHERE id = p_campaign_id;
   ```

2. **Existing job returned** (Step 3):
   ```sql
   IF v_last_processed_end IS NULL OR v_interval_end > v_last_processed_end THEN
     UPDATE campaigns
     SET last_processed_interval_end = v_interval_end
     WHERE id = p_campaign_id;
   END IF;
   ```

### Sequential Check

The function only allows processing intervals where:
```sql
AND (v_last_processed_end IS NULL OR ci.interval_start >= v_last_processed_end)
```

This ensures:
- First interval: `last_processed_interval_end IS NULL` → Any available interval can be processed
- Subsequent intervals: Must have `interval_start >= last_processed_interval_end` → Only intervals after the last processed one

## Alternative Definitions (Not Implemented)

### Option A: Wait for All Mailboxes

**Definition:** An interval is processed when ALL mailboxes have jobs assigned.

**Pros:**
- More strict ordering
- Ensures all mailboxes are "caught up" before moving forward

**Cons:**
- Could block processing if one mailbox is slow
- More complex to implement (need to track which mailboxes have jobs)
- Not necessary since we ensure one mailbox per interval anyway

### Option B: Wait for All Jobs to be Sent

**Definition:** An interval is processed when all message_jobs in that interval have been sent.

**Pros:**
- Most strict definition
- Ensures actual sending is complete

**Cons:**
- Would block interval processing until emails are sent
- Not practical for scheduling ahead
- Would require tracking job status

## Recommended: Current Definition

The current definition ("processed" = "has at least one job assigned") is correct because:

1. **Ensures sequential processing**: Intervals are processed in order
2. **Natural distribution**: Mailboxes are distributed across intervals
3. **No blocking**: Doesn't wait unnecessarily
4. **Simple**: Easy to understand and implement
5. **Matches behavior**: The function already ensures one mailbox per interval

## Verification

To verify an interval is "processed", check:

```sql
-- Check if interval has jobs and is marked as scheduled
SELECT 
  ci.id,
  ci.status,
  ci.interval_start,
  ci.interval_end,
  COUNT(mj.id) as job_count
FROM campaign_intervals ci
LEFT JOIN message_jobs mj ON mj.interval_id = ci.id
WHERE ci.campaign_id = '...'
GROUP BY ci.id, ci.status, ci.interval_start, ci.interval_end
ORDER BY ci.interval_start ASC;
```

An interval is "processed" if:
- `status = 'scheduled'`
- `job_count > 0`
- Campaign's `last_processed_interval_end >= interval_end`

