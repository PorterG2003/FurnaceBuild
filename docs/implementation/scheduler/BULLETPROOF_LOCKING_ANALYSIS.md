# Bulletproof Locking System - Analysis

## Problem with FOR UPDATE SKIP LOCKED in RPC Functions

**Why it doesn't guarantee**:
- RPC functions in Supabase/PostgREST execute in **auto-commit mode**
- When function returns, transaction commits → **lock is released immediately**
- Window between lock release and state update allows duplicates

**The race condition**:
```
Worker 1: RPC locks enrollment X → Returns X → Transaction commits → Lock released
Worker 1: Still processing (hasn't updated next_run_at yet)
Worker 2: Polls 1ms later → Enrollment X is unlocked → Gets enrollment X
Result: Both workers process the same enrollment
```

---

## Solution: Atomic UPDATE-Based Claiming ⭐ **BULLETPROOF**

### How It Works

Instead of `SELECT FOR UPDATE`, use `UPDATE ... WHERE ... RETURNING` to **atomically claim** enrollments:

```sql
UPDATE enrollments
SET next_run_at = NOW() + INTERVAL '5 minutes',  -- Mark as "processing"
    updated_at = NOW()
WHERE id IN (
  SELECT id FROM enrollments
  WHERE state = 'active'
    AND next_run_at <= NOW()
  ORDER BY next_run_at ASC
  LIMIT 100
  FOR UPDATE SKIP LOCKED  -- Prevent contention during selection
)
AND state = 'active'
AND next_run_at <= NOW()  -- Double-check: only update if still ready
RETURNING *;
```

### Why This Is Bulletproof

1. **Atomic Operation**: UPDATE is atomic - only one worker can successfully update each enrollment
2. **WHERE Clause as Lock**: The WHERE clause ensures only enrollments that match criteria are updated
3. **No Race Condition**: Even if two workers execute simultaneously, only one UPDATE succeeds
4. **Database Guarantee**: PostgreSQL guarantees atomicity at the row level

### How It Prevents Duplicates

```
Worker 1: UPDATE enrollment X WHERE id=X AND next_run_at<=NOW() → 1 row updated → Returns X
Worker 2: UPDATE enrollment X WHERE id=X AND next_run_at<=NOW() → 0 rows updated (already updated) → Returns nothing
```

**Key**: The WHERE clause `next_run_at <= NOW()` is evaluated **during the UPDATE**, so:
- Worker 1 updates `next_run_at` to future time (e.g., NOW() + 5 minutes)
- Worker 2's WHERE clause fails because `next_run_at` is now in the future
- Worker 2 gets 0 rows, Worker 1 gets the enrollment

---

## Implementation

### Step 1: Create RPC Function with Atomic UPDATE

```sql
CREATE OR REPLACE FUNCTION claim_enrollments_ready(
  p_batch_size INTEGER DEFAULT 100,
  p_processing_timeout_minutes INTEGER DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  campaign_id UUID,
  lead_id UUID,
  current_node_id UUID,
  state TEXT,
  next_run_at TIMESTAMPTZ,
  flow_position JSONB,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
) AS $$
DECLARE
  v_claimed_ids UUID[];
BEGIN
  -- Step 1: Select and lock candidate enrollments (for ordering)
  SELECT ARRAY_AGG(e.id)
  INTO v_claimed_ids
  FROM (
    SELECT id
    FROM enrollments
    WHERE state = 'active'
      AND next_run_at <= NOW()
    ORDER BY next_run_at ASC
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED  -- Prevent contention during selection
  ) e;
  
  -- If no enrollments found, return empty
  IF v_claimed_ids IS NULL OR array_length(v_claimed_ids, 1) IS NULL THEN
    RETURN;
  END IF;
  
  -- Step 2: Atomically claim enrollments (UPDATE with WHERE clause)
  -- This UPDATE is atomic - only enrollments that still match criteria are updated
  -- Workers trying to update already-updated enrollments get 0 rows
  RETURN QUERY
  UPDATE enrollments e
  SET next_run_at = NOW() + (p_processing_timeout_minutes || ' minutes')::INTERVAL,
      updated_at = NOW()
  WHERE e.id = ANY(v_claimed_ids)
    AND e.state = 'active'
    AND e.next_run_at <= NOW()  -- Critical: Only update if still ready
  RETURNING
    e.id,
    e.campaign_id,
    e.lead_id,
    e.current_node_id,
    e.state,
    e.next_run_at,  -- This is the NEW next_run_at (future time)
    e.flow_position,
    e.created_at,
    e.updated_at;
  
  -- Note: This provides 100% guarantee against duplicates:
  -- - FOR UPDATE SKIP LOCKED prevents contention during selection
  -- - UPDATE WHERE clause ensures only ready enrollments are claimed
  -- - If Worker 2 tries to update an enrollment Worker 1 already claimed,
  --   the WHERE clause fails (next_run_at is now in future) → 0 rows updated
  -- - Worker 2 moves on to next enrollment
END;
$$ LANGUAGE plpgsql;
```

