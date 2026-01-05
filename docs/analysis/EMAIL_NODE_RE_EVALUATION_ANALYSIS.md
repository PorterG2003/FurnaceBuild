# Email Node Re-Evaluation Analysis

## Question

If `evaluateFlow()` returns an empty array (because the email hasn't been sent yet), how does the scheduler know to pick up the enrollment again later to check if the email has been sent?

## Current Behavior Analysis

### When Email Node is Processed

**Email Node Processing** (`worker.ts` lines 165-185):
1. `handleEmailNode()` creates message_job (status: 'pending')
2. `current_node_id` is updated to email node (line 182)
3. `next_run_at` is **NOT updated** (stays as is, or becomes null?)

### When `evaluateFlow()` Returns Empty Array

**Worker Logic** (`worker.ts` lines 150-157):
```typescript
if (nextNodes.length === 0) {
  // No next nodes - mark enrollment as completed
  console.log(`[ENROLLMENT ${enrollmentId}] No next nodes found. Marking enrollment as completed.`);
  await this.supabase
    .from('enrollments')
    .update({ state: 'completed' })
    .eq('id', enrollment.id);
  return;
}
```

**Problem**: If `evaluateFlow()` returns empty array (because email not sent), the enrollment is marked as **completed**, which is wrong!

### How Enrollments Are Picked Up

**Database Polling** (`database.ts` lines 40-48):
- Uses RPC function `claim_enrollments_ready`
- This function selects enrollments where `next_run_at <= NOW()` and `state = 'active'`
- If `next_run_at` is not set or is in the future, enrollment won't be picked up

**Key Question**: After an email node is processed, what is `next_run_at`?

## The Solution

We need to distinguish between:
1. **Flow is complete** (no more nodes) → Mark as completed
2. **Email not sent yet** (waiting for send) → Update `next_run_at` to check again later

### Option 1: Update `next_run_at` in `evaluateFlow()` (Recommended)

When `evaluateFlow()` detects that an email node's message hasn't been sent:
1. Return empty array (to prevent processing next nodes)
2. **Update `enrollment.next_run_at`** to a short time in the future (e.g., 30 seconds, 1 minute)
3. This allows the scheduler to pick up the enrollment again later

**Pros**:
- Enrollments are automatically re-evaluated
- No changes to worker logic needed
- Natural polling behavior

**Cons**:
- Need to update enrollment in `evaluateFlow()` (slightly breaks separation of concerns)
- Need to handle polling interval (don't poll too frequently)

### Option 2: Update `next_run_at` in Worker

In the worker, when `evaluateFlow()` returns empty array:
1. Check if current node is an email node
2. If yes, check if message_job has been sent
3. If not sent, update `next_run_at` instead of marking as completed

**Pros**:
- Keeps `evaluateFlow()` pure (just returns nodes)
- Explicit handling in worker

**Cons**:
- Need to duplicate the email check in worker
- More complex worker logic

### Option 3: Don't Return Empty Array - Return Current Node

Instead of returning empty array, return the current email node again:
1. `evaluateFlow()` detects email not sent
2. Returns array with current email node
3. Worker processes email node again
4. Email node handler sees message_job already exists, skips creation

**Pros**:
- No special handling needed
- Enrollment stays "active"

**Cons**:
- Email node handler needs to handle "already processed" case
- Could cause issues if handler doesn't handle re-processing gracefully
- Not clean - the node is already "at" the email node

## Recommended Solution: Option 1 (Update next_run_at in evaluateFlow)

When `evaluateFlow()` detects that an email node's message hasn't been sent:

1. **Update `enrollment.next_run_at`** to check again in a short interval (e.g., 30 seconds)
2. **Return empty array** (to prevent processing next nodes)
3. Worker checks `if (nextNodes.length === 0)` but enrollment is NOT marked as completed because `next_run_at` is set

**Wait, but the worker code marks it as completed...**

We need to modify the worker logic to distinguish between:
- Empty array + `next_run_at` is NULL/future → Flow complete (mark as completed)
- Empty array + `next_run_at` is in past → Waiting for email (already updated in evaluateFlow, do nothing)

Actually, better approach: In `evaluateFlow()`, when email not sent:
1. Update `enrollment.next_run_at` to check again later (e.g., NOW() + 30 seconds)
2. Return empty array

Then in worker, when `nextNodes.length === 0`:
1. Check if `next_run_at` is set
2. If `next_run_at` is set and in future → Don't mark as completed (evaluation updated it)
3. If `next_run_at` is NULL or in past → Mark as completed (no more nodes)

**OR simpler**: Just update `next_run_at` in `evaluateFlow()` and don't mark as completed if `next_run_at` is set.

Actually, let me think about this differently. The worker already checks `next_run_at` via the database polling. So if we update `next_run_at` in `evaluateFlow()`, the enrollment will be picked up again automatically. But the worker will still mark it as completed because `nextNodes.length === 0`.

So we need to modify the worker logic to not mark as completed if `next_run_at` is set.

## Implementation Plan

### 1. Modify `evaluateFlow()` (flow-evaluation.ts)

When current node is email node and message not sent:
1. Update `enrollment.next_run_at` to check again later (e.g., NOW() + 30 seconds)
2. Return empty array

### 2. Modify Worker Logic (worker.ts lines 150-157)

When `nextNodes.length === 0`:
1. Check if `enrollment.next_run_at` is set and in the future
2. If yes → Don't mark as completed (evaluation updated it, will be re-evaluated)
3. If no → Mark as completed (no more nodes)

**OR**: Use a special return value or check the enrollment state after `evaluateFlow()` returns.

Actually, the simplest approach: After `evaluateFlow()` returns empty, reload the enrollment and check if `next_run_at` was updated. If it was updated, don't mark as completed.

## Proposed Implementation

### In `evaluateFlow()` (flow-evaluation.ts)

```typescript
// If current node is an email node, check if the message_job has been sent
if (currentNode.node_type === 'email') {
  const { data: messageJobs, error: messageJobsError } = await supabase
    .from('message_jobs')
    .select('id, sent_at, status, scheduled_at')
    .eq('enrollment_id', enrollment.id)
    .eq('node_id', currentNode.id)
    .order('created_at', { ascending: false })
    .limit(1);
  
  if (messageJobsError) {
    console.error(`Error checking message job for email node ${currentNode.id}: ${messageJobsError.message}`);
    // Don't advance if we can't check - update next_run_at to retry in 1 minute
    await supabase
      .from('enrollments')
      .update({ next_run_at: new Date(Date.now() + 60000).toISOString() })
      .eq('id', enrollment.id);
    return [];
  }
  
  if (!messageJobs || messageJobs.length === 0) {
    console.warn(`No message_job found for email node ${currentNode.id} (enrollment ${enrollment.id})`);
    // Update next_run_at to retry in 1 minute
    await supabase
      .from('enrollments')
      .update({ next_run_at: new Date(Date.now() + 60000).toISOString() })
      .eq('id', enrollment.id);
    return [];
  }
  
  const messageJob = messageJobs[0];
  const isSent = messageJob.sent_at !== null || messageJob.status === 'sent';
  
  if (!isSent) {
    // Email not sent yet - check when it's scheduled to be sent
    const scheduledAt = new Date(messageJob.scheduled_at);
    const now = new Date();
    
    // If scheduled_at is in the future, wait until after it should be sent
    // If scheduled_at is in the past (email should have been sent), check shortly after
    const checkTime = scheduledAt > now 
      ? new Date(scheduledAt.getTime() + 60000) // 1 minute after scheduled time
      : new Date(now.getTime() + 30000); // 30 seconds from now if already past scheduled time
    
    console.log(`[FLOW ${enrollmentId}] Email node ${currentNode.id} has unsent message_job (scheduled: ${scheduledAt.toISOString()}). Setting next_run_at to ${checkTime.toISOString()}.`);
    await supabase
      .from('enrollments')
      .update({ next_run_at: checkTime.toISOString() })
      .eq('id', enrollment.id);
    return [];
  }
  
  // Email has been sent - continue with normal flow evaluation
  console.log(`[FLOW ${enrollmentId}] Email node ${currentNode.id} has message_job sent. Proceeding to next node.`);
}
```

### In Worker (worker.ts lines 150-157)

```typescript
if (nextNodes.length === 0) {
  // No next nodes - check if this is because we're waiting for email to be sent
  // Reload enrollment to see if next_run_at was updated by evaluateFlow
  const { data: updatedEnrollment } = await this.supabase
    .from('enrollments')
    .select('next_run_at')
    .eq('id', enrollment.id)
    .single();
  
  if (updatedEnrollment?.next_run_at && new Date(updatedEnrollment.next_run_at) > new Date()) {
    // next_run_at was updated by evaluateFlow (waiting for email) - don't mark as completed
    console.log(`[ENROLLMENT ${enrollmentId}] No next nodes, but next_run_at is set (waiting for email). Will re-evaluate later.`);
    return;
  }
  
  // No next nodes and next_run_at not set - flow is complete
  console.log(`[ENROLLMENT ${enrollmentId}] No next nodes found. Marking enrollment as completed.`);
  await this.supabase
    .from('enrollments')
    .update({ state: 'completed' })
    .eq('id', enrollment.id);
  return;
}
```

## Alternative: Simpler Approach

Instead of reloading enrollment, we could:
1. Have `evaluateFlow()` return a special value/flag indicating "waiting for email"
2. Or: Always update `next_run_at` in `evaluateFlow()` when email not sent, and worker checks enrollment state after calling `evaluateFlow()`

Actually, the simplest: After `evaluateFlow()` returns empty, check the enrollment's `next_run_at`. If it was just updated (is in the future), don't mark as completed.

But we need to know what the `next_run_at` was BEFORE calling `evaluateFlow()`. So we'd need to:
1. Save `enrollment.next_run_at` before calling `evaluateFlow()`
2. Call `evaluateFlow()`
3. Reload enrollment
4. If `next_run_at` changed and is in future → Don't mark as completed
5. If `next_run_at` unchanged → Mark as completed

This is a bit messy. Better to have `evaluateFlow()` return a flag or check enrollment state.

## Recommended Final Approach

**In `evaluateFlow()`**: When email not sent, update `next_run_at` and return empty array.

**In Worker**: After `evaluateFlow()` returns empty, reload enrollment and check if `next_run_at` is set. If it is, don't mark as completed.

