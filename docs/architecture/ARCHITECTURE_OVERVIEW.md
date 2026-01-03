# Architecture Overview: Enrollments vs Message Jobs vs Lead States

## High-Level Flow

```
1. Lead enters campaign → creates ENROLLMENT
2. Scheduler runs → evaluates flow → creates MESSAGE_JOBS
3. Send worker → executes MESSAGE_JOBS → sends emails
4. Events happen → update ENROLLMENT state
```

---

## Core Concepts

### 📋 **Enrollments** (New - Phase 1.1)
**Purpose**: Track where a lead is in the flow at a high level

**What it is**:
- **One record per lead per campaign**
- Represents a lead's enrollment/journey through a campaign flow
- Tracks the "current position" in the flow graph

**Key Fields**:
- `lead_id`, `campaign_id`
- `current_node_id` - Which node the lead is currently at
- `state` - 'active', 'paused', 'stopped', 'completed'
- `next_run_at` - When the scheduler should evaluate this enrollment next
- `flow_position` - JSONB snapshot of where they are in the graph

**Used By**:
- **Scheduler Lambda**: Queries for enrollments where `next_run_at <= NOW()` to decide what to do next
- **Event Processor**: Updates enrollment state when replies/bounces occur
- **Flow Evaluation**: Determines next node(s) to execute

**Example**:
```
enrollment {
  lead_id: "lead-123",
  campaign_id: "campaign-456",
  current_node_id: "wait-time-node-2",
  state: "active",
  next_run_at: "2024-01-15 14:30:00"
}
```
→ "Lead 123 is in campaign 456, currently waiting at a wait-time node, should be evaluated at 2:30pm"

---

### 📨 **Message Jobs** (New - Phase 1.2)
**Purpose**: Concrete "send this email" actions created by the scheduler

**What it is**:
- **One record per email send action**
- Created by the scheduler when it evaluates an enrollment and finds an email node
- Represents a specific email that needs to be sent
- Queued for execution by send workers

**Key Fields**:
- `enrollment_id` - Which enrollment this job belongs to
- `lead_id`, `campaign_id`, `mailbox_id`
- `node_id` - The email node that should be executed
- `status` - 'pending', 'reserved', 'sending', 'sent', 'failed'
- `scheduled_at` - When the email should be sent (respects pacing/jitter)
- `message_data` - JSONB with subject, body, template variables
- `provider_message_id` - SMTP Message-ID (for reply detection)

**Used By**:
- **Scheduler Lambda**: Creates these when it finds email nodes
- **Send Workers**: Pull from queue, execute the send, update status
- **Inbox Workers**: Match replies using `provider_message_id`

**Example**:
```
message_job {
  enrollment_id: "enrollment-789",
  lead_id: "lead-123",
  mailbox_id: "mailbox-456",
  node_id: "email-node-1",
  status: "pending",
  scheduled_at: "2024-01-15 14:35:00",
  message_data: {
    subject: "Welcome to our service",
    body: "Hi {{name}}, welcome!",
    template_vars: { name: "John Doe" }
  }
}
```
→ "Send a welcome email to lead 123 at 2:35pm using mailbox 456, with this subject and body"

---

### 📊 **Lead States** (Current System)
**Purpose**: Track state at every node for every lead (granular node-level tracking)

**What it is**:
- **One record per node per lead** (many records per lead)
- Pre-creates state records for all nodes in the flow when a lead is added
- Tracks detailed status for each individual node ('schrodinger', 'queued', 'processing', 'processed', etc.)
- Handles branching by creating child states for each branch path

**Key Fields**:
- `lead_id`, `campaign_id`
- `node_id`, `node_type`
- `status` - 'schrodinger', 'queued', 'processing', 'processed', 'failed', 'success', 'trimmed'
- `parent_state_id` - For branching nodes
- `execution_data` - Node-specific results
- Multiple timestamps (entered_at, queued_at, processing_at, completed_at)

**Used By**:
- Current system for tracking flow progression
- Handles complex branching scenarios
- Provides detailed audit trail of every node execution

