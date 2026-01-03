# Phase 3.1: Flow Evaluation Engine - Detailed Implementation Plan

## Overview

This phase implements the core flow evaluation logic for the scheduler ECS workers. The scheduler workers will:
- Poll Supabase database continuously for enrollments ready to process
- Traverse flow graphs to find next nodes from current position
- Handle different node types (email, waitTime, aiCategorizer, dataSender, leadSource)
- Handle branching logic (AICategorizer creates multiple paths)
- Calculate proper `next_run_at` timestamps based on campaign schedules, wait times, and jitter
- Create message_jobs for email nodes and update enrollments appropriately
- Auto-scale based on enrollment count (similar to send workers scaling on SQS queue depth)

**Prerequisites:**
- ✅ Phase 2.3: ECS Cluster & Service infrastructure (can reuse same cluster)
- ✅ Phase 2.6: Docker build process established
- ✅ Phase 1: Database schema (enrollments, message_jobs, campaigns with schedule)
- ✅ Flow builder UI creates `campaigns.flow_data` with nodes and edges
- ⚠️ **Existing Lambda Scheduler**: `amplify/functions/scheduler/` exists and is deployed, but will be replaced by ECS workers

**Current State:**
- Basic flow evaluation exists but is placeholder (in Lambda at `amplify/functions/scheduler/handler.ts`)
- Only handles simple edge traversal
- No branching logic
- No scheduling logic (campaign schedules, jitter)
- No node-type-specific handling
- **Architecture Change**: Moving from Lambda (scheduled every 1 minute) to ECS Workers (continuous polling)
- **Migration Path**: Logic from Lambda will be moved to `workers/scheduler-worker/`, Lambda will be deprecated/removed after migration

---

## Architecture

```
┌─────────────────────┐
│  Supabase Database  │
│  (enrollments)      │
└──────────┬──────────┘
           │
           │ Continuous Polling
           │ Query: enrollments WHERE next_run_at <= NOW()
           ▼
┌─────────────────────┐
│  ECS Service        │
│  (Scheduler Workers)│
│  ┌───────────────┐  │
│  │ Task 1        │  │ Polls DB, evaluates flows
│  └───────────────┘  │
│  ┌───────────────┐  │
│  │ Task 2        │  │ (Auto-scales based on enrollment count)
│  └───────────────┘  │
└──────────┬──────────┘
           │
           │ Flow Evaluation Engine
           ▼
┌─────────────────────┐
│  ┌───────────────┐  │
│  │ Load Flow     │  │ campaigns.flow_data
│  │ Graph         │  │
│  └───────┬───────┘  │
│          │          │
│  ┌───────▼───────┐  │
│  │ Traverse      │  │ Find next nodes from current_node_id
│  │ Edges         │  │
│  └───────┬───────┘  │
│          │          │
│  ┌───────▼───────┐  │
│  │ Handle Node   │  │ email → create message_job
│  │ Types         │  │ waitTime → update next_run_at
│  │               │  │ aiCategorizer → branch logic
│  └───────┬───────┘  │
│          │          │
│  ┌───────▼───────┐  │
│  │ Calculate     │  │ Apply campaign schedule
│  │ Schedule      │  │ Apply jitter
│  │               │  │ Calculate next_run_at
│  └───────┬───────┘  │
└──────────┼──────────┘
           │
           │ Create message_jobs → Push to SQS
           │ Update enrollments
           ▼
┌─────────────────────┐
│  SQS Queue          │
│  (send_queue)       │
└─────────────────────┘
```

**Key Differences from Lambda:**
- **Continuous Polling**: Workers poll database continuously (not scheduled every 1 minute)
- **Auto-Scaling**: Scales based on enrollment count metric (not fixed schedule)
- **No Timeout Limits**: Can process enrollments as fast as database allows
- **Parallel Processing**: Multiple workers process enrollments simultaneously

---

## Step 1: Understand Enrollments and Leads

### 1.1 Enrollment-to-Lead Relationship

**Critical Understanding:**
- **One enrollment = one lead** (1:1 relationship)
- `enrollments.lead_id` references a single lead
- `UNIQUE(campaign_id, lead_id)` constraint ensures one enrollment per lead per campaign
- Each enrollment tracks where that specific lead is in the flow

