# Dedicated Email Node Worker Analysis

## Current Architecture

```
Scheduler Worker
├─► Handles ALL node types:
│   ├─► Email nodes (complex: mailbox assignment, slot calculation, job creation)
│   ├─► Wait nodes (simple: update next_run_at)
│   ├─► AICategorizer nodes (branching logic)
│   └─► DataSender nodes (placeholder)
└─► Flow evaluation and traversal
```

## Proposed Architecture

```
Scheduler Worker (Simplified)
├─► Handles NON-EMAIL node types:
│   ├─► Wait nodes (update next_run_at)
│   ├─► AICategorizer nodes (branching logic)
│   └─► DataSender nodes
└─► Flow evaluation and traversal
└─► For email nodes: Creates "email_scheduling_jobs" instead of message_jobs

Email Node Worker (New)
├─► Polls for email_scheduling_jobs
├─► Handles mailbox assignment
├─► Calculates slot-based scheduling
├─► Creates message_jobs atomically
└─► Updates enrollment state
```

## Benefits of Dedicated Email Worker

### 1. Separation of Concerns
- **Scheduler Worker**: Fast, simple - just flow traversal and non-email nodes
- **Email Worker**: Complex - handles all email-specific logic (mailbox, slots, scheduling)

### 2. Simplified Slot-Based Scheduling
- **Single worker** handling all email scheduling = no race conditions
- Can process email scheduling jobs sequentially
- Simpler slot calculation (no need for complex atomic checking)
- Can batch process email nodes for better slot distribution

### 3. Better Slot Management
- Email worker can see all pending email scheduling jobs
- Can optimize slot assignment across enrollments
- Can ensure proper distribution across mailboxes
- Can handle slot conflicts more intelligently

### 4. Cleaner Architecture
- Scheduler worker becomes simpler (just flow logic)
- Email worker owns all email scheduling complexity
- Easier to test and maintain each component

## Implementation Approach

### Option 1: Direct Enrollment Processing (No Extra Table)

**Flow**:
1. Scheduler worker finds email node → Updates `enrollment.current_node_id` to email node
2. Email worker polls enrollments where:
   - `current_node_id IS NOT NULL`
   - AND node (from nodes table) has `node_type = 'email'`
   - AND `state = 'active'`
   - AND no message_job exists yet for this enrollment + node
3. Email worker processes:
   - Assigns mailbox (if needed)
   - Calculates slot
   - Creates `message_job`
   - Updates enrollment (advances to next node or marks as waiting)

**Query Example**:
```sql
SELECT e.*, n.node_type
FROM enrollments e
JOIN nodes n ON e.current_node_id = n.id
WHERE e.state = 'active'
  AND n.node_type = 'email'
  AND NOT EXISTS (
    SELECT 1 FROM message_jobs mj
    WHERE mj.enrollment_id = e.id
      AND mj.node_id = e.current_node_id
  )
ORDER BY e.updated_at ASC
LIMIT 100;
```

**Pros**:
- ✅ No extra table needed
- ✅ No extra columns needed
- ✅ Uses existing enrollment structure
- ✅ Simple and clean