**Example**:
```
lead_states (multiple records):
  { lead_id: "lead-123", node_id: "email-1", status: "processed", completed_at: "..." }
  { lead_id: "lead-123", node_id: "wait-2", status: "processing", processing_at: "..." }
  { lead_id: "lead-123", node_id: "email-3", status: "schrodinger" }
  { lead_id: "lead-123", node_id: "branch-a", status: "schrodinger", parent_state_id: "..." }
  { lead_id: "lead-123", node_id: "branch-b", status: "schrodinger", parent_state_id: "..." }
```
→ "Lead 123 has processed email-1, is processing wait-2, and hasn't reached email-3 or branches yet"

---

## Key Differences

### Enrollments vs Lead States

| Aspect | **Enrollments** (New) | **Lead States** (Current) |
|--------|----------------------|---------------------------|
| **Granularity** | One per lead | One per node per lead |
| **Purpose** | High-level position in flow | Detailed node-level tracking |
| **Complexity** | Simpler, focuses on "where am I now?" | More complex, tracks all nodes |
| **Branching** | Stores current position (can be at one node) | Pre-creates states for all branches |
| **Query Pattern** | "What should I do next?" (next_run_at) | "What's the status of node X?" |
| **Scheduler Use** | Direct: Find enrollments ready to process | Indirect: Must query for queued states |

### Message Jobs vs Lead States

| Aspect | **Message Jobs** (New) | **Lead States** (Current) |
|--------|----------------------|---------------------------|
| **Scope** | Only for email sends | All node types |
| **Lifecycle** | Created → Queued → Sent → Done | Pre-created → Status changes → Completed |
| **Purpose** | Concrete execution unit | State tracking |
| **Contains** | Message content, mailbox, send time | Node status, execution data |
| **Queue Integration** | Direct: Pushed to SQS send_queue | Indirect: Workers query for queued states |

---

## How They Work Together

### Current System (Lead States)
```
1. Lead added → Create lead_states for ALL nodes in flow
2. Worker queries: "Find lead_states where status='queued'"
3. Worker processes node → Updates lead_state status
4. Worker finds next node → Updates next lead_state to 'queued'
```

**Issues**:
- Pre-creates many records (wasteful for branches)
- Complex queries to find "what to do next"
- No clear separation between "what to do" and "how to do it"

---

### New System (Enrollments + Message Jobs)
```
1. Lead added → Create ONE enrollment (state='active', at first node)
2. Scheduler runs → Queries: "Find enrollments where next_run_at <= NOW()"
3. Scheduler evaluates flow → 
   - If email node: Creates MESSAGE_JOB, pushes to SQS
   - If wait node: Updates enrollment.next_run_at
   - If branch: Updates enrollment.current_node_id
4. Send worker → Pulls MESSAGE_JOB from queue → Sends email → Updates job status
5. Event processor → On reply/bounce → Updates enrollment.state = 'stopped'
```

**Benefits**:
- One enrollment per lead (simpler)
- Clear separation: enrollment = position, message_job = action
- Scheduler creates jobs, workers execute jobs (decoupled)
- Better for scheduling (next_run_at is indexed and queriable)

---

## Migration Path

**Note**: Since the app is not in production use, we can simply delete `lead_states` rather than migrating.

### Phase 1: Schema Cleanup & Creation
- Delete `lead_states` table
- Delete or update `scheduled_jobs` table (remove `lead_state_id` FK if keeping)
- Create `enrollments` table
- Create `message_jobs` table

---

## Summary

- **Enrollments**: "Where is this lead in the flow?" (one per lead)
- **Message Jobs**: "Send this specific email" (created by scheduler, executed by workers)
- **Lead States**: "What's the status of every node?" (current system, many per lead)

The new system separates concerns:
- **Enrollments** = Flow position tracking (simpler)
- **Message Jobs** = Email execution (concrete, queueable)
- **Lead States** = Detailed audit trail (can coexist or be migrated)

This makes the scheduler's job simpler (query enrollments by next_run_at) and the worker's job clearer (execute message jobs from queue).

