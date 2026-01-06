# Sequential Interval Processing System Design

## Problem Statement

Currently, the `assign_message_job_to_interval` function locks the "next available" interval based on `interval_start` ordering, but it doesn't ensure that previous intervals have been processed. This could lead to:

1. **Out-of-order processing**: Interval 2 could be processed before Interval 1
2. **Gaps in scheduling**: If Interval 1 fails or is skipped, Interval 2 might still be processed
3. **Inconsistent state**: Hard to determine which intervals are "next" to process

## Requirements

1. **Sequential Processing**: Only allow processing Interval N if Interval N-1 is in a "processed" state
2. **Definition of "Processed"**: An interval is considered processed when:
   - Status is `'scheduled'` (has message jobs assigned), OR
   - Status is `'completed'` (all jobs sent - optional future state)
3. **First Interval Exception**: The first interval (earliest `interval_start`) can always be processed
4. **Concurrent Safety**: Multiple scheduler workers must not process the same interval or skip intervals
5. **Performance**: Must not significantly impact query performance

## Approach Options

### Option 1: Track "Last Processed Interval" Per Campaign

**Concept**: Add a column to `campaigns` table tracking the last processed interval.

**Schema Changes**:
```sql
ALTER TABLE campaigns 
  ADD COLUMN last_processed_interval_end TIMESTAMPTZ;

CREATE INDEX idx_campaigns_last_processed 
  ON campaigns(id, last_processed_interval_end);
```

**Logic**:
- When locking an interval, only allow intervals where `interval_start >= last_processed_interval_end`
- After successfully assigning jobs to an interval, update `last_processed_interval_end = interval_end`
- First interval: If `last_processed_interval_end IS NULL`, allow any interval

**Pros**:
- Simple to implement
- Fast queries (single column check)
- Clear state tracking
- Easy to query "what's next"

**Cons**:
- Requires updating campaigns table on every interval processing
- Potential bottleneck if many campaigns process intervals simultaneously
- Need to handle edge cases (campaign restart, first interval)

**Implementation**:
```sql
-- In assign_message_job_to_interval function:
-- Step 1: Check if previous interval is processed
SELECT c.last_processed_interval_end 
INTO v_last_processed_end
FROM campaigns c
WHERE c.id = p_campaign_id
FOR UPDATE; -- Lock campaign row

-- Step 2: Lock next interval that starts after last processed
WITH next_interval AS (
  SELECT ci.id, ci.interval_start, ci.interval_end
  FROM campaign_intervals ci
  WHERE ci.campaign_id = p_campaign_id
    AND ci.status = 'available'
    AND ci.interval_start > NOW()
    AND (v_last_processed_end IS NULL OR ci.interval_start >= v_last_processed_end)
  ORDER BY ci.interval_start ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
UPDATE campaign_intervals
SET status = 'locked', ...
FROM next_interval
WHERE campaign_intervals.id = next_interval.id
RETURNING ...;

-- Step 3: After successful job assignment, update last_processed_interval_end
UPDATE campaigns
SET last_processed_interval_end = v_interval_end
WHERE id = p_campaign_id;
```

---

### Option 2: Sequential Interval Dependency Check

**Concept**: When locking an interval, check that all previous intervals are in a "processed" state.

**Schema Changes**: None (uses existing status column)

**Logic**:
- When locking Interval N, check that Interval N-1 exists and has status `'scheduled'` or `'completed'`
- If Interval N-1 doesn't exist or is `'available'` or `'locked'`, reject the lock
- First interval: If no previous interval exists, allow it

**Pros**:
- No schema changes needed
- Self-contained (no cross-table updates)
- Natural dependency tracking

**Cons**:
- More complex query (need to find previous interval)
- Slower (subquery to find previous interval)
- Edge case: What if Interval N-1 was deleted or never created?

**Implementation**:
```sql
-- In assign_message_job_to_interval function:
WITH next_interval AS (
  SELECT ci.id, ci.interval_start, ci.interval_end
  FROM campaign_intervals ci
  WHERE ci.campaign_id = p_campaign_id
    AND ci.status = 'available'
    AND ci.interval_start > NOW()
    -- Check that previous interval is processed
    AND NOT EXISTS (
      SELECT 1
      FROM campaign_intervals prev
      WHERE prev.campaign_id = ci.campaign_id
        AND prev.interval_end <= ci.interval_start
        AND prev.status NOT IN ('scheduled', 'completed')
      ORDER BY prev.interval_end DESC
      LIMIT 1
    )
  ORDER BY ci.interval_start ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
UPDATE campaign_intervals
SET status = 'locked', ...
FROM next_interval
WHERE campaign_intervals.id = next_interval.id
RETURNING ...;
```

