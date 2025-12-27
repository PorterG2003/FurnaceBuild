# Queue Decision Analysis: event_queue & inbox_queue

## Analysis: Should We Use event_queue?

### What Events Need Processing?

When events occur (sent, replied, bounced, opened, clicked), we need to:

1. **Update Enrollment State** (Critical, needs to be fast)
   - `replied` → `enrollment.state = 'stopped'`
   - `bounced` → `enrollment.state = 'stopped'`, mark lead as suppressed
   - `unsubscribed` → `enrollment.state = 'stopped'`
   - **Why critical**: Scheduler shouldn't keep scheduling jobs for stopped enrollments

2. **Update Analytics/Stats** (Important, can be async)
   - Campaign stats (sent count, reply rate, etc.)
   - Mailbox stats (success rate, error rate)
   - Domain stats (aggregate performance)
   - **Why can be async**: Historical data, doesn't affect real-time behavior

3. **Trigger Flow Branches** (Medium priority)
   - IF nodes: Evaluate conditions, update enrollment flow position
   - AI Categorizer: Update branch based on result
   - **Why medium**: Affects next scheduler run, but doesn't need to be instant

4. **Write to Events Table** (Can be async)
   - Historical tracking/audit trail
   - **Why can be async**: Pure write, no impact on logic

### Option A: With event_queue (Async)

```
Send Worker sends email
  → Updates message_job.status = 'sent' (synchronous)
  → Pushes event to event_queue: {event_type: "sent", ...}
  → Continues (fast)

Event Processor (separate Lambda/ECS)
  → Pulls events from queue
  → Updates analytics, stats
  → (Enrollment state updates happen elsewhere)
```

