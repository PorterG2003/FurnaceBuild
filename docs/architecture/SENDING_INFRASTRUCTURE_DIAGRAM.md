# Sending Infrastructure - Complete Breakdown Diagram

## Overview

This document provides a complete breakdown of how the email sending infrastructure works, from enrollment processing to email delivery.

---

## 1. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         SENDING INFRASTRUCTURE                           │
└─────────────────────────────────────────────────────────────────────────┘

┌──────────────────────┐         ┌──────────────────────┐
│  Scheduler Worker    │         │    Send Worker        │
│  (ECS Task)          │         │    (ECS Task)        │
│                      │         │                      │
│  - Processes        │         │  - Polls database    │
│    enrollments      │         │  - Claims jobs       │
│  - Creates          │────────▶│  - Sends emails     │
│    message_jobs     │         │  - Updates status    │
└──────────────────────┘         └──────────────────────┘
         │                                 │
         │                                 │
         ▼                                 ▼
┌─────────────────────────────────────────────────────────┐
│              Supabase PostgreSQL Database                │
│                                                          │
│  Tables:                                                 │
│  - enrollments (state, current_node_id, next_run_at)    │
│  - leads (mailbox_id)                                    │
│  - message_jobs (status, scheduled_at, mailbox_id)      │
│  - mailboxes (status, smtp_status)                       │
│  - campaign_mailboxes (junction table)                  │
│  - mailbox_throttles (min_gap_seconds)                   │
│                                                          │
│  Functions:                                              │
│  - claim_enrollments_ready()                            │
│  - create_message_job_if_slot_available()               │
│  - claim_message_jobs_ready()                           │
└─────────────────────────────────────────────────────────┘
```

---

## 2. Scheduler Worker Flow

### 2.1 Main Loop

```
┌─────────────────────────────────────────────────────────┐
│              SchedulerWorker.start()                     │
│  (Runs continuously, polls every 5 seconds)             │
└─────────────────────────────────────────────────────────┘
                        │
                        ▼
        ┌───────────────────────────────┐
        │  Claim enrollments from DB    │
        │  (claim_enrollments_ready)    │
        └───────────────────────────────┘
                        │
                        ▼
        ┌───────────────────────────────┐
        │  Process each enrollment      │
        │  (Promise.allSettled)         │
        └───────────────────────────────┘
                        │
                        ▼
        ┌───────────────────────────────┐
        │  processEnrollment()          │
        └───────────────────────────────┘
```

### 2.2 Enrollment Processing

```
processEnrollment(enrollment)
│
├─► Load Campaign
│   └─► Get: flow_data, schedule, sending_interval_seconds, jitter_percentage
│
├─► Load Account (for jitter fallback)
│
├─► Evaluate Flow
│   └─► Find next node(s) from current_node_id
│
└─► Process Each Next Node
    │
    ├─► Email Node
    │   └─► handleEmailNode() [SEE SECTION 3]
    │
    ├─► Wait Node
    │   └─► Calculate next_run_at
    │       └─► Update enrollment.next_run_at
    │
    └─► Other Nodes
        └─► Handle accordingly