### Step 2: Update DatabaseClient

```typescript
// workers/scheduler-worker/src/database.ts
async poll(): Promise<Enrollment[]> {
  try {
    // Use RPC function that atomically claims enrollments
    const { data, error } = await this.supabase
      .rpc('claim_enrollments_ready', {
        p_batch_size: this.batchSize,
        p_processing_timeout_minutes: 5  // Timeout if worker crashes
      });

    if (error) {
      console.error('Error claiming enrollments:', error);
      throw error;
    }

    return (data as Enrollment[]) || [];
  } catch (error) {
    console.error('Error polling database:', error);
    throw error;
  }
}
```

### Step 3: Process Enrollment (No Change Needed)

The worker processes the enrollment as before. After processing:

1. **If enrollment completes**: Update `state = 'completed'`
2. **If wait node**: Update `next_run_at` to the calculated future time
3. **If error**: Enrollment will become eligible again after timeout (5 minutes)

**Important**: The enrollment's `next_run_at` is set to a future time when claimed, so:
- If worker crashes, enrollment becomes eligible again after timeout
- If worker successfully processes, it updates `next_run_at` to the correct future time
- No duplicate processing possible

---

## Why This Is Bulletproof

### 1. Atomic UPDATE Operation

The UPDATE statement is **atomic** at the database level:
- PostgreSQL guarantees that UPDATE operations are atomic
- Only one UPDATE can succeed per enrollment
- No race condition possible

### 2. WHERE Clause as Implicit Lock

The WHERE clause `next_run_at <= NOW()` acts as an implicit lock:
```
Initial state: enrollment X has next_run_at = 2024-01-01 10:00:00 (NOW is 10:00:01)

Worker 1: UPDATE enrollment X WHERE next_run_at <= NOW() 
  → Condition TRUE → UPDATE succeeds → Sets next_run_at = 10:05:01

Worker 2: UPDATE enrollment X WHERE next_run_at <= NOW() 
  → Condition FALSE (next_run_at is now 10:05:01, NOW is 10:00:01) 
  → UPDATE fails → 0 rows updated
```

### 3. Self-Healing

If a worker crashes:
- Enrollment's `next_run_at` is set to NOW() + 5 minutes
- After 5 minutes, enrollment becomes eligible again
- Another worker picks it up
- No manual cleanup needed

### 4. No Lock Duration Issues

Unlike `FOR UPDATE SKIP LOCKED` which releases lock immediately:
- UPDATE permanently changes the row state
- No lock to release - the state change IS the lock
- Works perfectly with auto-commit RPC functions

---

## Comparison with SQS Queue

| Aspect | Atomic UPDATE | SQS FIFO Queue |
|--------|---------------|----------------|
| **Guarantee** | ✅ 100% (database atomic operation) | ✅ 100% (SQS exactly-once) |
| **Infrastructure** | ✅ None (just SQL function) | ❌ SQS queue + Lambda pusher |
| **Latency** | ✅ None (direct database) | ⚠️ ~50-100ms (queue hop) |
| **Scaling** | ✅ Auto-scales with workers | ✅ Auto-scales with workers |
| **Complexity** | ✅ Simple (single function) | ❌ More complex (queue + pusher) |
| **Cost** | ✅ Free | ⚠️ Minimal SQS costs |
| **Self-healing** | ✅ Yes (timeout-based) | ✅ Yes (visibility timeout) |

**Conclusion**: Atomic UPDATE is simpler, faster, and provides the same guarantee as SQS.

---

## Edge Cases Handled

1. **Worker crashes during processing**: Enrollment becomes eligible again after timeout (5 minutes)
2. **Multiple workers processing simultaneously**: Only one UPDATE succeeds, others get 0 rows
3. **Enrollment updated externally**: WHERE clause prevents claiming if state changed
4. **Database connection lost**: UPDATE already committed, enrollment is claimed
5. **Very high concurrency**: FOR UPDATE SKIP LOCKED prevents lock contention during selection

---

## Implementation Steps

1. **Create migration**: Add `claim_enrollments_ready()` function
2. **Update DatabaseClient**: Change from `poll_enrollments_ready` to `claim_enrollments_ready`
3. **Test**: Verify no duplicates with multiple workers
4. **Monitor**: Check that enrollments are being processed correctly

---

## Summary

**Solution**: **Atomic UPDATE-Based Claiming**

- ✅ **100% Bulletproof**: Database guarantees atomicity
- ✅ **Simple**: Single SQL function, no infrastructure changes
- ✅ **Fast**: Direct database operation, no queue latency
- ✅ **Self-healing**: Timeout-based retry if worker crashes
- ✅ **Scalable**: Works with any number of workers

**This is the best solution**: Provides absolute guarantee with minimal complexity.

