# Wait Node Send Dependency Analysis

## Problem Statement

Wait nodes are currently being processed immediately after email nodes are scheduled (message_job created), but they should only be processed AFTER the email has been sent (message_job.sent_at is set).

**Current Behavior**:
1. Email node processed → message_job created (status: 'pending')
2. Scheduler updates `current_node_id` to email node
3. Next scheduler run → evaluates flow from email node → returns wait node
4. Wait node processed → `current_node_id` updated to wait node
5. Email is sent (by send worker, asynchronously)

**Desired Behavior**:
1. Email node processed → message_job created (status: 'pending')
2. Scheduler updates `current_node_id` to email node
3. Next scheduler run → evaluates flow from email node → checks if email is sent
4. **If email NOT sent**: Don't process wait node yet, return empty array or current node
5. **If email IS sent**: Return wait node → process wait node → `current_node_id` updated to wait node

## Code Flow Analysis

### Current Implementation

**Email Node Processing** (`worker.ts` lines 165-189):
1. Calls `handleEmailNode()` → creates `message_job` with `status: 'pending'`, `scheduled_at` set
2. Updates `enrollment.current_node_id` to email node
3. Function returns, scheduler continues to next enrollment

**Flow Evaluation** (`flow-evaluation.ts` lines 167-202):
1. Loads current node (email node) from database
2. Finds edges from current node's `flow_node_id`
3. Returns target nodes (wait node) without checking if email is sent
4. Does NOT check `message_jobs` table

**Wait Node Processing** (`worker.ts` lines 190-199):
1. Calls `handleWaitTimeNode()` → updates `current_node_id` to wait node, sets `next_run_at`
2. No dependency on email being sent

### Required Changes

To make wait nodes process only after emails are sent, we need to modify the flow evaluation logic.

**Option 1: Check in `evaluateFlow()` Before Returning Next Nodes**

When `evaluateFlow()` finds the next node(s) after an email node, check if the message_job for that email node has been sent before returning the wait node.

**Pros**:
- Centralized logic in flow evaluation
- Prevents wait node from being processed until email is sent
- Clean separation of concerns

**Cons**:
- Need to query `message_jobs` table during flow evaluation
- Need to handle edge cases (no message_job found, failed jobs, etc.)
- More complex flow evaluation logic

**Note**: There should typically be only ONE message_job per email node per enrollment. The scheduler creates one message_job when processing an email node, and the send worker retries the same job if it fails (using `retry_count`), rather than creating new jobs.

**Option 2: Check in Worker Before Processing Wait Node**

In the worker's node processing loop, before processing a wait node, check if the previous node (if it's an email node) has all its message_jobs sent.

**Pros**:
- Keeps flow evaluation simple (just returns next nodes)
- Explicit dependency checking in worker

**Cons**:
- Need to track previous node type
- Logic split between flow evaluation and worker
- More complex worker logic

**Option 3: Don't Advance to Wait Node Until Email is Sent**

After processing an email node, don't update `current_node_id` until the message_job is sent. Keep `current_node_id` on the email node, and only advance when email is sent.

**Pros**:
- Most explicit dependency
- Flow evaluation naturally prevents wait node from being processed

**Cons**:
- Need a mechanism to check message_job status before advancing
- How does scheduler know when to check? (polling? event-driven?)
- Could require changes to enrollment polling logic

## Recommended Approach: Option 1 (Check in evaluateFlow)

Modify `evaluateFlow()` to check if the current node is an email node, and if so, verify that all message_jobs for that email node have been sent before returning the next nodes.

### Implementation Steps

1. **In `evaluateFlow()`** (after line 165, before returning filteredNodes):
   - If `currentNode.node_type === 'email'`:
     - Query `message_jobs` table for this enrollment and node_id
     - Check if the message_job has `sent_at IS NOT NULL` (or `status = 'sent'`)
     - If NOT sent: Return empty array (don't advance to wait node yet)
     - If sent: Continue with normal flow evaluation

2. **Edge Cases to Handle**:
   - What if message_job doesn't exist? (shouldn't happen in normal flow, but handle gracefully - return empty array)
   - What if message_job.status = 'failed'? (should we still advance? probably not - return empty array)
   - What if multiple message_jobs exist for same email node? (edge case - check if ALL are sent, or just the most recent one? Probably check if ANY are sent successfully)