**Scheduler Processing:**
- Workers continuously poll: `SELECT * FROM enrollments WHERE state = 'active' AND next_run_at <= NOW() LIMIT 100`
- **Each worker processes up to 100 enrollments per poll** (configurable)
- **Multiple workers run in parallel** (auto-scales based on enrollment count)
- Each enrollment represents one lead that needs to be evaluated

**Example:**
```
9:00 AM: 1,000 enrollments ready
- 10 workers scale up automatically
- Each worker polls and processes ~100 enrollments
- Total: ~1 minute to process all 1,000 (vs 20 minutes with Lambda)
```

**Auto-Scaling:**
- CloudWatch metric: Count of enrollments where `state = 'active' AND next_run_at <= NOW()`
- Scale up when count > 100 (add more workers)
- Scale down when count < 10 (reduce workers)
- Similar pattern to send workers scaling on SQS queue depth

### 1.2 Lead Distribution Across Mailboxes

**The Problem:**
- When processing enrollments (multiple leads), we need to select a mailbox for each email node
- **Question**: How should leads be distributed across available mailboxes?

**Current State:**
- No mailbox selection logic exists
- Would just pick first available mailbox
- All 50 leads could end up using the same mailbox (bad for throttling)

**Strategy: Round-Robin Distribution**

**Goal**: Distribute leads evenly across available mailboxes to:
- Avoid hitting throttle limits on a single mailbox
- Balance load across all mailboxes
- Maximize sending capacity

**Algorithm:**
1. **Load available mailboxes** for the campaign's account:
   - Query `mailboxes` WHERE `account_id = campaign.owner.account_id`
   - Filter: `smtp_status = 'active'` AND `status = 'connected'`
2. **For each enrollment (lead) being processed:**
   - Select mailbox using round-robin (rotate through available mailboxes)
   - Track last selected mailbox index (in-memory during batch processing)
   - If mailbox becomes unavailable (throttled), skip to next available
3. **Result**: Leads are distributed across mailboxes
   - Example: 50 leads, 3 mailboxes → ~17 leads per mailbox

**Implementation:**
```typescript
// In processEnrollment() or batch processing
let mailboxIndex = 0; // Track rotation across batch

async function selectMailboxForLead(
  campaignId: string,
  accountId: string,
  availableMailboxes: Mailbox[],
  currentIndex: number
): Promise<Mailbox | null> {
  if (availableMailboxes.length === 0) {
    return null; // No mailboxes available
  }
  
  // Round-robin: rotate through available mailboxes
  const selectedIndex = currentIndex % availableMailboxes.length;
  return availableMailboxes[selectedIndex];
}
```

**Per-Run Distribution:**
- **One lead per mailbox per run?** No - multiple leads can use the same mailbox
- **Distribution**: Round-robin ensures even distribution across the batch
- **Example**: 50 leads, 3 mailboxes
  - Lead 1, 4, 7, 10... → Mailbox A
  - Lead 2, 5, 8, 11... → Mailbox B
  - Lead 3, 6, 9, 12... → Mailbox C

**Throttle Considerations:**
- Scheduler should check throttle limits before selecting mailbox (see Step 6)
- If mailbox is at throttle limit, skip it and use next available
- Worker will do final atomic throttle check before sending

### 1.3 Account-to-Mailbox Relationship

**Ownership Chain:**
```
Campaign → owner_id (user) → account_users → account_id → mailboxes
```

**Steps to Find Available Mailboxes:**
1. Load campaign → get `owner_id`
2. Load user → get user `id` from `external_id` (Cognito user ID)
3. Load `account_users` → get `account_id` for that user
4. Load `mailboxes` WHERE `account_id = X` AND `smtp_status = 'active'` AND `status = 'connected'`

**Note:** A campaign might belong to multiple accounts (via organization_id), but for now we'll use the owner's primary account.

---

## Step 2: Enhance Flow Traversal Logic

### Current Implementation
The current `evaluateFlow` function only does basic edge traversal:
- Finds edges where `source === current_node_id`
- Returns target nodes

### What Needs to Be Added