---

### Option 3: Sequence Number with Processed Tracking

**Concept**: Add a `sequence_number` to intervals and track the highest processed sequence.

**Schema Changes**:
```sql
ALTER TABLE campaign_intervals 
  ADD COLUMN sequence_number INTEGER;

ALTER TABLE campaigns 
  ADD COLUMN last_processed_sequence INTEGER DEFAULT 0;

CREATE UNIQUE INDEX idx_campaign_intervals_sequence 
  ON campaign_intervals(campaign_id, sequence_number);

CREATE INDEX idx_campaign_intervals_campaign_sequence 
  ON campaign_intervals(campaign_id, sequence_number, status);
```

**Logic**:
- Assign sequence numbers when intervals are created (1, 2, 3, ...)
- Only allow locking intervals where `sequence_number = last_processed_sequence + 1`
- After processing, update `last_processed_sequence = sequence_number`

**Pros**:
- Very explicit ordering
- Fast queries (integer comparison)
- Easy to understand and debug
- Can easily query "what sequence are we on?"

**Cons**:
- Requires sequence number assignment during interval creation
- Need to handle sequence gaps (what if sequence 5 is created before sequence 4?)
- More complex interval creation logic

**Implementation**:
```sql
-- When creating intervals, assign sequence numbers:
-- (In interval-management.ts or SQL function)
WITH max_sequence AS (
  SELECT COALESCE(MAX(sequence_number), 0) as max_seq
  FROM campaign_intervals
  WHERE campaign_id = p_campaign_id
)
INSERT INTO campaign_intervals (campaign_id, interval_start, interval_end, sequence_number, status)
SELECT 
  p_campaign_id,
  interval_start,
  interval_end,
  max_seq + row_number() OVER (ORDER BY interval_start),
  'available'
FROM ...;

-- In assign_message_job_to_interval function:
SELECT c.last_processed_sequence 
INTO v_last_processed_seq
FROM campaigns c
WHERE c.id = p_campaign_id
FOR UPDATE;

WITH next_interval AS (
  SELECT ci.id, ci.interval_start, ci.interval_end, ci.sequence_number
  FROM campaign_intervals ci
  WHERE ci.campaign_id = p_campaign_id
    AND ci.status = 'available'
    AND ci.interval_start > NOW()
    AND ci.sequence_number = v_last_processed_seq + 1
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
UPDATE campaign_intervals
SET status = 'locked', ...
FROM next_interval
WHERE campaign_intervals.id = next_interval.id
RETURNING ...;

-- After successful processing:
UPDATE campaigns
SET last_processed_sequence = v_sequence_number
WHERE id = p_campaign_id;
```

---

### Option 4: Interval Window Processing

**Concept**: Process intervals in "windows" - only allow processing intervals within a certain time window of the last processed interval.

**Schema Changes**: Same as Option 1 (track `last_processed_interval_end`)

**Logic**:
- Allow processing intervals where `interval_start` is within a "processing window" (e.g., next 5 intervals)
- Window size could be configurable per campaign
- Prevents skipping too far ahead while allowing some flexibility

**Pros**:
- Flexible (allows some parallel processing)
- Can handle gaps gracefully
- Good for high-throughput scenarios

**Cons**:
- More complex logic
- Window size needs tuning
- Still need to track last processed

---

## Recommended Approach: **Option 1 (Last Processed Interval End)**

### Rationale

1. **Simplicity**: Single column addition, straightforward logic
2. **Performance**: Fast queries (timestamp comparison)
3. **Clarity**: Easy to understand "what's the last processed interval?"
4. **Flexibility**: Can easily query "next interval to process"
5. **Maintainability**: Minimal schema changes, clear state tracking

### Implementation Details

#### 1. Schema Changes

```sql
-- Add column to track last processed interval
ALTER TABLE campaigns 
  ADD COLUMN last_processed_interval_end TIMESTAMPTZ;

-- Index for fast lookups
CREATE INDEX idx_campaigns_last_processed 
  ON campaigns(id, last_processed_interval_end);

COMMENT ON COLUMN campaigns.last_processed_interval_end IS 
  'The end time of the last processed interval for this campaign. Intervals with start >= this value can be processed. NULL means no intervals processed yet.';
```

#### 2. Function Modifications

**Update `assign_message_job_to_interval` function**:
- Step 0: Lock campaign row and get `last_processed_interval_end`
- Step 1: Lock next interval where `interval_start >= last_processed_interval_end` (or NULL for first)
- Step 2-6: (Existing logic - check mailbox, create job, etc.)
- Step 7: After successful job assignment, update `last_processed_interval_end = interval_end`

