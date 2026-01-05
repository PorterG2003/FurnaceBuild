# Current Node Update Locations

## Where `evaluateFlow()` Happens

**File**: `workers/scheduler-worker/src/worker.ts`
**Function**: `processEnrollment()` (line 96)
**Location**: Lines 136-143

```typescript
// 3. Evaluate flow - find next node(s) (loads from database)
console.log(`[ENROLLMENT ${enrollmentId}] Evaluating flow. Current node: ${enrollment.current_node_id?.substring(0, 8) || 'null (entry point)'}`);
const nextNodes = await evaluateFlow(
  enrollment,
  enrollment.campaign_id,
  campaign.flow_data,
  this.supabase
);
```

**Context**: 
- Called once per `processEnrollment()` invocation
- Called after loading campaign and determining jitter percentage
- Called before processing any nodes
- Uses the `enrollment` object passed in (which has `current_node_id` from database)

## Where `current_node_id` is Updated

### 1. Email Node Processing

**File**: `workers/scheduler-worker/src/worker.ts`
**Function**: `processEnrollment()` -> email node handler
**Location**: Lines 179-183

```typescript
if (node.node_type === 'email') {
  // ... handleEmailNode() creates message_job ...
  
  // Update enrollment.current_node_id
  await this.supabase
    .from('enrollments')
    .update({ current_node_id: node.id })
    .eq('id', enrollment.id);
}
```

**When**: After `handleEmailNode()` successfully creates a `message_job`
**Where**: In the worker's node processing loop, after email node handler returns

### 2. Wait Node Processing

**File**: `workers/scheduler-worker/src/node-handlers/wait-time-handler.ts`
**Function**: `handleWaitTimeNode()`
**Location**: Lines 54-61

```typescript
// 4. Update enrollment
const { error } = await supabase
  .from('enrollments')
  .update({
    current_node_id: node.id,
    next_run_at: nextRunAt,
  })
  .eq('id', enrollment.id);
```

**When**: Inside `handleWaitTimeNode()` handler function
**Where**: Inside the wait node handler, updates both `current_node_id` and `next_run_at` atomically

### 3. DataSender Node Processing

**File**: `workers/scheduler-worker/src/node-handlers/data-sender-handler.ts`
**Function**: `handleDataSenderNode()`
**Location**: Lines 41-47

```typescript
const { error } = await supabase
  .from('enrollments')
  .update({
    current_node_id: node.id,
    next_run_at: nextRunAt,
  })
  .eq('id', enrollment.id);
```

**When**: Inside `handleDataSenderNode()` handler function
**Where**: Inside the data sender node handler

### 4. AICategorizer Node Processing

**File**: `workers/scheduler-worker/src/worker.ts`
**Function**: `processEnrollment()` -> AICategorizer node handler
**Location**: Lines 223-244

```typescript
else if (node.node_type === 'aiCategorizer') {
  // ... handleAICategorizerNode() returns selectedFlowNodeId ...
  
  if (selectedFlowNodeId) {
    // ... load selectedNode ...
    
    if (selectedNodeError || !selectedNode) {
      // Update enrollment to AICategorizer node and set next_run_at for retry
      await this.supabase
        .from('enrollments')
        .update({
          current_node_id: node.id,
          next_run_at: new Date(Date.now() + 60000).toISOString(),
        })
        .eq('id', enrollment.id);
    } else {
      // Update enrollment to AICategorizer node, then process the selected node
      await this.supabase
        .from('enrollments')
        .update({ current_node_id: node.id })
        .eq('id', enrollment.id);
      
      // Set next_run_at to process the selected node immediately
      await this.supabase
        .from('enrollments')
        .update({
          current_node_id: selectedNode.id,
          next_run_at: new Date().toISOString(),
        })
        .eq('id', enrollment.id);
    }
  } else {
    // No category selected, update enrollment and set next_run_at for retry
    await this.supabase
      .from('enrollments')
      .update({
        current_node_id: node.id,
        next_run_at: new Date(Date.now() + 60000).toISOString(),
      })
      .eq('id', enrollment.id);
  }
}
```

**When**: After `handleAICategorizerNode()` returns selected category
**Where**: In the worker's node processing loop, handles different scenarios

### 5. Unknown Node Types

**File**: `workers/scheduler-worker/src/worker.ts`
**Function**: `processEnrollment()` -> default case
**Location**: Lines 272-279

```typescript
else {
  // Handle other node types (unknown types)
  console.warn(`[ENROLLMENT ${enrollmentId}] Unknown node type '${node.node_type}'. Updating current_node_id and continuing.`);
  await this.supabase
    .from('enrollments')
    .update({
      current_node_id: node.id,
      next_run_at: new Date().toISOString(),
    })
    .eq('id', enrollment.id);
}
```

**When**: For unknown node types (fallback)
**Where**: In the worker's node processing loop, default case

## Summary

### `evaluateFlow()` Location
- **Called once** per `processEnrollment()` invocation
- **Location**: `worker.ts` line 138
- **Context**: After loading campaign, before processing nodes
- **Purpose**: Determines what nodes should be processed next

### `current_node_id` Updates

| Node Type | Update Location | When | Handler Function |
|-----------|----------------|------|------------------|
| **email** | `worker.ts` line 181 | After `handleEmailNode()` returns | In worker loop |
| **waitTime/wait** | `wait-time-handler.ts` line 58 | Inside `handleWaitTimeNode()` | Inside handler |
| **dataSender** | `data-sender-handler.ts` line 42 | Inside `handleDataSenderNode()` | Inside handler |
| **aiCategorizer** | `worker.ts` lines 223-254 | After `handleAICategorizerNode()` returns | In worker loop |
| **unknown** | `worker.ts` line 275 | Default case | In worker loop |

### Key Observation

**Email nodes** update `current_node_id` **in the worker** (after handler returns), while **wait nodes** update it **inside the handler**. This is an inconsistency that could be relevant to the fix, but it's not the root cause of the issue.

**For the fix**: We need to add a check in `evaluateFlow()` (line 138 in `worker.ts`) to verify that if the current node is an email node, all message_jobs have been sent before returning the next nodes.