#### 1.1 Handle Entry Point (No current_node_id)
**Scenario**: New enrollment, `current_node_id` is NULL
- Find the entry node (usually `leadSource` node)
- If multiple entry nodes, use the first one or handle based on campaign config
- Set `enrollment.current_node_id` to entry node

#### 1.2 Handle Node Type-Specific Logic
Different node types require different handling:

**Email Node:**
- Return the node (will create message_job)
- No special traversal logic needed

**WaitTime Node:**
- Return the node (will update next_run_at)
- Extract `wait_duration_seconds` from `node.data`

**AICategorizer Node:**
- **Branching logic**: Creates multiple paths
- Need to evaluate AI categorization result
- For now: Return all target nodes (Phase 3.4 will implement AI evaluation)
- Or: Return first/default category path (placeholder)

**DataSender Node:**
- Return the node (will execute data send)
- No special traversal logic needed

**LeadSource Node:**
- Entry point only, shouldn't appear in traversal
- If encountered, skip or mark as error

#### 1.3 Handle Multiple Next Nodes
**Scenario**: Multiple edges from current node (branching)
- AICategorizer: Multiple category paths
- Regular branching: Multiple parallel paths
- **Decision**: Process all paths in parallel (create jobs for all)

#### 1.4 Handle No Next Nodes (Flow Complete)
**Scenario**: No edges from current node
- Mark enrollment as `state = 'completed'`
- Set `next_run_at = NULL`
- Log completion

---

## Step 3: Implement Scheduling Logic

### 2.1 Campaign Schedule Evaluation

**Campaign Schedule Structure** (from Phase 1.6):
```typescript
{
  timezone: string,        // e.g., "America/New_York"
  start_hour: number,     // 0-23
  end_hour: number,       // 0-23 (can be >= 24 for next day)
  days_of_week: number[] | null  // [1,2,3,4,5] = Mon-Fri, null = all days
}
```

**Logic:**
1. If `campaign.schedule` is `null` → Campaign runs 24/7, no restrictions
2. If schedule exists:
   - Convert current time to campaign timezone
   - Check if current time is within `start_hour` and `end_hour`
   - Check if current day is in `days_of_week` (or null = all days)
   - If outside schedule:
     - Calculate next allowed time within schedule
     - Set `next_run_at` to that time
     - Don't create message_job yet

**Implementation:**
- Use a timezone library (e.g., `date-fns-tz` or `luxon`)
- Handle timezone conversions properly
- Handle day-of-week calculations (0=Sunday, 6=Saturday)

### 2.2 WaitTime Node Scheduling

**WaitTime Node Data Structure:**
```typescript
{
  wait_duration_seconds: number  // e.g., 86400 = 24 hours
}
```

**Logic:**
1. Extract `wait_duration_seconds` from `node.data`
2. Calculate `next_run_at = NOW() + wait_duration_seconds`
3. Apply campaign schedule (if exists):
   - If calculated time is outside schedule, move to next allowed time
4. Apply jitter (see 2.3)
5. Update `enrollment.next_run_at` and `enrollment.current_node_id`

### 2.3 Jitter Implementation

**Purpose**: Randomize send timing to avoid pattern fingerprints

**Implementation:**
- Add random jitter to `next_run_at` calculations
- Jitter range: Configurable per account/tenant (default: ±10% of base delay)
- Example: If wait time is 24 hours (86400s), jitter could be ±2.4 hours (±8640s)
- Formula: `next_run_at = base_time + jitter_range * random(-1, 1)`

**Jitter Configuration:**
- Store in `accounts` table or campaign config
- Default: `jitter_percentage: 10` (10% jitter)
- Can be disabled: `jitter_percentage: 0`

### 2.4 Email Node Scheduling

**For Email Nodes:**
1. Calculate `scheduled_at` for message_job:
   - Base: `NOW()` (send immediately)
   - Apply campaign schedule: If outside schedule, move to next allowed time
   - Apply jitter: Small jitter (±5 minutes) to avoid synchronized sends
2. Create `message_job` with calculated `scheduled_at`
3. Update `enrollment.current_node_id` to email node
4. Set `enrollment.next_run_at` to after email is sent (for next node evaluation)

---

## Step 4: Node Type Handlers

### 4.1 Email Node Handler