**Pros:**
- ✅ Send workers stay fast (don't do heavy processing)
- ✅ Analytics processing doesn't slow down sending
- ✅ Can batch process events (more efficient DB writes)
- ✅ Can scale event processing independently
- ✅ Decouples sending from analytics

**Cons:**
- ❌ More complexity (another queue, another service)
- ❌ Events processed with delay (seconds to minutes)
- ❌ Need to handle idempotency (duplicate events)
- ❌ More infrastructure to manage and monitor

### Option B: Without event_queue (Synchronous)

```
Send Worker sends email
  → Updates message_job.status = 'sent'
  → Updates enrollment state if needed (replied/bounced detection)
  → Updates campaign stats (increment sent_count)
  → Writes to events table
  → Continues
```

**Pros:**
- ✅ Simpler architecture (fewer moving parts)
- ✅ Events processed immediately (no delay)
- ✅ No idempotency concerns
- ✅ Easier to debug (everything in one place)
- ✅ Less infrastructure

**Cons:**
- ❌ Send workers do more work (slower per email)
- ❌ Analytics updates slow down sending
- ❌ Can't scale analytics processing independently
- ❌ Harder to batch optimize database writes

### Recommendation: **NO event_queue** (Start Simple)

**Rationale:**
1. **Enrollment state updates should be synchronous anyway**
   - When a reply is detected, we need to stop the enrollment immediately
   - This happens in the inbox worker (when it detects reply), not via event_queue
   - Send workers don't need to update enrollment state

2. **Analytics can be updated synchronously**
   - Database writes are fast (simple UPDATE statements)
   - Not a bottleneck unless you're sending millions of emails/second
   - Can optimize later with batching if needed

3. **Simplicity wins early**
   - Start with synchronous processing
   - Add event_queue later if you hit performance issues
   - Premature optimization is the root of all evil

**Implementation:**
- Send workers: Update `message_job.status`, optionally update stats
- Inbox workers: Detect reply/bounce → Update `enrollment.state` synchronously
- Tracking endpoints: Write to `events` table directly
- Analytics: Can be computed from `events` table (or updated incrementally)

**When to add event_queue later:**
- You're sending > 10k emails/second
- Analytics updates become a bottleneck
- You need complex event processing that's expensive

---

## Analysis: Should We Use inbox_queue?

### What Does Inbox Checking Do?

Periodically check mailboxes for:
- Replies (In-Reply-To header matches sent Message-ID)
- Bounces (subject/body patterns, MAILER-DAEMON)
- Unsubscribes (List-Unsubscribe header, subject patterns)

For each detection:
- Update `enrollment.state` (if reply/bounce)
- Mark lead as suppressed (if bounce)
- Create `events` records
- Update `mailboxes.last_synced_at`

### Option A: With inbox_queue (Distributed)

```
CloudWatch Schedule (every 5 minutes)
  → Pushes mailbox sync jobs: {mailbox_id: "123"}, {mailbox_id: "456"}
  → To inbox_queue

Inbox Workers (ECS Fargate)
  → Poll inbox_queue
  → Pull job: {mailbox_id: "123"}
  → Connect via IMAP
  → Check for new messages
  → Process replies/bounces
  → Delete job from queue
```

**Pros:**
- ✅ Distributes work across many mailboxes
- ✅ Can prioritize mailboxes (higher priority mailboxes processed first)
- ✅ Scales inbox checking independently (add workers if queue is long)
- ✅ Can handle mailbox-specific failures gracefully (job fails, retries)
- ✅ Good for 100+ mailboxes

**Cons:**
- ❌ More complexity (need scheduler to push jobs)
- ❌ Queue overhead (messages per mailbox per check)
- ❌ Need to handle duplicate checks (what if job is processed twice?)
- ❌ More infrastructure

### Option B: Without inbox_queue (Direct Schedule)

```
Inbox Workers (ECS Scheduled Task or CloudWatch → Lambda)
  → Runs every 5 minutes
  → Queries: "SELECT * FROM mailboxes WHERE sync_enabled = true"
  → For each mailbox:
    → Connect via IMAP
    → Check for new messages since last_synced_at
    → Process replies/bounces
    → Update last_synced_at
```

**Pros:**
- ✅ Simpler architecture (no queue needed)
- ✅ Less infrastructure (just scheduled task)
- ✅ Easier to reason about (round-robin, predictable)
- ✅ Good for < 100 mailboxes
- ✅ No duplicate check concerns

**Cons:**
- ❌ All mailboxes checked by single worker (or need to partition manually)
- ❌ Harder to prioritize mailboxes
- ❌ If worker crashes, all mailboxes skipped until next run
- ❌ Less flexible for scaling

### Recommendation: **NO inbox_queue** (Start Simple)

**Rationale:**
1. **Mailbox checking is lightweight**
   - IMAP queries are fast (check since last_synced_at)
   - Can process many mailboxes sequentially in one worker run
   - No need for distribution unless you have 100+ mailboxes

2. **Simple scheduling works fine**
   - CloudWatch Event → Lambda or ECS Scheduled Task
   - One worker can check 50-100 mailboxes in 5 minutes
   - Add more workers if you have more mailboxes (partition by account_id or mailbox_id % worker_count)

3. **Failures are acceptable**
   - If one check fails, retry in 5 minutes (next scheduled run)
   - Not critical if a mailbox check is delayed by 5-10 minutes
   - Simpler error handling (just retry next run)

**Implementation:**
- CloudWatch Event Rule: Every 5 minutes
- Lambda or ECS Scheduled Task:
  - Query: `SELECT * FROM mailboxes WHERE sync_enabled = true AND status = 'active'`
  - For each mailbox: Check via IMAP, process, update `last_synced_at`
  - If many mailboxes: Partition by `mailbox_id % N` across N workers

**When to add inbox_queue later:**
- You have 100+ mailboxes
- Need to prioritize certain mailboxes (e.g., high-value campaigns)
- Need sub-minute reply detection (queue can process faster than schedule)
- Need to scale inbox checking independently from other workloads

---

## Final Recommendation

### Start Simple: NO queues except send_queue

```
Required:
  ✅ send_queue - Core of the system, required for scalability

Optional (skip for now):
  ❌ event_queue - Process events synchronously
  ❌ inbox_queue - Use scheduled tasks instead
```

### Architecture:

```
┌─────────────┐
│  Scheduler  │
│  (Lambda)   │
└──────┬──────┘
       │ Creates message_jobs
       │ Pushes to send_queue
       ↓
┌─────────────┐
│ send_queue  │ ←─── REQUIRED
└──────┬──────┘
       │
       ↓
┌─────────────┐
│ Send Workers│
│  (ECS)      │
└──────┬──────┘
       │ Sends email
       │ Updates message_job.status
       │ Updates stats (synchronous)
       │
       ↓
┌─────────────┐
│ Inbox Worker│
│ (Scheduled) │ ←─── CloudWatch → Lambda/ECS (every 5 min)
└──────┬──────┘
       │ Checks all mailboxes
       │ Detects replies/bounces
       │ Updates enrollment.state (synchronous)
       │ Creates events (synchronous)
```

### Benefits of Starting Simple:
1. ✅ Fewer moving parts = easier to debug
2. ✅ Less infrastructure = lower cost
3. ✅ Faster to implement = ship sooner
4. ✅ Easy to add queues later when needed

### When to Revisit:
- **event_queue**: If analytics/stats updates become a bottleneck (> 10k emails/sec)
- **inbox_queue**: If you have 100+ mailboxes or need prioritization

### Migration Path:
Both queues can be added later without breaking changes:
- **event_queue**: Change send workers to emit events instead of processing, add event processor
- **inbox_queue**: Change scheduled task to push jobs to queue, add inbox workers that poll queue

---

## Decision Summary

| Queue | Decision | Rationale |
|-------|----------|-----------|
| **send_queue** | ✅ **Required** | Core architecture, enables scalability |
| **event_queue** | ❌ **Skip** | Process events synchronously, add later if needed |
| **inbox_queue** | ❌ **Skip** | Use scheduled tasks, add later if needed |

**Start simple, optimize later when you have real data about bottlenecks.**