```

---

## 3. Email Node Processing Flow

### 3.1 Complete Flow Diagram

```
handleEmailNode(enrollment, node, campaign, rotationIndex, jitterPercentage)
│
├─► STEP 1: Load Lead
│   └─► SELECT * FROM leads WHERE id = enrollment.lead_id
│
├─► STEP 2: Determine Mailbox Assignment
│   │
│   ├─► IF lead.mailbox_id IS NULL (First Email)
│   │   │
│   │   ├─► Check for existing message_jobs (consistency check)
│   │   │
│   │   ├─► Select Mailbox (Round-Robin)
│   │   │   └─► selectMailbox(campaign_id, rotationIndex)
│   │   │       └─► Load campaign_mailboxes
│   │   │       └─► Filter: status='connected', smtp_status='active'
│   │   │       └─► Round-robin: rotationIndex % availableMailboxes.length
│   │   │
│   │   └─► Atomically Assign Mailbox to Lead
│   │       └─► UPDATE leads SET mailbox_id = ? 
│   │           WHERE id = ? AND mailbox_id IS NULL
│   │       └─► IF race condition: Reload lead to get assigned mailbox
│   │
│   └─► ELSE (Subsequent Email)
│       └─► Load assigned mailbox
│       └─► Validate mailbox still in campaign
│       └─► Validate mailbox is available
│
├─► STEP 3: Calculate Base Time
│   └─► calculateNextMailboxSendTime() [SEE SECTION 4]
│       └─► Returns: baseTime (Date)
│
├─► STEP 4: Apply Schedule Constraints & Jitter
│   └─► calculateScheduledAt(baseTime, schedule, jitterPercentage)
│       │
│       ├─► IF schedule exists
│       │   └─► Check if baseTime is within schedule
│       │   └─► IF not: calculateNextAllowedTime()
│       │
│       └─► Apply Jitter
│           └─► applyJitter(scheduledTime, baseTime, jitterPercentage)
│           └─► Random offset: ±(jitterPercentage% of time difference)
│           └─► Returns: scheduledAt (ISO string) ⚠️ JITTERED TIME
│
└─► STEP 5: Create Message Job (Atomic Slot Check)
    └─► RPC: create_message_job_if_slot_available() [SEE SECTION 5]
        └─► Passes: scheduledAt (jittered time)
        └─► Returns: messageJob (with is_new_job flag)
```

---

## 4. Scheduling Calculation Flow

### 4.1 calculateNextMailboxSendTime()

```
calculateNextMailboxSendTime(campaignId, mailboxId, currentTime, schedule, supabase)
│
├─► STEP 1: Load Campaign
│   └─► Get: sending_interval_seconds, created_at
│
├─► STEP 2: Calculate Campaign Interval Base Time
│   │
│   ├─► IF no schedule
│   │   └─► Formula: (floor((currentTime - campaignStart) / interval) + 1) * interval
│   │   └─► Example: interval=300s, elapsed=750s → slot at 900s
│   │
│   └─► IF schedule exists
│       └─► Find most recent schedule start
│       └─► Calculate slot from schedule start
│       └─► Ensure slot is within schedule window
│
├─► STEP 3: Query Mailbox Minimum Gap
│   └─► SELECT min_gap_seconds FROM mailbox_throttles
│       WHERE mailbox_id = ? AND date = today
│   └─► Default: 180 seconds
│
├─► STEP 4: Query Last Scheduled Job
│   └─► SELECT scheduled_at FROM message_jobs
│       WHERE mailbox_id = ? AND campaign_id = ?
│       AND status IN ('pending', 'reserved', 'sending', 'sent')
│       ORDER BY scheduled_at DESC LIMIT 1
│   └─► ⚠️ ISSUE: Doesn't check for jobs in current/future slots
│
├─► STEP 5: Calculate Mailbox Minimum Time
│   └─► IF lastScheduledTime exists
│       └─► mailboxMinTime = lastScheduledTime + min_gap_seconds
│   └─► ELSE
│       └─► mailboxMinTime = campaignIntervalBaseTime
│
└─► STEP 6: Return Final Base Time
    └─► baseTime = max(campaignIntervalBaseTime, mailboxMinTime)
    └─► IF baseTime < currentTime: baseTime = currentTime
```

### 4.2 Jitter Application

```
calculateScheduledAt(baseTime, schedule, jitterPercentage)
│
├─► Apply Schedule Constraints
│   └─► IF outside schedule: move to next allowed time
│
└─► Apply Jitter
    │
    ├─► Calculate time difference: scheduledTime - baseTime
    ├─► Calculate jitter range: abs(timeDiff) * (jitterPercentage / 100)
    ├─► Generate random jitter: random(-jitterRange, +jitterRange)
    └─► Apply: scheduledAt = scheduledTime + jitter
    │
    └─► ⚠️ ISSUE: Jitter is applied BEFORE slot rounding
        └─► Two enrollments with same baseTime get different jittered times
        └─► These jittered times are then rounded to slots
        └─► Can result in same slot or different slots unpredictably