**Input**: Enrollment, Email Node, Campaign, Account ID, Mailbox Rotation Index
**Output**: Message Job created, Enrollment updated

**Steps:**
1. Load lead data from `enrollments.lead_id`
2. **Select mailbox** using round-robin:
   - Call `selectMailbox(campaignId, accountId, supabase, mailboxRotationIndex)`
   - Returns mailbox for this lead (distributed across available mailboxes)
3. Calculate `scheduled_at` (apply schedule + jitter)
4. Create `message_job`:
   - `enrollment_id`, `campaign_id`, `lead_id`
   - `mailbox_id` (selected mailbox)
   - `node_id` (email node)
   - `status = 'pending'`
   - `scheduled_at` (calculated)
   - `message_data`: Subject, body from `node.data`
5. Push `message_job_id` to SQS queue
6. Update `enrollment.current_node_id` to email node
7. Set `enrollment.next_run_at` to `scheduled_at + 1 minute` (evaluate next node after email is scheduled)

### 4.2 WaitTime Node Handler

**Input**: Enrollment, WaitTime Node, Campaign
**Output**: Enrollment updated with new `next_run_at`

**Steps:**
1. Extract `wait_duration_seconds` from `node.data`
2. Calculate base `next_run_at = NOW() + wait_duration_seconds`
3. Apply campaign schedule (if exists)
4. Apply jitter
5. Update `enrollment`:
   - `current_node_id` = waitTime node
   - `next_run_at` = calculated time
6. Don't create message_job (wait node doesn't send emails)

### 4.3 AICategorizer Node Handler

**Input**: Enrollment, AICategorizer Node, Campaign, Lead Data
**Output**: Multiple enrollments or single enrollment with branch decision

**Current Implementation (Placeholder):**
- For now: Return all target nodes (process all branches)
- Phase 3.4+: Will implement AI evaluation to select specific category

**Steps:**
1. Load AICategorizer node data:
   - `categories`: Array of category names
   - `prompt`: AI prompt for categorization
2. **Placeholder**: Select first/default category path
3. Find edge matching selected category
4. Return target node for that category
5. Update `enrollment.current_node_id` to AICategorizer node
6. Set `enrollment.next_run_at` to `NOW() + 1 minute` (evaluate category result immediately)

**Future Enhancement (Phase 3.4+):**
- Call AI service to categorize lead
- Match category to edge label
- Follow only the matching category path

### 4.4 DataSender Node Handler

**Input**: Enrollment, DataSender Node, Campaign
**Output**: Enrollment updated, data sent (synchronous)

**Steps:**
1. Extract data sender config from `node.data`:
   - `endpoint_url`
   - `method` (GET, POST, etc.)
   - `payload_template`
2. Execute data send (synchronous - Phase 3.4 will implement)
3. Update `enrollment.current_node_id` to DataSender node
4. Set `enrollment.next_run_at` to `NOW() + 1 minute` (evaluate next node immediately)

### 4.5 LeadSource Node Handler

**Input**: Enrollment, LeadSource Node
**Output**: Error or skip

**Logic:**
- LeadSource is an entry point, not a traversal node
- If encountered during traversal, log warning and skip
- Or: Mark as flow complete (reached entry point again = cycle)

---

## Step 5: Calculate Scheduled Time Function

### 4.1 Function Signature

```typescript
function calculateScheduledAt(
  baseTime: Date,
  campaignSchedule: CampaignSchedule | null,
  jitterPercentage: number
): Date
```

### 4.2 Implementation Steps

1. **Start with base time**: `baseTime` (usually `NOW()`)
2. **Apply campaign schedule** (if exists):
   - Convert `baseTime` to campaign timezone
   - Check if within `start_hour` and `end_hour`
   - Check if current day is in `days_of_week`
   - If outside schedule:
     - Calculate next allowed time:
       - If before `start_hour`: Move to `start_hour` today
       - If after `end_hour`: Move to `start_hour` next allowed day
       - If wrong day: Move to `start_hour` next allowed day
3. **Apply jitter**:
   - Calculate jitter range: `(scheduled_time - base_time) * jitter_percentage / 100`
   - Add random jitter: `scheduled_time + random(-jitter_range, +jitter_range)`
   - Ensure jitter doesn't push time before `baseTime`
