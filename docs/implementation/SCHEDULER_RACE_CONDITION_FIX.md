# Scheduler Race Condition Fix - Analysis & Recommendation

## Problem

**Current Issue**: Multiple scheduler workers are processing the same enrollment simultaneously, creating duplicate message jobs.

**Root Cause**: 
- Workers poll database directly: `SELECT * FROM enrollments WHERE state = 'active' AND next_run_at <= NOW()`
- No locking mechanism prevents multiple workers from picking up the same enrollment
- Race condition: Worker 1 and Worker 2 both see enrollment X as ready, both process it

**Evidence**:
- 4 message jobs created for a flow with only 2 email nodes
- 2 jobs for `email-1` (same node_id: `3dc696aa...`)
- 2 jobs for `email-2` (same node_id: `8a9ae1af...`)
- All jobs have nearly identical timestamps (within milliseconds)

---

## Solution Options

### Option A: Database Row-Level Locking (SELECT FOR UPDATE SKIP LOCKED) ⭐ **RECOMMENDED**

**How it works**:
- Use PostgreSQL's `SELECT FOR UPDATE SKIP LOCKED` clause
- First worker locks the row, second worker skips it automatically
- Atomic operation at database level

**Implementation**:
```sql
SELECT * FROM enrollments 
WHERE state = 'active' 
  AND next_run_at <= NOW()
ORDER BY next_run_at ASC
LIMIT 100
FOR UPDATE SKIP LOCKED;
```

**Pros**:
- ✅ **Simple**: Single query change, no infrastructure changes
- ✅ **Atomic**: Database guarantees no duplicates
- ✅ **Performant**: No additional latency, works at database speed
- ✅ **Reliable**: PostgreSQL handles all edge cases (crashes, timeouts)
- ✅ **Proven**: Already used in codebase (see `scheduled_jobs` function)
- ✅ **No additional infrastructure**: Works with existing Supabase setup
- ✅ **Best performance**: Direct database query, no queue overhead

**Cons**:
- ⚠️ Requires Supabase to support raw SQL (via RPC function or direct query)
- ⚠️ Need to ensure connection pooling handles locks correctly (Supabase does this)

**Complexity**: Low (1-2 hours)
**Performance Impact**: None (actually improves by avoiding duplicate work)
**Reliability**: High (database-level guarantee)

---

### Option B: SQS Queue for Enrollments

**How it works**:
- Create `enrollment_queue` (SQS)
- Separate "enrollment pusher" service pushes enrollment IDs to queue
- Workers pull from queue (SQS guarantees no duplicates)

**Architecture**:
```
Enrollment Pusher (Lambda/ECS) 
  → Polls DB every 5s
  → Pushes enrollment IDs to SQS
  → Workers pull from SQS
```

**Pros**:
- ✅ Decoupled: Pusher and workers don't know about each other
- ✅ SQS handles deduplication automatically
- ✅ Built-in retries and DLQ support
- ✅ Scales independently

**Cons**:
- ❌ **More infrastructure**: New Lambda/ECS service, new SQS queue
- ❌ **Additional latency**: DB → Queue → Worker (vs direct DB → Worker)
- ❌ **More complex**: Two services to maintain, more failure points
- ❌ **Cost**: Additional SQS costs (minimal but not zero)
- ❌ **Overkill**: SQS is designed for high-throughput async processing, but we're doing synchronous flow evaluation

**Complexity**: Medium-High (1-2 days)
**Performance Impact**: Slight latency increase (queue hop)
**Reliability**: High (but more moving parts)

---

### Option C: Optimistic Locking (State-Based)

**How it works**:
- Add `processing_state` or `version` column to enrollments
- Atomically update: `UPDATE enrollments SET processing_state = 'processing' WHERE id = X AND processing_state = 'active'`
- Only one worker succeeds (others get 0 rows updated)

**Implementation**:
```sql
UPDATE enrollments 
SET processing_state = 'processing',
    processing_started_at = NOW()
WHERE id = $1 
  AND state = 'active'
  AND processing_state = 'active'
RETURNING *;
```

**Pros**:
- ✅ Simple state management
- ✅ No locks needed (uses WHERE clause for atomicity)

**Cons**:
- ❌ **State management complexity**: Need to handle crashes (worker dies while processing)
- ❌ **Cleanup required**: Need background job to reset stuck `processing_state`
- ❌ **Race condition risk**: Two workers can both see `processing_state = 'active'` before either updates
- ❌ **Less reliable**: Requires application-level cleanup logic

**Complexity**: Medium (4-6 hours)
**Performance Impact**: Minimal
**Reliability**: Medium (requires cleanup mechanisms)

