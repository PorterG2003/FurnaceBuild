# Email Node Completion Analysis

## Problem Statement

**Email nodes should not be considered "complete" (and we should not advance to the next node) until the message_job has been sent.**

Currently, `current_node_id` is updated to the email node immediately after creating the message_job, but before the email is actually sent. This allows the next node to be processed before the email is sent.

**This affects ALL nodes that follow email nodes**, not just wait nodes:
- Email → Email (second email shouldn't be processed until first is sent)
- Email → Wait (wait shouldn't be processed until email is sent)
- Email → AICategorizer (categorizer shouldn't be processed until email is sent)
- Email → DataSender (data sender shouldn't be processed until email is sent)

**Key Insight**: The problem is not limited to wait nodes - ANY node following an email node should wait until the email is sent.

## Current Behavior

**Email Node Processing** (`worker.ts` lines 165-185):
1. `handleEmailNode()` creates message_job (status: 'pending')
2. `current_node_id` is updated to email node **IMMEDIATELY**
3. Function returns, scheduler continues

**Next Scheduler Run**:
1. `evaluateFlow()` is called with `current_node_id = email node`
2. Finds edges from email node
3. Returns next nodes (wait, email, etc.) **WITHOUT checking if email is sent**
4. Next nodes are processed

**Problem**: Next nodes are processed before the email is actually sent.

## Desired Behavior

**Email Node Processing**:
1. `handleEmailNode()` creates message_job (status: 'pending')
2. `current_node_id` is updated to email node (to track position)
3. Function returns

**Next Scheduler Run**:
1. `evaluateFlow()` is called with `current_node_id = email node`
2. **Checks if email node's message_job has been sent**
3. **If NOT sent**: Return empty array (don't advance to next nodes yet)
4. **If sent**: Find edges from email node and return next nodes
5. Next nodes are processed

**Result**: Next nodes are only processed after the email is sent.

## Solution: Check in `evaluateFlow()`

The fix should be in `evaluateFlow()` - when the current node is an email node, check if the message_job has been sent before returning the next nodes.

### Implementation Location

**File**: `workers/scheduler-worker/src/flow-evaluation.ts`
**Location**: After line 165 (after loading currentNode, before finding next edges)

### Logic

```typescript
// If current node is an email node, check if the message_job has been sent
if (currentNode.node_type === 'email') {
  const { data: messageJobs, error: messageJobsError } = await supabase
    .from('message_jobs')
    .select('id, sent_at, status')
    .eq('enrollment_id', enrollment.id)
    .eq('node_id', currentNode.id)
    .order('created_at', { ascending: false })
    .limit(1); // In normal flow, there should be only one
  
  if (messageJobsError) {
    console.error(`Error checking message job for email node ${currentNode.id}: ${messageJobsError.message}`);
    // Don't advance if we can't check - safer to wait
    return [];
  }
  
  if (!messageJobs || messageJobs.length === 0) {
    // No message_job found - shouldn't happen in normal flow, but don't advance
    console.warn(`No message_job found for email node ${currentNode.id} (enrollment ${enrollment.id})`);
    return [];
  }
  
  const messageJob = messageJobs[0]; // Get the (should be only) message_job
  
  // Check if the message_job has been sent
  const isSent = messageJob.sent_at !== null || messageJob.status === 'sent';
  
  if (!isSent) {
    // Email not sent yet - don't advance to next node
    console.log(`[FLOW ${enrollmentId}] Email node ${currentNode.id} has unsent message_job. Waiting for send...`);
    return [];
  }
  
  // Email has been sent - continue with normal flow evaluation
  console.log(`[FLOW ${enrollmentId}] Email node ${currentNode.id} has message_job sent. Proceeding to next node.`);
}
```

## Why This Approach?

1. **Centralized Logic**: All flow evaluation logic stays in one place
2. **Works for ALL node types**: Any node that follows an email node will wait (wait, email, aiCategorizer, dataSender, etc.)
3. **No changes to node handlers**: Email node handler stays the same
4. **No changes to worker logic**: Worker loop stays the same
5. **Natural blocking**: `evaluateFlow()` returns empty array, so no nodes are processed

## Edge Cases

1. **No message_job found**: Return empty array (don't advance) - shouldn't happen in normal flow
2. **Message job failed**: Return empty array (don't advance) - email wasn't sent successfully
3. **Multiple message_jobs**: Check the most recent one (ordered by `created_at DESC`) - edge case, but handle gracefully

## Impact

This change affects:
- **Email → Wait**: Wait nodes now wait for email to be sent (desired)
- **Email → Email**: Second email now waits for first email to be sent (desired)
- **Email → AICategorizer**: Categorizer now waits for email to be sent (desired)
- **Email → DataSender**: Data sender now waits for email to be sent (desired)
- **Email → Any node**: All nodes following email nodes now wait for email to be sent (desired)

## Performance Impact

- **Additional query**: One query per email node evaluation (only when current_node is email node)
- **Query frequency**: Only when scheduler evaluates flow from an email node
- **Mitigation**: Proper indexing on `message_jobs(enrollment_id, node_id)` (should already exist)

## Testing

- Verify email → wait: Wait node only processes after email is sent
- Verify email → email: Second email only processes after first email is sent
- Verify email → aiCategorizer: Categorizer only processes after email is sent
- Test with failed message_jobs (should not advance)
- Test performance with proper indexing