```

---

## 5. Database Function: create_message_job_if_slot_available()

### 5.1 Function Flow

```
create_message_job_if_slot_available(
  p_enrollment_id,
  p_campaign_id,
  p_lead_id,
  p_mailbox_id,
  p_node_id,
  p_scheduled_at,  ⚠️ This is JITTERED time
  p_message_data,
  p_campaign_interval_seconds
)
│
├─► STEP 1: Round scheduled_at to Slot Boundary
│   └─► v_slot_time = floor(p_scheduled_at / interval) * interval
│   └─► ⚠️ ISSUE: Rounding happens AFTER jitter is applied
│   └─► Example: 
│       - baseTime = 1000s
│       - jittered1 = 1002s → rounds to 1000s slot
│       - jittered2 = 999s → rounds to 900s slot (different!)
│       - jittered3 = 1001s → rounds to 1000s slot (same as jittered1)
│
├─► STEP 2: Define Tolerance Window
│   └─► v_tolerance_seconds = 1 second
│   └─► ⚠️ ISSUE: 1 second tolerance may be too small for jitter
│
├─► STEP 3: Check for Existing Job in Slot
│   └─► SELECT id FROM message_jobs
│       WHERE mailbox_id = p_mailbox_id
│       AND campaign_id = p_campaign_id
│       AND scheduled_at >= v_slot_time - 1s
│       AND scheduled_at <= v_slot_time + 1s
│       AND status IN ('pending', 'reserved', 'sending')
│       LIMIT 1
│       FOR UPDATE SKIP LOCKED
│   │
│   └─► ⚠️ RACE CONDITION: Gap between check and insert
│       └─► Worker A: Check → No job found
│       └─► Worker B: Check → No job found (before A inserts)
│       └─► Worker A: Insert job
│       └─► Worker B: Insert job (duplicate!)
│
├─► STEP 4: IF Slot Taken
│   └─► RETURN existing job (is_new_job = false)
│
└─► STEP 5: IF Slot Available
    └─► INSERT INTO message_jobs
        └─► scheduled_at = v_slot_time (rounded, not original jittered time)
        └─► ⚠️ ISSUE: Original jitter is lost, replaced with rounded slot time
    └─► RETURN new job (is_new_job = true)
```

### 5.2 Race Condition Detail

```
Time    Worker A                          Worker B
─────────────────────────────────────────────────────────────
T0      Check slot (no job found)         
T1                                    Check slot (no job found)
T2      [GAP - No lock held]         [GAP - No lock held]
T3      Insert job                   
T4                                    Insert job (DUPLICATE!)
─────────────────────────────────────────────────────────────
Result: Two jobs in same slot for same mailbox
```

---

## 6. Send Worker Flow

### 6.1 Main Loop

```
SendWorker.start()
│
└─► WHILE running
    │
    ├─► Poll Database
    │   └─► claim_message_jobs_ready(batch_size=100, timeout=5min)
    │       └─► Atomically UPDATE jobs to 'reserved'
    │       └─► WHERE status='pending' AND scheduled_at <= NOW()
    │       └─► Returns claimed jobs
    │
    ├─► IF jobs found
    │   └─► Process jobs in parallel (Promise.allSettled)
    │       └─► processMessageJob(job)
    │           │
    │           ├─► Load lead, mailbox, node config
    │           ├─► Merge template with lead data
    │           ├─► Create SMTP transporter
    │           ├─► Send email
    │           └─► Update job status to 'sent'
    │
    └─► ELSE (no jobs)
        └─► Adaptive polling: increase interval
            └─► 2s → 5s → 10s → 30s (exponential backoff)
