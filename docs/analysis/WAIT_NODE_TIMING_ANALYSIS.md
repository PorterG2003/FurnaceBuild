# Wait Node Timing Analysis

## Problem Statement

Wait nodes are appearing in the activity timeline before emails are sent. This suggests that `enrollment.current_node_id` is being set to a wait node before the corresponding email node has been processed.

## Code Flow Analysis

### 1. Scheduler Worker Process Flow

The scheduler worker processes enrollments in `worker.ts`:

1. **Flow Evaluation** (line 138-143):
   - Calls `evaluateFlow()` which returns an array of next nodes
   - `evaluateFlow()` uses `enrollment.current_node_id` to find the current position
   - Returns ALL nodes connected via edges from the current position

2. **Node Processing Loop** (line 162):
   - Processes nodes in a `for` loop: `for (const node of nextNodes)`
   - Processes nodes **sequentially** in the order returned by `evaluateFlow()`

3. **Email Node Processing** (lines 165-185):
   - Calls `handleEmailNode()` which creates a `message_job`
   - **THEN** updates `enrollment.current_node_id` to the email node
   - Email node handler does NOT update `current_node_id` itself

4. **Wait Node Processing** (lines 190-199):
   - Calls `handleWaitTimeNode()` which:
     - **IMMEDIATELY** updates `enrollment.current_node_id` to the wait node (line 58 in wait-time-handler.ts)
     - Sets `next_run_at` to future time

### 2. Flow Evaluation Logic

In `flow-evaluation.ts`:

- `evaluateFlow()` returns ALL nodes connected via edges from the current position
- It does NOT filter by node type or order
- If multiple nodes are connected (e.g., branching), ALL are returned
- The function returns nodes in database query order (unpredictable)

### 3. The Issue

**Key Observation**: If `evaluateFlow()` returns multiple nodes (e.g., an email node and a wait node), they are processed in a loop. However, the order in which they are processed depends on the order returned by the database query, which may not match the actual flow graph structure.

**Critical Behavior**:
- When processing a wait node, `handleWaitTimeNode()` **immediately** updates `enrollment.current_node_id` to the wait node
- This happens **within the same loop iteration** as other nodes
- If the wait node is processed BEFORE the email node in the loop, `current_node_id` will be set to the wait node before the email node is processed

### 4. When This Could Happen

This issue would occur if:

1. **Flow Graph Structure**: The flow graph has multiple edges from the current position (e.g., branching or parallel paths)
2. **Database Query Order**: The database query returns nodes in an order that puts wait nodes before email nodes
3. **Sequential Processing**: The loop processes nodes in the order returned, not the order they should execute in the flow

**Example Scenario**:
- Flow: `leadSource -> [email-1, wait-1]` (parallel nodes from leadSource)
- `evaluateFlow()` returns: `[wait-1, email-1]` (database order)
- Loop processes: wait-1 first (sets `current_node_id` to wait-1), then email-1 (tries to set `current_node_id` to email-1, but it's already wait-1)
- Result: `current_node_id` is set to wait-1, but email-1's message_job is created

**OR**:

- Flow: `email-1 -> wait-1 -> email-2` (sequential, but evaluateFlow is called incorrectly)
- If the scheduler processes ALL nodes at once instead of waiting for sequential completion

### 5. Activity Modal Display

The activity modal (in `LeadActivityModal.tsx`):

- Queries `enrollments.current_node_id` to show "Node Progress"
- This shows the **current position** in the flow
- If `current_node_id` is set to a wait node before emails are sent, it will display the wait node in the timeline

### 6. Root Cause Analysis

**The fundamental issue**: The scheduler worker processes ALL nodes returned by `evaluateFlow()` in a single iteration, but the flow graph structure suggests nodes should be processed **sequentially** (email-1 -> wait-1 -> email-2).

**Possible root causes**:

1. **Flow Evaluation Bug**: `evaluateFlow()` is returning nodes that shouldn't be processed yet (e.g., it's looking ahead too far in the flow)

2. **Node Processing Logic Bug**: The scheduler should only process the **first** node from `evaluateFlow()`, not all of them. After processing one node, it should stop and let the next scheduler run process the next node.

3. **Wait Node Handler Bug**: Wait nodes should NOT update `current_node_id` immediately - they should update it after the wait duration completes, OR they should not be processed until the previous node completes.

4. **Flow Graph Structure**: The flow graph itself might have an incorrect structure (e.g., parallel edges where sequential is expected)

### 7. Expected vs Actual Behavior

**Expected Behavior**:
- Process email-1: Create message_job, set `current_node_id` to email-1
- Wait for next scheduler run (or wait for email to be sent)
- Process wait-1: Set `current_node_id` to wait-1, set `next_run_at` to future time
- Wait for `next_run_at` to pass
- Process email-2: Create message_job, set `current_node_id` to email-2

**Actual Behavior** (if bug exists):
- Process email-1: Create message_job, set `current_node_id` to email-1
- **SAME ITERATION**: Process wait-1: Set `current_node_id` to wait-1 (OVERWRITES email-1)
- Result: `current_node_id` is wait-1, but email-1's message_job was created
- Activity timeline shows wait-1, but email-1's message_job might not be sent yet

### 8. Questions to Investigate

1. **Flow Graph Structure**: What is the actual structure of the test campaign flow? Are email and wait nodes connected sequentially or in parallel?

2. **evaluateFlow() Behavior**: Does `evaluateFlow()` return nodes that are directly connected, or does it look ahead multiple steps?

3. **Node Processing Order**: What order are nodes returned by `evaluateFlow()`? Is it deterministic or based on database query order?

4. **Enrollment Update Timing**: When exactly is `current_node_id` updated for each node type? Does the update happen immediately or after processing completes?

5. **Loop Processing**: Should the scheduler process ALL nodes from `evaluateFlow()` in one iteration, or only ONE node per iteration?

## Conclusion

The issue suggests that the scheduler worker is processing multiple nodes in a single iteration, causing `enrollment.current_node_id` to be updated to a wait node before the corresponding email node's message_job is fully processed. This could be due to:

1. Flow evaluation returning nodes in an incorrect order
2. The scheduler processing multiple nodes when it should process one at a time
3. Wait nodes updating `current_node_id` immediately instead of after the wait duration
4. Flow graph structure issues (parallel vs sequential nodes)

Further investigation is needed to determine the exact root cause by:
- Examining the actual flow graph structure of the test campaign
- Checking the order of nodes returned by `evaluateFlow()`
- Verifying the intended behavior: should one node or multiple nodes be processed per scheduler iteration?