---

### Option D: Advisory Locks (PostgreSQL)

**How it works**:
- Use PostgreSQL advisory locks: `SELECT pg_advisory_lock(enrollment_id::bigint)`
- Each enrollment gets a unique lock
- Workers try to acquire lock, skip if already locked

**Pros**:
- ✅ Database-native
- ✅ Automatic cleanup on connection close

**Cons**:
- ❌ **Connection management**: Locks are tied to database connections
- ❌ **Complex**: Need to ensure locks are released properly
- ❌ **Less intuitive**: Advisory locks are less common than row locks
- ❌ **Connection pooling issues**: If using connection pooling, locks might persist

**Complexity**: Medium (4-6 hours)
**Performance Impact**: Minimal
**Reliability**: Medium (connection management complexity)

---

## Recommendation: **Option A: SELECT FOR UPDATE SKIP LOCKED**

### Why This Is Best

1. **Least Bug-Prone**: 
   - Database-level guarantee (no application logic needed)
   - PostgreSQL handles all edge cases (crashes, timeouts, connection drops)
   - No state management or cleanup required

2. **Best Performance**:
   - Direct database query (no queue hop)
   - No additional latency
   - Workers process enrollments as fast as database allows

3. **Simplest Implementation**:
   - Single query change
   - No new infrastructure
   - No additional services to maintain

4. **Proven in Codebase**:
   - Already used in `scheduled_jobs` function (see migration `20251121120000_add_nodes_and_job_scheduling.sql`)
   - Pattern is familiar and tested

### Implementation Plan

#### Step 1: Create Supabase RPC Function

Since Supabase's PostgREST doesn't directly support `FOR UPDATE SKIP LOCKED` in `.select()` queries, we'll create a PostgreSQL function:

```sql
CREATE OR REPLACE FUNCTION poll_enrollments_ready(
  p_batch_size INTEGER DEFAULT 100
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
BEGIN
  RETURN QUERY
  SELECT 
    e.id,
    e.campaign_id,
    e.lead_id,
    e.current_node_id,
    e.state,
    e.next_run_at,
    e.flow_position,
    e.created_at,
    e.updated_at
  FROM enrollments e
  WHERE e.state = 'active'
    AND e.next_run_at <= NOW()
  ORDER BY e.next_run_at ASC
  LIMIT p_batch_size
  FOR UPDATE SKIP LOCKED; -- Prevents multiple workers from picking same enrollment
END;
$$ LANGUAGE plpgsql;
```

#### Step 2: Update DatabaseClient

Modify `workers/scheduler-worker/src/database.ts`:

```typescript
async poll(): Promise<Enrollment[]> {
  try {
    // Use RPC function instead of direct query
    const { data, error } = await this.supabase
      .rpc('poll_enrollments_ready', {
        p_batch_size: this.batchSize
      });

    if (error) {
      console.error('Error polling enrollments:', error);
      throw error;
    }

    return (data as Enrollment[]) || [];
  } catch (error) {
    console.error('Error polling database:', error);
    throw error;
  }
}
```

#### Step 3: Test

1. Deploy migration
2. Deploy updated worker
3. Run test with 2+ workers
4. Verify no duplicate message jobs

### Why Not SQS Queue?

While SQS is excellent for high-throughput async processing (like send workers), it's overkill for scheduler workers:

1. **Synchronous Flow Evaluation**: Scheduler needs to evaluate flows and make decisions. This is fast (< 100ms per enrollment). Queue adds latency without benefit.

2. **Database-Centric**: Scheduler is already database-centric (queries enrollments, creates message_jobs). Adding a queue adds an extra hop.

3. **Complexity**: SQS queue would require:
   - New Lambda/ECS service to push enrollment IDs
   - New SQS queue
   - More infrastructure to maintain
   - More failure points

4. **Cost**: Additional SQS costs (minimal, but unnecessary)

**SQS is perfect for send workers** (high throughput, async, decoupled), but **not needed for scheduler workers** (low throughput, synchronous, database-centric).

---

## Summary

**Best Solution**: **Option A - SELECT FOR UPDATE SKIP LOCKED**

- ✅ Least bug-prone (database-level guarantee)
- ✅ Best performance (direct query, no queue hop)
- ✅ Simplest implementation (single query change)
- ✅ Proven pattern (already in codebase)

**Implementation Time**: 1-2 hours
**Risk**: Low (database-level guarantee)
**Performance**: Optimal (no additional latency)

**Next Steps**:
1. Create migration with RPC function
2. Update `DatabaseClient.poll()` to use RPC
3. Test with multiple workers
4. Deploy

