# Flow Evaluation Deep Dive Analysis

## Problem Context

Wait nodes are appearing in the activity timeline before emails are sent. The user confirms:
- It's NOT from branching
- The second email is NOT on the activity (so it's not evaluating too far ahead)
- Need to understand what `evaluateFlow()` actually returns and how nodes are processed

## Flow Evaluation Logic Analysis

### 1. Entry Point Evaluation (No current_node_id)

**Code Location**: `flow-evaluation.ts` lines 60-149

When `enrollment.current_node_id` is NULL (entry point):

1. Finds leadSource node from database (lines 64-75)
2. Finds edges starting from leadSource's `flow_node_id` (line 82)
3. Gets target `flow_node_id`s from edges (line 92)
4. Loads corresponding database nodes (lines 96-100)
5. Filters out leadSource nodes (lines 191-193)
6. **Returns**: Array of nodes (line 202) - Could be ONE or MULTIPLE nodes

**Key Observation**: If there are multiple edges from leadSource (parallel paths), it returns ALL target nodes.

### 2. Sequential Node Evaluation (current_node_id is set)

**Code Location**: `flow-evaluation.ts` lines 150-202

When `enrollment.current_node_id` is set (e.g., at email-1):

1. Loads current node from database (lines 152-157)
2. Finds edges starting from current node's `flow_node_id` (line 168)
3. Gets target `flow_node_id`s from edges (line 176)
4. Loads corresponding database nodes (lines 179-183)
5. Filters out leadSource nodes (lines 191-193)
6. **Returns**: Array of nodes (line 202) - Could be ONE or MULTIPLE nodes

**Key Observation**: For sequential flows like `email-1 -> wait-1`, there should only be ONE edge from email-1, so it should return ONE node (wait-1).

### 3. Node Processing Loop

**Code Location**: `worker.ts` lines 160-281

The scheduler processes nodes in a loop:

```typescript
for (const node of nextNodes) {
  // Process each node
  if (node.node_type === 'email') {
    // Create message_job
    // Update current_node_id to email node
  } else if (node.node_type === 'waitTime') {
    // Update current_node_id to wait node
    // Set next_run_at
  }
}
```

**Critical Behavior**:
- Processes ALL nodes returned by `evaluateFlow()` in ONE iteration
- Does NOT re-evaluate flow after processing each node
- Does NOT stop after processing one node

### 4. Email Node Processing

**Code Location**: `worker.ts` lines 165-189

When processing an email node:

1. Calls `handleEmailNode()` - creates `message_job` (line 168)
2. **THEN** updates `enrollment.current_node_id` to email node (lines 180-183)
3. Continues to next node in loop (if any)

**Key Observation**: The email node updates `current_node_id` AFTER creating the message_job, but BEFORE the loop completes.

### 5. Wait Node Processing

**Code Location**: `worker.ts` lines 190-199 and `wait-time-handler.ts` lines 54-61

When processing a wait node:

1. Calls `handleWaitTimeNode()` 
2. **IMMEDIATELY** updates `enrollment.current_node_id` to wait node (inside handler, line 58)
3. Sets `next_run_at` to future time
4. Loop continues (if any more nodes)

**Key Observation**: The wait node handler updates `current_node_id` INSIDE the handler function, not after it returns.

## The Critical Question

**What does `evaluateFlow()` return for a sequential flow like `email-1 -> wait-1 -> email-2`?**

### Scenario 1: Entry Point (current_node_id is NULL)

Flow structure:
- `leadSource-1 -> email-1`
- `email-1 -> wait-1`
- `wait-1 -> email-2`

At entry point:
1. `evaluateFlow()` is called with `current_node_id = NULL`
2. Finds leadSource node
3. Finds edges from leadSource: `[{source: 'leadSource-1', target: 'email-1'}]`
4. Returns: `[email-1 node]` (ONE node)

**Expected**: Should return only `[email-1]`

### Scenario 2: After Email-1 is Processed

Flow structure:
- `email-1 -> wait-1`
- `wait-1 -> email-2`

After email-1 is processed:
1. `current_node_id` is set to email-1 node ID (database UUID)
2. `evaluateFlow()` is called again (in NEXT scheduler run)
3. Loads current node (email-1) from database
4. Finds edges from email-1's `flow_node_id`: `[{source: 'email-1', target: 'wait-1'}]`
5. Returns: `[wait-1 node]` (ONE node)

**Expected**: Should return only `[wait-1]`

## The Bug Hypothesis

**If wait nodes appear before emails are sent, there are two possibilities:**

### Hypothesis 1: evaluateFlow Returns Multiple Nodes (Unlikely)

If `evaluateFlow()` returns BOTH email-1 and wait-1 at the same time:
- Loop processes email-1 first: creates message_job, sets current_node_id to email-1
- Loop processes wait-1 second: sets current_node_id to wait-1 (OVERWRITES email-1)
- Result: current_node_id = wait-1, but email-1's message_job was created

**Problem**: For sequential flows, `evaluateFlow()` should only return ONE node at a time. If it returns multiple nodes, that's a bug.

**Evidence against**: User says second email is NOT on activity, so it's not evaluating too far ahead.

### Hypothesis 2: Flow is Evaluated BEFORE Email Node Updates current_node_id (More Likely)

Timeline of execution:
1. `evaluateFlow()` is called with `current_node_id = NULL` (or previous node)
2. Returns: `[email-1, wait-1]` (if there are parallel edges, or if it's looking ahead)
3. Loop processes email-1: creates message_job, sets current_node_id to email-1
4. Loop processes wait-1: sets current_node_id to wait-1 (OVERWRITES email-1)

**OR**:

1. `evaluateFlow()` is called with `current_node_id = NULL`
2. Returns: `[email-1]` (correct)
3. Loop processes email-1: creates message_job, sets current_node_id to email-1
4. **SAME ITERATION**: Flow is re-evaluated (bug?) or loop continues to next node
5. `evaluateFlow()` is called again with `current_node_id = email-1`
6. Returns: `[wait-1]` (correct)
7. Loop processes wait-1: sets current_node_id to wait-1

**Problem**: The code doesn't show a re-evaluation within the loop. It processes all nodes returned by the initial `evaluateFlow()` call.

### Hypothesis 3: Multiple Scheduler Runs Processing in Wrong Order (Most Likely)

Timeline of execution:
1. **Scheduler Run 1**: 
   - `evaluateFlow()` called with `current_node_id = NULL`
   - Returns: `[email-1]`
   - Processes email-1: creates message_job, sets current_node_id to email-1
   - **Scheduler Run 1 completes**

2. **Scheduler Run 2** (runs very quickly, maybe before message_job is sent):
   - `evaluateFlow()` called with `current_node_id = email-1`
   - Returns: `[wait-1]`
   - Processes wait-1: sets current_node_id to wait-1, sets next_run_at
   - **Scheduler Run 2 completes**

3. **Activity Timeline Query**:
   - Queries enrollment: `current_node_id = wait-1`
   - Queries message_jobs: finds email-1's message_job (status = 'pending' or 'sent')
   - Displays: wait-1 as "current position", email-1 as "scheduled" or "sent"

**This is EXPECTED behavior** - the scheduler correctly processes nodes sequentially, but the activity timeline shows the CURRENT position (wait-1) even though email-1's message_job exists and may not be sent yet.

## The Real Issue: Activity Timeline Display Logic

The activity modal displays:
1. **"Node Progress"** from `enrollment.current_node_id` - shows CURRENT position (wait-1)
2. **"Email Scheduled"** from `message_jobs.created_at` - shows when email was scheduled
3. **"Email Sent"** from `message_jobs.sent_at` - shows when email was sent

**The timeline is sorted by timestamp**, so if:
- Node progress (wait-1) has `enrollment.updated_at` timestamp
- Email scheduled (email-1) has `message_jobs.created_at` timestamp

And if `enrollment.updated_at` (when wait-1 was set) happens BEFORE `message_jobs.created_at` (when email-1 was scheduled), or if the timeline shows them in the wrong order, wait-1 could appear before email-1.

**OR**: The activity modal is showing wait-1's node progress entry, which uses `enrollment.updated_at` as the timestamp. If the scheduler processes wait-1 quickly after email-1 (same second or within milliseconds), the timestamps could be very close, and the wait-1 node progress entry could appear before the email-1 scheduled entry.

## Conclusion

Based on the code analysis:

1. `evaluateFlow()` should return ONE node at a time for sequential flows
2. The scheduler processes ONE node per iteration (returns after processing)
3. The scheduler should NOT process multiple nodes in one iteration

**The issue is likely**:
- The activity timeline is correctly showing the current position (wait-1)
- But it's appearing before the email is sent because:
  - The scheduler processes nodes sequentially very quickly
  - The wait node is processed (current_node_id updated) before the email's message_job is actually sent
  - The timeline shows "current position" (wait-1) even though email-1's message_job exists

**This is actually CORRECT behavior** - the enrollment IS at the wait node (current_node_id = wait-1), and the email's message_job exists (and may be pending or sent). The timeline is showing the true state, but it might be confusing because wait-1 appears before email-1 is sent.

**To verify**: Check if email-1's message_job exists and what its status is. If it exists and is 'sent', then the timeline order might just be a display issue. If it doesn't exist or is 'pending', then there might be a timing issue where the scheduler processes wait-1 before email-1's message_job is created.