**Key Changes**:
```sql
-- At start of function:
SELECT c.last_processed_interval_end 
INTO v_last_processed_end
FROM campaigns c
WHERE c.id = p_campaign_id
FOR UPDATE; -- Lock campaign row to prevent concurrent updates

-- In interval locking CTE:
WHERE ci.campaign_id = p_campaign_id
  AND ci.status = 'available'
  AND ci.interval_start > NOW()
  AND (v_last_processed_end IS NULL OR ci.interval_start >= v_last_processed_end)
ORDER BY ci.interval_start ASC
LIMIT 1

-- After successful job assignment (before final RETURN):
UPDATE campaigns
SET last_processed_interval_end = v_interval_end
WHERE id = p_campaign_id;
```

#### 3. Edge Cases

**First Interval**:
- If `last_processed_interval_end IS NULL`, allow any available interval
- After processing first interval, set `last_processed_interval_end = interval_end`

**Gap Handling**:
- If an interval is skipped (status stays 'available'), subsequent intervals cannot be processed
- Solution: Add a cleanup function to mark skipped intervals as 'skipped' or handle in maintenance

**Concurrent Processing**:
- Campaign row lock (`FOR UPDATE`) ensures only one worker updates `last_processed_interval_end` at a time
- Interval lock (`FOR UPDATE SKIP LOCKED`) ensures only one worker processes an interval

**Stale Locks**:
- If a worker crashes while processing, the interval stays 'locked'
- Stale lock cleanup will release it, but `last_processed_interval_end` won't be updated
- Solution: Stale lock cleanup should also check if interval should be marked as 'available' again

#### 4. Interval Maintenance Updates

**No changes needed** - interval maintenance continues to create intervals ahead of time.

**Optional Enhancement**: 
- When creating intervals, ensure we create them after `last_processed_interval_end` (or current time if NULL)
- This prevents creating intervals in the "past" relative to processing

#### 5. Monitoring & Debugging

**Queries to check state**:
```sql
-- Check campaign processing state
SELECT 
  c.id,
  c.last_processed_interval_end,
  COUNT(ci.id) FILTER (WHERE ci.status = 'available') as available_count,
  COUNT(ci.id) FILTER (WHERE ci.status = 'scheduled') as scheduled_count,
  MIN(ci.interval_start) FILTER (WHERE ci.status = 'available') as next_available_start
FROM campaigns c
LEFT JOIN campaign_intervals ci ON ci.campaign_id = c.id
WHERE c.id = '...'
GROUP BY c.id, c.last_processed_interval_end;

-- Find "stuck" intervals (available but can't be processed)
SELECT ci.*
FROM campaign_intervals ci
JOIN campaigns c ON c.id = ci.campaign_id
WHERE ci.campaign_id = '...'
  AND ci.status = 'available'
  AND ci.interval_start > NOW()
  AND (c.last_processed_interval_end IS NULL OR ci.interval_start >= c.last_processed_interval_end)
ORDER BY ci.interval_start ASC;
```

## Alternative: Hybrid Approach

If Option 1 proves to have performance issues (campaign row locking bottleneck), we could use:

**Option 1 + Option 2 Hybrid**:
- Use `last_processed_interval_end` as a fast filter (Option 1)
- Add a secondary check that previous interval is processed (Option 2)
- This provides both performance and safety

## Migration Strategy

1. **Add column** with NULL default (allows existing campaigns to work)
2. **Update function** to check and update `last_processed_interval_end`
3. **Backfill**: Set `last_processed_interval_end` for campaigns with existing scheduled intervals
4. **Monitor**: Watch for any issues with concurrent processing

## Testing Considerations

1. **Sequential Processing**: Verify intervals are processed in order
2. **Concurrent Workers**: Multiple workers should not skip intervals
3. **First Interval**: First interval should process correctly
4. **Gap Handling**: What happens if an interval is skipped?
5. **Stale Locks**: Ensure stale locks don't block processing
6. **Performance**: Measure impact of campaign row locking

## Questions to Resolve

1. **What happens to skipped intervals?** (intervals that never get processed)
   - Option A: Mark as 'skipped' and allow next interval
   - Option B: Keep as 'available' and block subsequent intervals
   - Option C: Auto-skip after timeout

2. **Should we track "processed" vs "completed"?**
   - Processed = has jobs assigned (status = 'scheduled')
   - Completed = all jobs sent (status = 'completed' - future enhancement)

3. **How to handle interval maintenance?**
   - Should maintenance respect `last_processed_interval_end`?
   - Or create intervals from current time forward?

4. **What about campaigns with no intervals yet?**
   - First enrollment should trigger interval creation
   - Or maintenance should create initial intervals

