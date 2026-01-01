# Enrollment Queue Push Strategy - Analysis

## The Challenge

We want to push enrollments to SQS FIFO queue, but we need to handle two scenarios:

1. **Immediate enrollments**: `next_run_at <= NOW()` → Should be pushed immediately
2. **Future enrollments**: `next_run_at > NOW()` → Should be pushed when they become ready

## When Enrollments Are Created/Updated

### Enrollment Creation
- **When**: Lead is added to a campaign (via API/UI)
- **next_run_at**: Usually set to `NOW()` or very soon (for immediate processing)
- **Location**: Frontend/API creates enrollment record

### Enrollment Updates (next_run_at changes)
- **After wait node**: `next_run_at` is set to future time (e.g., NOW() + 2 minutes)
- **After email node**: Enrollment might complete or move to next node
- **After other nodes**: Similar pattern
- **Location**: Scheduler worker updates `next_run_at` in database

## Solution Options

### Option A: Push on Creation/Update + Scheduled Task (RECOMMENDED)

**Strategy**:
1. **On enrollment creation**: If `next_run_at <= NOW()`, push to queue immediately
2. **On `next_run_at` update**: If `next_run_at <= NOW()`, push to queue immediately
3. **For future enrollments**: Scheduled task (Lambda/EventBridge) runs every 5-10 seconds to check for enrollments that are now ready and push them

**Pros**:
- ✅ Immediate processing for ready enrollments (no delay)
- ✅ Handles future enrollments automatically
- ✅ No need for Lambda to poll constantly (only for future enrollments)
- ✅ Simple logic: push if ready, scheduled task handles the rest

**Cons**:
- ⚠️ Need to add queue push logic to enrollment creation code (frontend/API)
- ⚠️ Need to add queue push logic to scheduler worker (when updating `next_run_at`)
- ⚠️ Still need scheduled task for edge cases (missed pushes, future enrollments)

**Implementation**:
- **Enrollment creation**: Add queue push after creating enrollment (if `next_run_at <= NOW()`)
- **Scheduler worker**: After updating `next_run_at` (e.g., after wait node), push to queue if `next_run_at <= NOW()`
- **Scheduled task**: Lambda that runs every 5-10 seconds, queries for enrollments where `next_run_at <= NOW()` and `state = 'active'` that aren't already in queue, pushes them

---

### Option B: Database Trigger + Push

**Strategy**:
1. Create database trigger on `enrollments` table (INSERT/UPDATE)
2. Trigger calls a PostgreSQL function that pushes to SQS (via AWS Lambda or HTTP)
3. Function checks if `next_run_at <= NOW()`, if yes, pushes to queue

**Pros**:
- ✅ Automatic: No code changes needed in application
- ✅ Handles all cases (creation, updates)

**Cons**:
- ❌ **Complex**: PostgreSQL can't directly call SQS, needs HTTP endpoint or Lambda
- ❌ **Performance**: HTTP calls from database trigger can be slow
- ❌ **Error handling**: Hard to handle SQS failures from database trigger
- ❌ **Not recommended**: Database triggers for external service calls are an anti-pattern

---

### Option C: Scheduled Task Only (No Push on Creation)

**Strategy**:
1. Scheduled Lambda runs every 5 seconds
2. Queries for enrollments where `next_run_at <= NOW()` and `state = 'active'`
3. Pushes all ready enrollments to queue

**Pros**:
- ✅ Simple: Single place for queue pushing logic
- ✅ No code changes needed in enrollment creation/update

**Cons**:
- ❌ **Latency**: Up to 5 seconds delay before enrollment is processed
- ❌ **Inefficient**: Lambda runs constantly even when no enrollments are ready
- ❌ **Not ideal**: Adds unnecessary delay for immediate enrollments

---

## Recommended Approach: Option A (Hybrid)

### Implementation Details

#### 1. Enrollment Creation (Frontend/API)