4. **Return final scheduled time**

### 4.3 Edge Cases

- **Schedule spans midnight**: `end_hour = 25` means 1 AM next day
- **Timezone DST**: Handle daylight saving time transitions
- **Jitter too large**: Cap jitter to prevent negative times or too far in future
- **No schedule**: Return `baseTime + jitter` (no schedule restrictions)

---

## Step 6: Mailbox Selection & Load Balancing

### 6.1 Mailbox Selection Strategy

**When**: During email node processing (Step 4.1)
**Where**: In `email-handler.ts` or `processEnrollment()`

**Requirements:**
1. Load mailboxes for campaign's account
2. Filter to available mailboxes (not throttled)
3. Select mailbox using round-robin (distribute leads across mailboxes)
4. Handle case where no mailboxes available

### 6.2 Implementation

**Function Signature:**
```typescript
async function selectMailbox(
  campaignId: string,
  accountId: string,
  supabase: SupabaseClient,
  currentIndex: number // For round-robin rotation
): Promise<Mailbox | null>
```

**Steps:**
1. Load mailboxes for account:
   ```typescript
   const { data: mailboxes } = await supabase
     .from('mailboxes')
     .select('*')
     .eq('account_id', accountId)
     .eq('smtp_status', 'active')
     .eq('status', 'connected');
   ```
2. Check throttle limits (optional - can defer to worker):
   - Load `mailbox_throttles` for today
   - Filter out mailboxes at daily/hourly/min_gap limits
   - **Note**: For Phase 3.1, we can skip throttle checking here and let worker handle it
3. Round-robin selection:
   ```typescript
   if (availableMailboxes.length === 0) {
     return null; // No mailboxes available
   }
   const selectedIndex = currentIndex % availableMailboxes.length;
   return availableMailboxes[selectedIndex];
   ```

### 6.3 Account Loading in Scheduler

**Where**: In `processEnrollment()` function, before processing email nodes

**Steps:**
1. Load campaign → get `owner_id`
2. Load user from `users` table WHERE `external_id = owner_id`
3. Load `account_users` WHERE `user_id = user.id` → get `account_id`
4. Pass `account_id` to `selectMailbox()`