```

### 6.2 Job Claiming

```
claim_message_jobs_ready(batch_size, timeout)
│
├─► STEP 1: Select Candidate Jobs
│   └─► SELECT id FROM message_jobs
│       WHERE status = 'pending'
│       AND scheduled_at <= NOW()
│       ORDER BY scheduled_at ASC
│       LIMIT batch_size
│       FOR UPDATE SKIP LOCKED
│
├─► STEP 2: Atomically Claim Jobs
│   └─► UPDATE message_jobs
│       SET status = 'reserved',
│           reserved_at = NOW()
│       WHERE id = ANY(selected_ids)
│       AND status = 'pending'  ← Double-check (atomic)
│       AND scheduled_at <= NOW()
│
└─► STEP 3: Return Claimed Jobs
    └─► SELECT * FROM message_jobs WHERE id = ANY(claimed_ids)
```

---

## 7. Data Flow: Complete Example

### 7.1 Example: Two Enrollments Processing Simultaneously

```
Enrollment A                    Enrollment B
─────────────────────────────────────────────────────────────
T0: Process enrollment A        T0: Process enrollment B
    │                               │
    ├─► Load lead (mailbox_id=NULL) ├─► Load lead (mailbox_id=NULL)
    │                               │
    ├─► Select mailbox (index=0)    ├─► Select mailbox (index=1)
    │   └─► Mailbox M1              └─► Mailbox M2
    │                               │
    ├─► Calculate baseTime          ├─► Calculate baseTime
    │   └─► baseTime = 1000s        │   └─► baseTime = 1000s (same!)
    │                               │
    ├─► Apply jitter                ├─► Apply jitter
    │   └─► scheduledAt = 1002s     │   └─► scheduledAt = 999s
    │                               │
    └─► RPC: create_message_job     └─► RPC: create_message_job
        │                                   │
        ├─► Round to slot                   ├─► Round to slot
        │   └─► slot_time = 1000s           │   └─► slot_time = 900s
        │                                   │
        ├─► Check slot (no job)             ├─► Check slot
        │                                   │                               │
        └─► Insert job                      └─► Insert job
            scheduled_at = 1000s                scheduled_at = 900s

Result: Different slots (good in this case)
```

### 7.2 Problem Case: Same Mailbox, Same Base Time

```
Enrollment A                    Enrollment B
─────────────────────────────────────────────────────────────
T0: Process enrollment A        T0: Process enrollment B
    │                               │
    ├─► Load lead (mailbox_id=NULL) ├─► Load lead (mailbox_id=NULL)
    │                               │
    ├─► Select mailbox (index=0)    ├─► Select mailbox (index=0)
    │   └─► Mailbox M1              │   └─► Mailbox M1 (SAME!)
    │   (race condition: both       │   (race condition: both
    │    select before either       │    select before either
    │    assigns)                   │    assigns)
    │                               │
    ├─► Calculate baseTime          ├─► Calculate baseTime
    │   └─► baseTime = 1000s        │   └─► baseTime = 1000s
    │                               │
    ├─► Apply jitter                ├─► Apply jitter
    │   └─► scheduledAt = 1002s     │   └─► scheduledAt = 1001s
    │                               │
    └─► RPC: create_message_job     └─► RPC: create_message_job
        │                                   │
        ├─► Round to slot                   ├─► Round to slot
        │   └─► slot_time = 1000s           │   └─► slot_time = 1000s
        │                                   │
        ├─► Check slot                      ├─► Check slot
        │   └─► No job found (tolerance      │   └─► No job found
        │       window: 999-1001s, but       │       (concurrent check)
        │       times differ by 1s)        │
        │                                   │
        └─► Insert job                      └─► Insert job
            scheduled_at = 1000s                scheduled_at = 1000s

