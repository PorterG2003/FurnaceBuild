# Queue & Scheduler System Overview

## High-Level Concept

Think of it like a restaurant:
- **Scheduler** = The host who decides when tables are ready
- **Queue** = The waiting list/order board
- **Workers** = The kitchen staff who cook the orders

The scheduler creates jobs and puts them in the queue. Workers pull jobs from the queue and execute them.

---

## The Two-Stage System

### Stage 1: Scheduler (Decision Maker)
**"What should happen next?"**

### Stage 2: Workers (Executors)
**"Do the work"**

These are **separated** for scalability and reliability.

---

## Part 1: Scheduler

### What is it?
A **Lambda function** that runs **every 30-60 seconds** (triggered by CloudWatch Events).

### What does it do?
1. **Queries database**: "Find all enrollments where `next_run_at <= NOW()` and `state = 'active'`"
2. **For each enrollment**:
   - Loads the flow graph (from `campaigns.flow_data` or `nodes` table)
   - Figures out: "What node should execute next?"
   - **If it's an email node**:
     - Creates a `message_job` record in the database
     - Pushes `{message_job_id}` to the **send_queue** (SQS)
   - **If it's a wait node**:
     - Updates `enrollment.next_run_at` = NOW() + wait_duration
     - (No job created yet - will be evaluated next scheduler run)
   - **If it's a branch/conditional node**:
     - Evaluates the condition
     - Updates `enrollment.current_node_id` to the next node
3. **Done** - runs again in 30-60 seconds

### Key Points:
- ✅ **Fast**: Just makes decisions, doesn't send emails
- ✅ **Stateless**: Doesn't hold connections or state
- ✅ **Scales**: Single instance handles thousands of enrollments
- ✅ **Deterministic**: Always runs, even if workers are busy

### Example:
```
Scheduler runs at 2:00:00 PM
  → Finds 50 enrollments ready
  → 30 have email nodes next → Creates 30 message_jobs → Pushes 30 messages to send_queue
  → 20 have wait nodes next → Updates their next_run_at to 2:05:00 PM
  → Done in 5 seconds
  → Runs again at 2:01:00 PM
```

---

## Part 2: Queues (SQS)

### What is it?
**Amazon SQS** - A message queue service. Think of it as a **buffer** between scheduler and workers.

### Why do we need it?

#### Without Queue (Bad):
```
Scheduler → Directly calls Workers
Problems:
- Scheduler has to wait for workers (slow)
- If workers are busy, scheduler blocks
- Can't scale workers independently
- Scheduler has to manage retries
```

#### With Queue (Good):
```
Scheduler → Queue → Workers
Benefits:
- Scheduler is fast (just pushes messages)
- Queue buffers spikes (can hold thousands of messages)
- Workers can scale independently (add more workers when queue is long)
- Retries handled automatically by queue
- Decoupled: scheduler and workers don't know about each other
```

### Types of Queues:

#### 1. **send_queue** (Most Important)
- **Purpose**: Holds email send jobs
- **Message**: `{message_job_id: "uuid-123"}`
- **Consumed by**: Send workers (ECS Fargate tasks)
- **Lifecycle**:
  1. Scheduler pushes message
  2. Worker pulls message (message becomes invisible for 5 minutes)
  3. Worker processes job
  4. Worker deletes message (if success) or message becomes visible again (if failure)
  5. After max retries, message goes to Dead Letter Queue (DLQ)

#### 2. **event_queue** (Skipped - see QUEUE_DECISION_ANALYSIS.md)
- **Purpose**: Holds events that need processing (replied, bounced, unsubscribed, opened, clicked)
- **Message**: `{event_type: "replied", message_job_id: "uuid-123", enrollment_id: "uuid-456", ...}`
- **Consumed by**: Event processor (Lambda or ECS worker)
- **When it's used**:
  - Send worker sends email → emits `{event_type: "sent", ...}` to event_queue
  - Inbox worker detects reply → emits `{event_type: "replied", ...}` to event_queue
  - Tracking endpoint records open → emits `{event_type: "opened", ...}` to event_queue