3. **Performance Considerations**:
   - Additional query to `message_jobs` table for each email node evaluation
   - Could be optimized with a JOIN if needed
   - Index on `message_jobs(node_id, enrollment_id, status, sent_at)` would help

### Code Changes Required

**File**: `workers/scheduler-worker/src/flow-evaluation.ts`

**Location**: After line 165 (after loading currentNode, before finding next edges)

**Logic**:
```typescript
// If current node is an email node, check if the message_job has been sent
if (currentNode.node_type === 'email') {
  const { data: messageJobs, error: messageJobsError } = await supabase
    .from('message_jobs')
    .select('id, sent_at, status')
    .eq('enrollment_id', enrollment.id)
    .eq('node_id', currentNode.id)
    .order('created_at', { ascending: false }); // Get most recent first
  
  if (messageJobsError) {
    console.error(`Error checking message jobs for email node ${currentNode.id}: ${messageJobsError.message}`);
    // Don't advance if we can't check - safer to wait
    return [];
  }
  
  if (!messageJobs || messageJobs.length === 0) {
    // No message_jobs found - shouldn't happen in normal flow, but don't advance
    console.warn(`No message_jobs found for email node ${currentNode.id} (enrollment ${enrollment.id})`);
    return [];
  }
  
  // Check if the message_job(s) have been sent
  // In normal flow, there should be only one, but handle multiple if they exist
  const hasSentJob = messageJobs.some(job => job.sent_at !== null || job.status === 'sent');
  
  if (!hasSentJob) {
    // Email not sent yet - don't advance to wait node
    console.log(`[FLOW ${enrollmentId}] Email node ${currentNode.id} has unsent message_job(s). Waiting for send...`);
    return [];
  }
  
  // Email has been sent - continue with normal flow evaluation
  console.log(`[FLOW ${enrollmentId}] Email node ${currentNode.id} has message_job sent. Proceeding to next node.`);
}
```

**Note**: The query needs to use the correct fields. Need to verify:
- Does `message_jobs` have `enrollment_id` or `lead_id` + `campaign_id`?
- Does `message_jobs` have `node_id` field?

## Alternative Approach: Option 3 (Event-Driven)

Instead of polling, use database triggers or application events to advance enrollment when message_job is sent.

**Pros**:
- More efficient (no polling)
- Immediate advancement when email is sent
- Event-driven architecture

**Cons**:
- Requires database triggers or event system
- More complex infrastructure
- Potential for race conditions

**Not recommended** for now - polling approach is simpler and more explicit.

## Impact Assessment

### Changes Required

1. **`flow-evaluation.ts`**: Add message_job status check before returning next nodes
2. **Database queries**: Additional query to `message_jobs` table (with proper indexing)
3. **Error handling**: Handle cases where message_jobs don't exist or have errors
4. **Testing**: Verify behavior with multiple message_jobs, failed jobs, etc.

### Performance Impact

- **Additional query**: One query per email node evaluation (only when current_node is email node)
- **Query frequency**: Only when scheduler evaluates flow from an email node (not every evaluation)
- **Mitigation**: Proper indexing on `message_jobs` table (should already exist)

### Backward Compatibility

- **No breaking changes**: Existing flows will continue to work
- **Behavior change**: Wait nodes will now wait for emails to be sent (desired behavior)
- **Potential issues**: None expected - this is a bug fix, not a feature change

## Conclusion

**Recommended Solution**: Option 1 - Check in `evaluateFlow()` before returning next nodes.

**Changes Required**:
- Modify `flow-evaluation.ts` to check message_job status when current node is email node
- Query `message_jobs` table to verify all jobs are sent
- Return empty array if emails not sent, normal flow if all sent

**Complexity**: Low to Medium
- Simple logic change in one function
- One additional database query (with proper indexing)
- Clear and explicit dependency

**Testing Needed**:
- Verify wait nodes only process after emails are sent
- Test with single message_job (normal case)
- Test edge case: multiple message_jobs for same email node (should check if any are sent)
- Test with failed message_jobs (should not advance)
- Test performance with proper indexing