Result: TWO JOBS IN SAME SLOT FOR SAME MAILBOX ❌
```

---

## 8. Key Issues Summary

### 8.1 Issue Matrix

| Issue | Location | Severity | Description |
|-------|----------|----------|-------------|
| **Jitter Before Slot Rounding** | `email-handler.ts:176` → `scheduling.ts:239` | 🔴 Critical | Jitter applied before slot calculation breaks slot-based system |
| **Race Condition in Slot Check** | `create_message_job_if_slot_available:49-106` | 🔴 Critical | Gap between check and insert allows duplicate jobs |
| **Tolerance Window Too Small** | `create_message_job_if_slot_available:47` | 🟡 Medium | 1 second tolerance may miss jittered times |
| **No Transaction Isolation** | `create_message_job_if_slot_available` | 🔴 Critical | Check and insert not in same atomic transaction |
| **Multiple Workers Same BaseTime** | `scheduling.ts:317-431` | 🟡 Medium | Concurrent workers calculate identical baseTimes |
| **No Check for Pending Jobs in Slot** | `scheduling.ts:388-396` | 🟡 Medium | Doesn't account for jobs already scheduled in current slot |

### 8.2 Root Cause Analysis

```
Primary Issue: Jitter Application Order
─────────────────────────────────────────
Current Flow:
  baseTime → applyJitter() → scheduledAt → roundToSlot() → checkSlot()

Problem:
  - Jitter creates variation BEFORE slot calculation
  - Two enrollments with same baseTime get different jittered times
  - These jittered times round to slots unpredictably
  - Can result in same slot or different slots

Correct Flow Should Be:
  baseTime → roundToSlot() → applyJitter() → checkSlot()

Solution:
  - Calculate slot FIRST (fixed, deterministic)
  - Apply jitter WITHIN the slot (small variation)
  - Slot check becomes reliable
```

---

## 9. Database Schema

### 9.1 Key Tables

```
enrollments
├─ id (UUID)
├─ campaign_id (UUID)
├─ lead_id (UUID)
├─ current_node_id (UUID, nullable)
├─ state ('active', 'paused', 'stopped', 'completed')
├─ next_run_at (TIMESTAMPTZ, nullable)
└─ flow_position (JSONB)

leads
├─ id (UUID)
├─ campaign_id (UUID)
├─ mailbox_id (UUID, nullable) ← Assigned on first email
├─ email (TEXT)
└─ ... (other lead fields)

message_jobs
├─ id (UUID)
├─ enrollment_id (UUID)
├─ campaign_id (UUID)
├─ lead_id (UUID)
├─ mailbox_id (UUID)
├─ node_id (UUID)
├─ status ('pending', 'reserved', 'sending', 'sent', 'failed')
├─ scheduled_at (TIMESTAMPTZ) ← Rounded to slot boundary
├─ reserved_at (TIMESTAMPTZ, nullable)
├─ sent_at (TIMESTAMPTZ, nullable)
└─ message_data (JSONB)

mailboxes
├─ id (UUID)
├─ email_address (TEXT)
├─ status ('connected', 'disconnected')
└─ smtp_status ('active', 'inactive')

campaign_mailboxes (junction)
├─ campaign_id (UUID)
└─ mailbox_id (UUID)

mailbox_throttles
├─ mailbox_id (UUID)
├─ date (DATE)
└─ min_gap_seconds (INTEGER, default 180)
```

---

## 10. Function Signatures

### 10.1 Scheduler Functions

```typescript
// Email Handler
handleEmailNode(
  enrollment: Enrollment,
  node: Node,
  campaign: Campaign,
  rotationIndex: number,  // Per-worker instance counter
  jitterPercentage: number,
  supabase: SupabaseClient
): Promise<MessageJob>

// Scheduling
calculateNextMailboxSendTime(
  campaignId: string,
  mailboxId: string,
  currentTime: Date,
  campaignSchedule: CampaignSchedule | null,
  supabase: SupabaseClient
): Promise<Date>

calculateScheduledAt(
  baseTime: Date,
  schedule: CampaignSchedule | null,
  jitterPercentage: number
): string  // ISO string