- **Why queue?**: 
  - Decouples detection from processing
  - Allows event processing to be async (don't slow down send workers)
  - Can batch process events for efficiency
- **Alternative**: Can process events synchronously (no queue) if simplicity preferred

#### 3. **inbox_queue** (Skipped - see QUEUE_DECISION_ANALYSIS.md)
- **Decision**: Not using `inbox_queue`
- **Reason**: Inbox checking uses scheduled tasks instead (simpler, adequate for our scale)
- **Implementation**: CloudWatch Event → Lambda/ECS Scheduled Task (every 5 minutes) that queries all mailboxes and checks each one
- **Add later if**: Have 100+ mailboxes or need prioritization/distribution

### Queue Characteristics:

**Visibility Timeout**: 5 minutes
- When a worker pulls a message, it becomes invisible to other workers
- Worker has 5 minutes to process and delete it
- If worker crashes, message becomes visible again after timeout

**Dead Letter Queue (DLQ)**:
- Messages that fail after max retries go here
- For manual inspection/debugging
- Prevents poison messages from clogging the queue

---

## Part 3: Workers

### Send Workers (ECS Fargate)

**What are they?**
- Long-running containerized processes
- Run continuously, polling the `send_queue`

**What do they do?**
1. **Poll queue**: "Any messages available?" (long polling - waits up to 20 seconds)
2. **For each message**:
   - Extract `message_job_id`
   - Load `message_job` from database
   - Load related data (lead, campaign, mailbox, template)
   - **Reserve job** (atomic database operation):
     - Check throttles (mailbox, domain, tenant limits)
     - Update `message_job.status = 'reserved'`
   - **Generate email**: Merge template with lead data
   - **Send via SMTP**: Connect to mailbox, send email
   - **Update database**: `message_job.status = 'sent'`, store Message-ID
   - **Emit event**: Push to `event_queue` (optional)
   - **Delete message** from queue
3. **Repeat**: Goes back to step 1

**Scaling**:
- Auto-scales based on queue depth
- More messages in queue → more workers spawn
- Fewer messages → workers terminate
- Each worker processes messages concurrently (multiple at once)

**Example**:
```
send_queue has 100 messages
  → 5 workers are running
  → Each worker processes 2-3 messages at once
  → Queue depth decreases
  → Auto-scaler adds 3 more workers (total: 8)
  → Queue empties
  → Auto-scaler removes workers (back to 2-3)
```

---

## The Other Queues Explained

### event_queue: Async Event Processing

**The Problem**: When things happen (email sent, reply received, bounce detected), you need to:
- Update enrollment state (e.g., reply → stop enrollment)
- Trigger flow branches (e.g., conditionals)
- Update analytics/campaign stats
- Handle state transitions

**With event_queue**:
```
Send Worker sends email
  → Emits event: {event_type: "sent", message_job_id: "123"}
  → Pushes to event_queue
  → (Worker continues, doesn't wait)

Event Processor (separate worker/Lambda)
  → Pulls events from event_queue
  → Processes: updates stats, triggers branches, etc.
```

**Benefits**:
- Send workers stay fast (don't do heavy processing)
- Events processed asynchronously
- Can batch process events for efficiency

**Without event_queue** (alternative):
- Send worker does everything synchronously (slower)
- Simpler, but less scalable

---

### inbox_queue: Distributed Inbox Checking

**The Problem**: Need to periodically check mailboxes for replies/bounces. Options:

**Option A: Use inbox_queue** (more flexible):
```
CloudWatch Schedule (every 5 minutes)
  → Pushes mailbox sync jobs: {mailbox_id: "123"}, {mailbox_id: "456"}
  → Pushes to inbox_queue

Inbox Workers
  → Pull jobs from inbox_queue
  → Check each mailbox for new messages
  → Process replies/bounces
```

**Option B: No queue** (simpler):
```
Inbox Workers (scheduled via ECS/cron)
  → Every 5 minutes, check ALL mailboxes
  → Process replies/bounces
```

**When to use inbox_queue**:
- Many mailboxes (need to distribute work)
- Want to prioritize certain mailboxes
- Want to scale inbox checking independently

**When to skip inbox_queue**:
- Small number of mailboxes
- Simple round-robin checking is fine
- Prefer simpler architecture

---

## Simplified Architecture (Minimal Queues)

**Current Decision**: Start simple with just **send_queue** (see QUEUE_DECISION_ANALYSIS.md):

```
send_queue: ✅ Required (core of the system)

event_queue: ❌ Skipped
  → Events processed synchronously (simpler, adequate for our scale)
  → Add later if: > 10k emails/sec

inbox_queue: ❌ Skipped  
  → Inbox checking uses scheduled tasks (simpler, adequate for our scale)
  → Add later if: 100+ mailboxes or need prioritization
```

---

## Complete Flow Example

### Scenario: Lead enters campaign

```
1. Lead added to campaign
   → Enrollment created: {lead_id: "123", state: "active", current_node_id: "email-1", next_run_at: NOW()}

2. Scheduler runs (2:00:00 PM)
   → Queries: "enrollments where next_run_at <= NOW() and state='active'"
   → Finds enrollment #123
   → Loads flow graph
   → Sees current_node_id = "email-1" (email node)
   → Creates message_job: {
       enrollment_id: "enroll-123",
       lead_id: "123",
       node_id: "email-1",
       status: "pending",
       scheduled_at: NOW()
     }
   → Pushes to send_queue: {message_job_id: "job-456"}

3. Send worker (running continuously)
   → Polls send_queue
   → Receives message: {message_job_id: "job-456"}
   → Loads message_job from database
   → Reserves job (checks throttles, updates status to 'reserved')
   → Generates email content
   → Sends via SMTP
   → Updates message_job.status = 'sent'
   → Writes to events table: {event_type: "sent", message_job_id: "job-456", ...}
   → Optionally updates campaign stats (increment sent_count)
   → Deletes message from send_queue

5. Scheduler runs again (2:00:30 PM)
   → Enrollment #123's next node is "wait-time-2" (5 minute wait)
   → Updates enrollment.next_run_at = 2:05:30 PM
   → (No message_job created - just updates the enrollment)

6. Scheduler runs at 2:05:30 PM
   → Finds enrollment #123 ready again
   → Next node is "email-3"
   → Creates message_job
   → Pushes to send_queue
   → (Cycle continues)

7. [Later] Recipient replies to email
   → Inbox checker runs (scheduled task, every 5 minutes)
   → Checks mailbox for new messages since last_synced_at
   → Detects reply (In-Reply-To header matches message_job.provider_message_id)
   → Updates enrollment.state = 'stopped' (synchronous, immediate)
   → Writes to events table: {event_type: "replied", message_job_id: "job-456", enrollment_id: "enroll-123", ...}
   → Updates mailboxes.last_synced_at
```

---

## Why This Architecture?

### ✅ Separation of Concerns
- **Scheduler**: Fast, stateless, makes decisions
- **Workers**: Heavy, stateful (connections), execute work

### ✅ Scalability
- Scheduler: Single instance (cheap, always runs)
- Workers: Scale based on load (expensive, only when needed)

### ✅ Reliability
- Queue buffers spikes (can't overwhelm workers)
- If workers crash, messages stay in queue
- Retries handled automatically

### ✅ Performance
- Scheduler is fast (no blocking)
- Workers can process in parallel
- Queue enables async processing

---

## Key Metrics to Monitor

### Scheduler:
- **Execution time**: Should be < 1 minute
- **Enrollments processed per run**: Track throughput
- **Message jobs created**: Should match email nodes found

### Queue:
- **Queue depth**: Number of messages waiting
- **Messages processed/second**: Throughput
- **Messages in DLQ**: Failed messages (alerts!)

### Workers:
- **Worker count**: Auto-scaling target
- **Processing time per message**: Should be < 1 minute
- **Error rate**: Should be < 1%

---

## Common Questions

**Q: Why not just have workers poll the database directly?**
A: Queue provides buffering, retries, and decoupling. Direct DB polling would require workers to constantly query, which is inefficient and doesn't buffer spikes.

**Q: Why run scheduler every 30-60 seconds? Why not faster?**
A: 30-60 seconds is fast enough for email campaigns (not real-time). Faster = more Lambda invocations = more cost. Balance between responsiveness and cost.

**Q: What if scheduler creates jobs faster than workers can process?**
A: Queue buffers them. Workers scale up automatically. Queue can hold thousands of messages.

**Q: What if a worker crashes mid-processing?**
A: Message becomes visible again after visibility timeout (5 minutes). Another worker picks it up and retries.

**Q: Can we have multiple schedulers?**
A: Technically yes, but not recommended. They'd all query the same enrollments and create duplicate jobs. Better to have one scheduler that's fast enough.

---

## Summary

```
┌─────────────┐
│  Scheduler  │  (Lambda, runs every 30-60s)
│             │  Queries enrollments
│  "What next?"│  Creates message_jobs
└──────┬──────┘  Pushes to queue
       │
       │ {message_job_id}
       ↓
┌─────────────┐
│   Queue     │  (SQS send_queue - REQUIRED)
│  (Buffer)   │  Holds messages
└──────┬──────┘  Provides retries
       │
       │ Workers pull messages
       ↓
┌─────────────┐
│ Send Workers│  (ECS Fargate)
│             │  Pull from queue
│  "Do work"  │  Send emails
│             │  Write events (synchronous)
└─────────────┘  Update database

┌─────────────┐
│   Scheduler │  (CloudWatch → Lambda/ECS)
│             │  Runs every 5 minutes
│  Inbox      │  Checks all mailboxes
│  Checker    │  Detects replies/bounces
└─────────────┘  Updates enrollments (synchronous)
```

**Scheduler**: Fast, decision-making, runs periodically
**Queue**: Buffer, decouples scheduler from workers
**Workers**: Heavy lifting, scales based on load

This separation makes the system scalable, reliable, and cost-effective.