**Location**: Where enrollments are created (e.g., `lib/supabase/services/enrollments.ts` or API endpoint)

**Logic**:
```typescript
// After creating enrollment
const enrollment = await supabase
  .from('enrollments')
  .insert({...})
  .select()
  .single();

// If enrollment is ready, push to queue
if (enrollment.next_run_at && new Date(enrollment.next_run_at) <= new Date()) {
  await pushEnrollmentToQueue(enrollment.id, enrollment.campaign_id);
}
```

**Helper function**:
```typescript
async function pushEnrollmentToQueue(enrollmentId: string, campaignId: string) {
  const sqsClient = new SQSClient({ region: 'us-west-2' });
  const queueUrl = process.env.ENROLLMENT_QUEUE_URL!;
  
  await sqsClient.send(new SendMessageCommand({
    QueueUrl: queueUrl,
    MessageBody: JSON.stringify({
      enrollment_id: enrollmentId,
      campaign_id: campaignId,
    }),
    MessageGroupId: campaignId || 'default',
    // Content-based deduplication is enabled, so no need for MessageDeduplicationId
  }));
}
```

#### 2. Scheduler Worker (After Updating next_run_at)

**Location**: `workers/scheduler-worker/src/node-handlers/wait-time-handler.ts` and other node handlers

**Logic**:
```typescript
// After updating next_run_at (e.g., in handleWaitTimeNode)
await supabase
  .from('enrollments')
  .update({ next_run_at: calculatedNextRunAt })
  .eq('id', enrollment.id);

// If enrollment is now ready, push to queue
if (new Date(calculatedNextRunAt) <= new Date()) {
  await pushEnrollmentToQueue(enrollment.id, enrollment.campaign_id);
}
```

#### 3. Scheduled Task (Edge Cases & Future Enrollments)

**Purpose**: Catch enrollments that weren't pushed (edge cases, future enrollments that became ready)

**Schedule**: Every 5-10 seconds (configurable)

**Logic**:
```typescript
// Lambda handler
export async function handler(event: ScheduledEvent) {
  // Query enrollments ready to process
  const { data: enrollments } = await supabase
    .from('enrollments')
    .select('id, campaign_id')
    .eq('state', 'active')
    .lte('next_run_at', new Date().toISOString())
    .limit(100);
  
  if (!enrollments || enrollments.length === 0) {
    return { processed: 0 };
  }
  
  // Push to queue (SQS will deduplicate if already in queue)
  // This is safe to run even if enrollment is already in queue
  // because SQS FIFO with content-based deduplication will handle it
  for (const enrollment of enrollments) {
    await pushEnrollmentToQueue(enrollment.id, enrollment.campaign_id);
  }
  
  return { processed: enrollments.length };
}
```

**Why this is safe**:
- SQS FIFO with content-based deduplication will automatically deduplicate messages with the same body
- If enrollment is already in queue, SQS won't add a duplicate
- This acts as a "safety net" for edge cases

---

## Edge Cases Handled

1. **Enrollment created with future `next_run_at`**: Scheduled task will push it when ready
2. **Enrollment `next_run_at` updated to future**: Scheduled task will push it when ready
3. **Queue push fails**: Scheduled task will retry (enrollment still in database)
4. **Worker crashes before processing**: Message becomes visible again after visibility timeout
5. **Duplicate pushes**: SQS FIFO deduplication prevents duplicates

---

## Summary

**Recommended**: **Option A - Hybrid Approach**

- ✅ Push immediately when enrollment is created/updated and ready
- ✅ Scheduled task handles future enrollments and edge cases
- ✅ Minimal latency for ready enrollments
- ✅ Safe: SQS deduplication handles any duplicate pushes

**Implementation**:
1. Add queue push to enrollment creation code
2. Add queue push to scheduler worker (after updating `next_run_at`)
3. Create scheduled Lambda task (safety net for future enrollments)

**No Lambda pusher needed**: We push directly from application code, scheduled task is just a safety net.