// Mailbox Selection
selectMailbox(
  campaignId: string,
  supabase: SupabaseClient,
  rotationIndex: number
): Promise<Mailbox | null>
```

### 10.2 Database Functions

```sql
-- Claim enrollments ready to process
claim_enrollments_ready(
  p_batch_size INTEGER DEFAULT 100,
  p_processing_timeout_minutes INTEGER DEFAULT 5
) RETURNS TABLE (...enrollment fields...)

-- Create message job with slot checking
create_message_job_if_slot_available(
  p_enrollment_id UUID,
  p_campaign_id UUID,
  p_lead_id UUID,
  p_mailbox_id UUID,
  p_node_id UUID,
  p_scheduled_at TIMESTAMPTZ,  -- ⚠️ Jittered time (should be base time)
  p_message_data JSONB,
  p_campaign_interval_seconds INTEGER
) RETURNS TABLE (...message_job fields..., is_new_job BOOLEAN)

-- Claim message jobs ready to send
claim_message_jobs_ready(
  p_batch_size INTEGER DEFAULT 100,
  p_processing_timeout_minutes INTEGER DEFAULT 5
) RETURNS TABLE (...message_job fields...)
```

---

## 11. Timing Diagram

```
Time    Scheduler Worker A          Scheduler Worker B          Database
─────────────────────────────────────────────────────────────────────────────
T0      Claim enrollments            Claim enrollments
        (enrollment A)                (enrollment B)
        │                             │
T1      Load lead                     Load lead
        (mailbox_id = NULL)           (mailbox_id = NULL)
        │                             │
T2      Select mailbox M1             Select mailbox M1
        (round-robin index=0)         (round-robin index=0)
        │                             │ (RACE: both select before assign)
        │                             │
T3      Calculate baseTime            Calculate baseTime
        baseTime = 1000s              baseTime = 1000s
        │                             │
T4      Apply jitter                  Apply jitter
        scheduledAt = 1002s           scheduledAt = 1001s
        │                             │
T5      RPC: create_message_job       RPC: create_message_job
        │                             │
        ├─► Round: slot=1000s         ├─► Round: slot=1000s
        │                             │
        ├─► Check slot                ├─► Check slot
        │   (no job found)            │   (no job found - concurrent)
        │                             │
        └─► Insert job                └─► Insert job
            scheduled_at=1000s             scheduled_at=1000s
            │                             │
            ▼                             ▼
        ┌─────────────────────────────────────────────────────┐
        │  message_jobs table                                  │
        │  ┌──────────────────────────────────────────────┐   │
        │  │ id | mailbox_id | scheduled_at | status     │   │
        │  ├──────────────────────────────────────────────┤   │
        │  │ A  | M1         | 1000s        | pending    │   │
        │  │ B  | M1         | 1000s        | pending    │ ← DUPLICATE!
        │  └──────────────────────────────────────────────┘   │
        └─────────────────────────────────────────────────────┘
```

---

## 12. Summary

### Current Architecture Strengths
✅ Atomic mailbox assignment (UPDATE with NULL check)  
✅ Atomic job claiming (UPDATE-based)  
✅ Slot-based scheduling concept  
✅ Mailbox minimum gap enforcement  
✅ Round-robin mailbox distribution  

### Current Architecture Weaknesses
❌ Jitter applied before slot rounding (breaks slot system)  
❌ Race condition in slot checking (no transaction isolation)  
❌ Tolerance window too small for jitter range  
❌ Multiple workers can create duplicate slots  
❌ No check for pending jobs when calculating baseTime  

### Critical Path Issues
1. **Jitter Order**: Should be `baseTime → slot → jitter`, not `baseTime → jitter → slot`
2. **Atomicity**: Slot check and insert need to be in same transaction
3. **Tolerance**: Needs to account for maximum jitter range, not just 1 second

---

*Last Updated: 2026-01-06*