**Caching Consideration:**
- Can cache account_id per campaign (campaigns don't change owner often)
- But keep it simple for now - load on each run

### 6.4 Batch Processing with Round-Robin

**In Scheduler Handler:**
```typescript
// Track mailbox rotation across batch
let mailboxRotationIndex = 0;

for (const enrollment of enrollments) {
  // Load account for this enrollment's campaign
  const accountId = await getAccountIdForCampaign(enrollment.campaign_id);
  
  // Process enrollment (may create email node)
  const result = await processEnrollment(
    enrollment,
    supabase,
    sqs,
    sendQueueUrl,
    accountId, // Pass account_id
    mailboxRotationIndex // Pass rotation index
  );
  
  // Increment rotation index for next enrollment
  if (result.messageJobsCreated > 0) {
    mailboxRotationIndex++;
  }
}
```

**Result**: Leads are distributed across mailboxes in round-robin fashion

### 6.5 Error Handling

**No Mailboxes Available:**
- All mailboxes at throttle limit or no mailboxes configured
- **Option 1**: Skip enrollment, retry in 1 hour (set `next_run_at`)
- **Option 2**: Create message_job anyway, let worker handle throttle check (recommended)
- **Recommendation**: Create message_job, worker's atomic throttle check will handle rate limiting

**No Account Found:**
- Campaign owner has no account membership
- Log error, mark enrollment as error
- Or: Use default account (if exists)

---

## Step 7: Update Scheduler Handler

### 5.1 Enhance `evaluateFlow` Function

**Current:**
```typescript
function evaluateFlow(enrollment: Enrollment, flowData: any): any[]
```

**Enhanced:**
- Handle `current_node_id === null` (entry point)
- Handle different node types
- Handle branching (AICategorizer)
- Return structured result with node type and metadata

**Return Type:**
```typescript
interface FlowEvaluationResult {
  nodes: Array<{
    node: any;
    nodeType: string;
    metadata: {
      waitDuration?: number;
      category?: string;
      // ... other node-specific data
    };
  }>;
  isComplete: boolean;
  error?: string;
}
```

### 8.2 Enhance `processEnrollment` Function

**Current flow:**
1. Load campaign
2. Evaluate flow → get next nodes
3. For each node: create message_job or update enrollment

**Enhanced flow:**
1. Load campaign (with schedule)
2. **Load account** (for mailbox selection and jitter config):
   - Get `campaign.owner_id`
   - Load user from `users` WHERE `external_id = owner_id`
   - Load `account_users` WHERE `user_id = user.id` → get `account_id`
3. Evaluate flow → get next nodes with metadata
4. **Initialize mailbox rotation index** (passed from scheduler handler)
5. For each node:
   - Route to appropriate node handler (email, waitTime, etc.)
   - **For email nodes**: Pass `account_id` and `mailboxRotationIndex` to handler
   - Handler calculates `next_run_at` with schedule + jitter
   - Handler creates jobs or updates enrollment
6. Handle errors and logging

### 8.3 Add Helper Functions

**`findEntryNode(flowData: any): any | null`**
- Finds the entry node (usually leadSource)
- Returns first node with no incoming edges, or leadSource node

**`isWithinSchedule(time: Date, schedule: CampaignSchedule | null): boolean`**
- Checks if time is within campaign schedule
- Returns true if no schedule (24/7)

**`calculateNextAllowedTime(baseTime: Date, schedule: CampaignSchedule): Date`**
- Calculates next time that's within schedule
- Handles timezone, hours, days of week

**`applyJitter(time: Date, baseTime: Date, jitterPercentage: number): Date`**
- Applies random jitter to scheduled time
- Ensures jitter doesn't create invalid times

**`getAccountIdForCampaign(campaignId: string, supabase: SupabaseClient): Promise<string | null>`**
- Loads campaign → gets owner_id
- Loads user → gets account_id
- Returns account_id for mailbox selection

**`selectMailbox(campaignId: string, accountId: string, supabase: SupabaseClient, rotationIndex: number): Promise<Mailbox | null>`**
- Loads mailboxes for account
- Filters to available mailboxes
- Returns mailbox using round-robin (rotationIndex % availableMailboxes.length)

---

## Step 9: Database Considerations

### 9.1 Enrollment Updates

**When to update `enrollment.current_node_id`:**
- After processing a node (email, waitTime, etc.)
- Set to the node that was just processed

**When to update `enrollment.next_run_at`:**
- WaitTime node: Set to calculated wait time
- Email node: Set to `scheduled_at + 1 minute` (evaluate next after email scheduled)
- Other nodes: Set to `NOW() + 1 minute` (evaluate next immediately)

**When to mark `enrollment.state = 'completed'`:**
- No next nodes found (flow complete)
- Reached terminal node

### 9.2 Message Job Creation

**Required fields:**
- `enrollment_id`, `campaign_id`, `lead_id`, `mailbox_id`, `node_id`
- `status = 'pending'`
- `scheduled_at` (calculated with schedule + jitter)
- `message_data` (from node.data)

**Optional fields:**
- `sqs_message_id` (set after pushing to SQS)

### 9.3 Account Jitter Configuration

**Option 1**: Add to `accounts` table
- `jitter_percentage` column (default: 10)
- Can be customized per account

**Option 2**: Campaign-level jitter
- Add to `campaigns` table
- Override account default if needed

**Recommendation**: Start with account-level, add campaign-level later if needed

---

## Step 10: Error Handling

### 7.1 Flow Evaluation Errors

**Invalid flow_data:**
- Missing `nodes` or `edges`
- Log error, mark enrollment as error, continue with next enrollment

**Missing current_node_id:**
- Try to find entry node
- If no entry node found, mark enrollment as error

**Node not found:**
- `current_node_id` references node that doesn't exist in flow
- Log error, mark enrollment as error

### 10.2 Scheduling Errors

**Invalid schedule:**
- Malformed `campaign.schedule` JSONB
- Fall back to 24/7 (no restrictions)
- Log warning

**Timezone errors:**
- Invalid timezone string
- Fall back to UTC
- Log error

**Jitter calculation errors:**
- Negative jitter result
- Cap to 0 (no jitter)
- Log warning

### 10.3 Node Handler Errors

**Email node:**
- No mailboxes available → Mark message_job as failed, log error
- Invalid node.data → Log error, skip node

**WaitTime node:**
- Missing `wait_duration_seconds` → Use default (1 hour), log warning
- Invalid duration → Cap to max (e.g., 30 days), log warning

**AICategorizer node:**
- No categories defined → Use first/default edge, log warning
- No matching edges → Mark enrollment as error

---

## Step 11: Testing Strategy

### 8.1 Unit Tests

**Flow Traversal:**
- Simple linear flow (A → B → C)
- Branching flow (A → B, A → C)
- AICategorizer branching
- Circular flow detection
- Missing node detection
- Entry node finding

**Scheduling:**
- Campaign schedule within hours
- Campaign schedule outside hours
- Day-of-week restrictions
- Timezone conversions
- Jitter calculations
- Schedule spanning midnight

**Node Handlers:**
- Email node: Message job creation
- WaitTime node: Next run calculation
- AICategorizer: Branch selection (placeholder)
- DataSender: Data send execution

### 8.2 Integration Tests

**End-to-end flow:**
1. Create enrollment with `current_node_id = null`
2. Run scheduler
3. Verify entry node found
4. Verify next nodes evaluated
5. Verify message_jobs created (for email nodes)
6. Verify `enrollment.next_run_at` updated correctly

**Schedule enforcement:**
1. Create enrollment with campaign schedule
2. Run scheduler outside schedule hours
3. Verify `next_run_at` set to next allowed time
4. Verify no message_jobs created yet

**Jitter application:**
1. Create multiple enrollments with same wait time
2. Run scheduler
3. Verify `next_run_at` times are randomized (not identical)

### 8.3 Manual Testing

**Test scenarios:**
- Simple email flow
- Email → WaitTime → Email flow
- AICategorizer branching (placeholder)
- Campaign with business hours schedule
- Campaign with timezone (e.g., PST vs EST)
- Multiple enrollments in same campaign

---

## Step 12: Implementation Order

### Recommended Order:

1. **Create scheduler worker infrastructure** (Step 7 - CRITICAL, do this first)
   - Create `workers/scheduler-worker/` directory structure
   - Implement `DatabaseClient` (polls Supabase instead of SQS)
   - Implement `SchedulerWorker` main loop
   - Create Dockerfile and build process
   - Set up ECS service in CDK
   - Create CloudWatch custom metric Lambda for auto-scaling

2. **Understand enrollments and leads** (Step 1)
   - Document enrollment-to-lead relationship
   - Understand continuous processing (not batch)
   - Plan mailbox distribution strategy

3. **Implement mailbox selection** (Step 6 - CRITICAL)
   - Load account from campaign owner
   - Load mailboxes for account
   - Implement round-robin selection
   - Update `processEnrollment()` to pass account_id and rotation index

4. **Enhance `evaluateFlow` function** (Step 2)
   - Handle entry point (null current_node_id)
   - Handle different node types
   - Return structured results

5. **Implement scheduling helpers** (Step 3)
   - `calculateScheduledAt` function
   - `isWithinSchedule` function
   - `calculateNextAllowedTime` function
   - `applyJitter` function

6. **Implement node handlers** (Step 4)
   - Email node handler (uses mailbox selection)
   - WaitTime node handler
   - AICategorizer node handler (placeholder)
   - DataSender node handler (placeholder)

7. **Update `processEnrollment` function** (Step 8)
   - Load account for campaign owner
   - Pass account_id to mailbox selection
   - Integrate node handlers
   - Apply scheduling logic
   - Handle errors

8. **Add account jitter configuration** (Step 9)
   - Add `jitter_percentage` to accounts table (migration)
   - Load jitter config in scheduler

9. **Testing** (Step 11)
   - Unit tests for database polling
   - Unit tests for mailbox selection
   - Unit tests for each component
   - Integration tests (multiple workers, lead distribution)
   - Manual testing with auto-scaling

---

## Dependencies

### Required Libraries

**Timezone handling:**
- `date-fns-tz` or `luxon` (recommended: `date-fns-tz` - lighter weight)
- Install: `npm install date-fns-tz`

**AWS SDK:**
- `@aws-sdk/client-sqs` - For pushing message_jobs to send_queue
- `@aws-sdk/client-ssm` - For fetching secrets from Parameter Store
- `@aws-sdk/client-cloudwatch` - For publishing custom metrics (if using Option 2)

**No additional dependencies needed** for basic flow evaluation
- AI categorization will need AI SDK (Phase 3.4+)
- DataSender will need HTTP client (Phase 3.4+)

### Database Schema

**Required tables (already exist):**
- `campaigns` (with `schedule` JSONB column)
- `enrollments` (with `current_node_id`, `next_run_at`)
- `message_jobs`
- `nodes`
- `accounts` (for jitter config - may need migration)

---

## Code Structure

### File Organization

**Scheduler Worker:**
```
workers/scheduler-worker/
├── src/
│   ├── index.ts                 # Main entry point (initializes worker)
│   ├── worker.ts                # Core worker logic (main polling loop)
│   ├── database.ts              # Supabase polling logic (replaces SQS)
│   ├── flow-evaluation.ts      # Flow traversal logic
│   ├── scheduling.ts            # Schedule calculation logic
│   ├── node-handlers/
│   │   ├── email-handler.ts    # Email node processing
│   │   ├── wait-time-handler.ts # WaitTime node processing
│   │   ├── ai-categorizer-handler.ts # AICategorizer node processing
│   │   └── data-sender-handler.ts # DataSender node processing
│   ├── utils/
│   │   ├── timezone.ts         # Timezone utilities
│   │   └── jitter.ts           # Jitter calculation
│   ├── supabase.ts             # Supabase client setup
│   └── types.ts                # Type definitions
├── Dockerfile
├── package.json
├── tsconfig.json
└── README.md
```

**CloudWatch Metric Lambda (for auto-scaling):**
```
amplify/functions/enrollmentMetric/
├── handler.ts                   # Queries enrollment count, publishes metric
├── resource.ts
├── package.json
└── tsconfig.json
```

---

## Success Criteria

✅ **Infrastructure:**
- Scheduler worker ECS service deployed and running
- Workers poll database continuously (not scheduled)
- Auto-scaling works based on enrollment count
- CloudWatch custom metric published correctly

✅ **Flow Traversal:**
- Correctly finds next nodes from current position
- Handles entry point (null current_node_id)
- Handles branching (AICategorizer)
- Handles flow completion (no next nodes)

✅ **Scheduling:**
- Campaign schedule enforced correctly
- WaitTime delays applied correctly
- Jitter randomized properly
- Timezone conversions accurate

✅ **Node Processing:**
- Email nodes create message_jobs
- WaitTime nodes update next_run_at
- AICategorizer nodes handle branching (placeholder)
- All node types update enrollment.current_node_id

✅ **Performance:**
- Workers process enrollments continuously (no 1-minute delays)
- Multiple workers process enrollments in parallel
- Auto-scaling responds to enrollment count changes
- 1,000 enrollments processed in ~1 minute (vs 20 minutes with Lambda)

✅ **Error Handling:**
- Invalid flows handled gracefully
- Missing nodes logged and skipped
- Schedule errors fall back safely
- Individual enrollment errors don't stop worker processing

---

## Next Steps After Phase 3.1

Once Phase 3.1 is complete:
- Phase 3.2: Send Worker enhancements (already done, may need updates)
- Phase 3.3: SMTP Integration enhancements (already done, may need updates)
- Phase 3.4: Inbox Checker Implementation (full IMAP logic)
- Phase 4: Pacing & Throttling (atomic reservation, throttle enforcement)

---

## Notes

- **AICategorizer**: Placeholder implementation for now. Full AI evaluation will be Phase 3.4+
- **DataSender**: Placeholder implementation for now. Full HTTP sending will be Phase 3.4+
- **Jitter**: Start with simple percentage-based jitter. Can enhance later with per-mailbox jitter
- **Schedule**: Focus on common use cases first (business hours, timezone). Complex schedules can be added later
- **Testing**: Prioritize unit tests for scheduling logic (most complex part). Integration tests can be lighter initially