**Cons**:
- ⚠️ Need to join with nodes table (but that's fine)
- ⚠️ Need to check for existing message_job (but that's fine)

### Option 2: Queue-Based (SQS)

**Flow**:
1. Scheduler worker finds email node → Pushes enrollment_id to `email_scheduling_queue`
2. Email worker pulls from queue
3. Email worker processes and creates `message_job`

**Pros**:
- ✅ Decoupled
- ✅ Automatic retries
- ✅ Scales independently

**Cons**:
- ⚠️ Adds SQS dependency
- ⚠️ More infrastructure

## Recommended: Option 1 (Direct Enrollment Processing)

### Why?
1. **No extra infrastructure** - Uses existing enrollments table
2. **Simple query** - Just join with nodes table to find email nodes
3. **Batch processing** - Email worker can process multiple enrollments efficiently
4. **No race conditions** - Single worker processes sequentially
5. **Natural retry** - If email worker fails, enrollment stays on email node and gets picked up again

### Simplified Slot Logic

With a dedicated email worker, slot calculation becomes simpler:

```typescript
// Email worker processes enrollments sequentially
const enrollmentsOnEmailNodes = await supabase
  .from('enrollments')
  .select(`
    *,
    node:nodes!current_node_id(node_type)
  `)
  .eq('state', 'active')
  .eq('node.node_type', 'email')
  .not('current_node_id', 'is', null);

for (const enrollment of enrollmentsOnEmailNodes) {
  // Check if message_job already exists (handles retries)
  const existingJob = await checkMessageJobExists(enrollment.id, enrollment.current_node_id);
  if (existingJob) {
    continue; // Already processed
  }
  
  // 1. Load node and campaign
  const node = await loadNode(enrollment.current_node_id);
  const campaign = await loadCampaign(enrollment.campaign_id);
  
  // 2. Assign mailbox (if needed)
  const mailbox = await assignMailbox(enrollment.lead_id, enrollment.campaign_id);
  
  // 3. Calculate slot (simple - no race conditions since sequential)
  const slot = calculateSlot(
    enrollment.campaign_id,
    mailbox.id,
    NOW()
  );
  
  // 4. Check if slot is available (simple query, no atomic checking needed)
  const slotTaken = await checkSlotAvailable(mailbox.id, slot);
  
  if (!slotTaken) {
    // 5. Create message_job
    await createMessageJob({
      enrollment_id: enrollment.id,
      mailbox_id: mailbox.id,
      scheduled_at: slot,
      ...
    });
    
    // 6. Enrollment stays on email node until email is sent
    // (Scheduler will check if email is sent before advancing)
  } else {
    // Slot taken - calculate next slot or wait
    // (Simpler logic since we're processing sequentially)
  }
}
```

**Key Simplification**: No need for complex atomic slot checking because:
- Email worker processes jobs sequentially
- Can see all pending scheduling jobs
- Can optimize slot assignment

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    Scheduler Worker                          │
│  (Simplified - Flow Traversal Only)                         │
│                                                              │
│  ┌────────────────────────────────────────────────────┐   │
│  │ 1. Poll enrollments (next_run_at <= NOW())         │   │
│  │ 2. Evaluate flow (find next nodes)                 │   │
│  │ 3. For each node:                                  │   │
│  │    ├─► Email node → Update current_node_id         │   │
│  │    │   (Does NOT create message_job)               │   │
│  │    ├─► Wait node → Update next_run_at              │   │
│  │    └─► Branch node → Update current_node_id       │   │
│  └────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                        │
                        │ Updates
                        ▼
┌─────────────────────────────────────────────────────────────┐
│              enrollments table                               │
│  (current_node_id = email node, state='active')             │
└─────────────────────────────────────────────────────────────┘
                        │
                        │ Polls (joins with nodes)
                        ▼
┌─────────────────────────────────────────────────────────────┐
│                  Email Node Worker                          │
│  (Dedicated - Email Scheduling Only)                        │
│                                                              │
│  ┌────────────────────────────────────────────────────┐   │
│  │ 1. Poll enrollments where:                         │   │
│  │    - current_node_id points to email node          │   │
│  │    - state = 'active'                              │   │
│  │    - no message_job exists yet                     │   │
│  │ 2. For each enrollment:                            │   │
│  │    ├─► Assign mailbox (if needed)                  │   │
│  │    ├─► Calculate slot                              │   │
│  │    ├─► Check slot availability                     │   │
│  │    └─► Create message_job                          │   │
│  │ 3. Enrollment stays on email node                 │   │
│  │    (Scheduler checks if email sent before advance) │   │
│  └────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                        │
                        │ Creates
                        ▼
┌─────────────────────────────────────────────────────────────┐
│                  message_jobs table                         │
│  (status='pending', scheduled_at, mailbox_id, ...)          │
└─────────────────────────────────────────────────────────────┘
                        │
                        │ Polls
                        ▼
┌─────────────────────────────────────────────────────────────┐
│                    Send Worker                               │
│  (Sends Emails)                                              │
└─────────────────────────────────────────────────────────────┘
```

## Slot Calculation Simplification

### Current (Complex)
```typescript
// In scheduler worker - race conditions possible
const baseTime = await calculateNextMailboxSendTime(...);
const scheduledAt = calculateScheduledAt(baseTime, schedule, jitter);
await supabase.rpc('create_message_job_if_slot_available', {
  p_scheduled_at: scheduledAt, // Jittered time
  ...
}); // Complex atomic slot checking
```

### With Email Worker (Simpler)
```typescript
// In email worker - sequential processing, no race conditions
const slot = calculateSlot(campaignId, mailboxId, NOW());
// Simple query - no atomic checking needed (sequential processing)
const existing = await checkSlot(mailboxId, slot);
if (!existing) {
  const scheduledAt = applyJitterToSlot(slot, jitterPercentage);
  await createMessageJob({ scheduled_at: scheduledAt, ... });
}
```

## Benefits Summary

1. **Simpler Scheduler Worker**
   - Just handles flow traversal
   - No email-specific complexity
   - Faster execution

2. **Simpler Slot Logic**
   - Sequential processing = no race conditions
   - No need for complex atomic checking
   - Can optimize slot assignment

3. **Better Separation**
   - Email scheduling isolated
   - Easier to test and maintain
   - Clear responsibilities

4. **Scalability**
   - Email worker can scale independently
   - Can batch process email scheduling jobs
   - Better resource utilization

## Migration Path

1. **Update scheduler worker** to NOT create message_jobs for email nodes
   - Just update `enrollment.current_node_id` to email node
   - Remove `handleEmailNode` call
2. **Create email worker** to poll enrollments on email nodes
   - Query enrollments where current_node_id points to email node
   - Process mailbox assignment, slot calculation, message_job creation
3. **Simplify slot calculation** (no atomic checking needed - sequential processing)
4. **Test and deploy**

**No schema changes needed!** Uses existing enrollments and nodes tables.

## Trade-offs

**Pros**:
- ✅ Much simpler slot logic
- ✅ No race conditions
- ✅ Better separation of concerns
- ✅ Easier to maintain

**Cons**:
- ⚠️ Extra worker to manage
- ⚠️ Slight delay (scheduler → email worker → message_job)
- ⚠️ Need to join enrollments with nodes table (but that's fine)

**Verdict**: The benefits outweigh the costs, especially for slot-based scheduling complexity.

