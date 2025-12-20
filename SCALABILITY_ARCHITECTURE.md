# Scalable Flow Execution Architecture

## Problem Statement

The current system stores nodes in `campaigns.flow_data` as JSONB, which creates several scalability issues:

1. **No Foreign Keys**: `lead_states.node_id` is TEXT with no FK relationship
2. **Slow Queries**: Querying JSONB for node information is slow at scale
3. **No Job Scheduling**: No system for scheduling jobs at irregular intervals (waitTime nodes)
4. **Inefficient Worker Queries**: Finding "ready to process" leads requires complex JSONB queries

## Solution: Nodes Table + Job Scheduling

### 1. Nodes Table (`nodes`)

**Purpose**: Normalize node data from `campaigns.flow_data` for fast queries and FK relationships.

**Benefits**:
- ✅ Foreign key relationships (`lead_states.node_uuid → nodes.id`)
- ✅ Fast queries by node type, campaign, etc.
- ✅ Proper indexes for common query patterns
- ✅ Auto-synced from `flow_data` via trigger

**Structure**:
```sql
nodes (
  id UUID PRIMARY KEY,
  campaign_id UUID → campaigns(id),
  flow_node_id TEXT, -- React Flow ID (e.g., "email-1")
  node_type TEXT, -- 'email', 'waitTime', etc.
  node_data JSONB, -- Node configuration
  position_x, position_y -- For debugging
)
```

**Auto-Sync**: When `campaigns.flow_data` is updated, a trigger automatically syncs nodes to the `nodes` table.

### 2. Scheduled Jobs Table (`scheduled_jobs`)

**Purpose**: Schedule jobs at irregular intervals based on node completion.

**Use Cases**:
- WaitTime nodes: Schedule execution N seconds after previous node completes
- Email nodes: Schedule for specific times
- Any delayed execution based on flow position

**Benefits**:
- ✅ Efficient worker polling with `SKIP LOCKED`
- ✅ Handles irregular intervals (not a traditional queue)
- ✅ Retry logic built-in
- ✅ Indexed for fast "ready to execute" queries

**Structure**:
```sql
scheduled_jobs (
  id UUID PRIMARY KEY,
  campaign_id UUID,
  lead_id UUID,
  lead_state_id UUID,
  node_id UUID → nodes(id),
  job_type TEXT,
  scheduled_at TIMESTAMPTZ, -- When to execute
  executed_at TIMESTAMPTZ,
  status TEXT, -- 'pending', 'executing', 'completed', 'failed'
  job_data JSONB
)
```

**Critical Index**: `idx_scheduled_jobs_pending_execution` on `(scheduled_at, status)` WHERE `status = 'pending' AND scheduled_at <= NOW()`

### 3. Updated Lead States

**Changes**:
- Added `node_uuid` column (FK to `nodes.id`)
- Kept `node_id` TEXT for backward compatibility
- New indexes for worker queries

**Key Indexes**:
- `idx_lead_states_ready_to_process`: Find leads ready to process
- `idx_lead_states_next_to_schedule`: Find completed states to schedule next jobs

## Worker Architecture

### Job Execution Flow

1. **Node Completes** → `schedule_next_node_job()` is called
2. **Calculate Next Node** → Traverse flow edges to find next node(s)
3. **Calculate Delay** → If next node is `waitTime`, calculate `scheduled_at = NOW() + wait_duration`
4. **Create Job** → Insert into `scheduled_jobs` with `scheduled_at`
5. **Worker Polls** → `get_next_scheduled_jobs()` returns jobs where `scheduled_at <= NOW()`
6. **Execute** → Worker processes job, updates `lead_state.status`

### Worker Query Pattern

```sql
-- Get next batch of jobs ready to execute
SELECT * FROM get_next_scheduled_jobs(100);
-- Uses SKIP LOCKED to prevent multiple workers from picking same job
```

### Scheduling Pattern

```sql
-- After a node completes, schedule next job
SELECT schedule_next_node_job(lead_state_id, wait_duration_seconds);
-- This function:
-- 1. Finds next node(s) in flow
-- 2. Calculates delay if waitTime node
-- 3. Creates scheduled_job record
```

## Query Performance

### Before (JSONB queries)
```sql
-- Slow: Must parse JSONB for every query
SELECT * FROM lead_states ls
JOIN campaigns c ON c.id = ls.campaign_id
WHERE c.flow_data->'nodes' @> '[{"id": "email-1"}]'::jsonb
  AND ls.status = 'queued';
```

### After (Normalized)
```sql
-- Fast: Indexed FK relationship
SELECT * FROM lead_states ls
JOIN nodes n ON n.id = ls.node_uuid
WHERE n.flow_node_id = 'email-1'
  AND ls.status = 'queued';
```

## Scalability Benefits

1. **Indexed Queries**: All common queries use indexes, not JSONB parsing
2. **FK Integrity**: Database enforces referential integrity
3. **Concurrent Workers**: `SKIP LOCKED` allows multiple workers safely
4. **Efficient Polling**: Indexed queries for "ready to execute" jobs
5. **Horizontal Scaling**: Workers can scale independently

## Migration Strategy

1. **Run Migration**: Creates `nodes` and `scheduled_jobs` tables
2. **Sync Existing Data**: Trigger auto-syncs nodes from existing `flow_data`
3. **Backfill**: Update `lead_states.node_uuid` from `nodes` table
4. **Gradual Rollout**: Keep `node_id` TEXT column during transition

## Next Steps

1. **Implement Flow Traversal**: Complete `schedule_next_node_job()` to traverse flow edges
2. **Worker Implementation**: Create worker service that polls `get_next_scheduled_jobs()`
3. **Node Completion Handler**: Call `schedule_next_node_job()` when nodes complete
4. **Monitoring**: Add metrics for job queue depth, execution times, etc.

## Example: WaitTime Node Flow

```
1. Lead completes "Email" node
2. System finds next node is "WaitTime" (5 minutes)
3. schedule_next_node_job() creates scheduled_job:
   - scheduled_at = NOW() + 5 minutes
   - job_type = 'waitTime'
4. Worker polls every 30 seconds
5. At 5 minutes, job appears in get_next_scheduled_jobs()
6. Worker executes, updates lead_state.status = 'processed'
7. System schedules next node (after waitTime)
```

This architecture scales to millions of leads and thousands of concurrent jobs.


