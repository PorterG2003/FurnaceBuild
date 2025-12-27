# Infrastructure Implementation Plan

## Overview

This document outlines the step-by-step plan to implement the scalable email infrastructure using AWS + Supabase + SMTP (Gmail-hosted mailboxes). The plan takes into account the existing codebase structure, including the React Flow builder, Supabase schema, and AWS Amplify setup.

**Note**: This architecture uses SMTP AUTH to Gmail-hosted mailboxes. Gmail still owns SMTP reputation, and no IP warmup is required. The system controls pacing, jitter, and behavior patterns.

---

## Current State Assessment

### ✅ Already Implemented
- **Control Plane (Frontend)**: React Flow builder, campaign management UI
- **Database Schema**: 
  - `campaigns` with `flow_data` (JSONB)
  - `leads` and `lead_states` for tracking flow progression (to be deleted)
  - `nodes` table (normalized from flow_data)
  - `scheduled_jobs` table (basic job scheduling structure - may be deleted)
  - `mailboxes` table (SMTP/IMAP credentials)
  - `users`, `accounts`, `account_users` (multi-tenancy)
- **AWS Amplify**: Basic backend setup with auth and data resources
- **Node Types**: Email, WaitTime, AICategorizer, DataSender, LeadSource

### 🔄 Needs Adaptation
- `lead_states` → Will be **deleted** (replaced by `enrollments`)
- `scheduled_jobs` → May be deleted (replaced by `enrollments.next_run_at` + `message_jobs`)
- `mailboxes` → SMTP credentials already exist, may need enhancements for connection pooling/management

### ❌ Not Yet Implemented
- AWS infrastructure (SQS, ECS, Lambda, CloudWatch Scheduler)
- SMTP integration (connection pooling, error handling)
- Scheduling plane (flow evaluation + job creation)
- Execution plane (send workers)
- Inbound processing (reply detection via IMAP)
- Event processing (state transitions, analytics)
- Pacing/throttling logic

---

## Phase 1: Database Schema Evolution

### 1.0 Cleanup Existing Tables (if not in production)
**Purpose**: Remove old schema that will be replaced

**Tasks**:
- Drop `lead_states` table (replaced by `enrollments`)
- Evaluate `scheduled_jobs` table:
  - If keeping: Remove `lead_state_id` FK, update to reference `enrollment_id` instead
  - If deleting: Drop table (scheduling handled by `enrollments.next_run_at`)
- Remove any triggers/functions that reference `lead_states`
- Update TypeScript types to remove `lead_states` references

### 1.1 Create Enrollments Table
**Purpose**: Track prospect-in-flow state (replaces `lead_states`)

**Tasks**:
- Create `enrollments` table with:
  - `id`, `campaign_id`, `lead_id` (FKs)
  - `current_node_id` (FK to `nodes.id`)
  - `state` ('active', 'paused', 'stopped', 'completed')
  - `next_run_at` (when to evaluate next - respects campaign schedule)
  - `flow_position` (JSONB snapshot of current position in graph)
  - Timestamps
- Indexes: `(next_run_at, state)` WHERE `state = 'active'`

**Note**: Since the app is not in production use, we will delete the `lead_states` table entirely rather than migrating from it.

### 1.2 Create Message Jobs Table
**Purpose**: Concrete send actions created by scheduler

**Tasks**:
- Create `message_jobs` table with:
  - `id`, `enrollment_id`, `campaign_id`, `lead_id`, `mailbox_id`
  - `node_id` (FK to `nodes.id` - the email node)
  - `status` ('pending', 'reserved', 'sending', 'sent', 'failed', 'cancelled')
  - `scheduled_at`, `reserved_at`, `sent_at`
  - `provider_message_id` (SMTP Message-ID header, for reply detection)
  - `error_message`, `retry_count`
  - `message_data` (JSONB: subject, body, template vars)
- Indexes: `(status, scheduled_at)` WHERE `status = 'pending'`
- Add SQS message ID tracking column

### 1.3 Enhance Mailboxes for SMTP Operations
**Purpose**: Optimize SMTP credential storage and add connection management fields

**Tasks**:
- Verify/enhance existing SMTP columns in `mailboxes`:
  - `smtp_host`, `smtp_port`, `smtp_username`, `smtp_password` (already exist)
  - Ensure passwords are encrypted at rest (use Supabase Vault or AWS Secrets Manager)
- Add SMTP connection management columns:
  - `smtp_connection_limit` (max concurrent connections per mailbox, default: 5)
  - `smtp_messages_per_connection` (max messages per connection before reconnect, default: 100)
  - `smtp_last_connected_at` (for connection health tracking)
  - `smtp_error_count` (track consecutive failures)
  - `smtp_status` ('active', 'throttled', 'error', 'disabled')
- Add provider metadata:
  - `provider` (TEXT - flexible provider name, e.g., 'gmail', 'google_workspace', 'provider_name', etc.)
- Indexes: `(smtp_status)` for worker queries (filtering active mailboxes)

### 1.4 Create Events Table
**Purpose**: Track all events (sent, replied, bounced, opened, clicked)

**Tasks**:
- Create `events` table with:
  - `id`, `campaign_id`, `lead_id`, `enrollment_id`, `message_job_id`
  - `event_type` ('sent', 'delivered', 'opened', 'clicked', 'replied', 'bounced', 'unsubscribed')
  - `event_data` (JSONB: metadata, timestamps, provider data)
  - `created_at`
- Indexes: `(campaign_id, event_type, created_at)`, `(enrollment_id, event_type)`

### 1.5 Create Mailbox Throttle Table
**Purpose**: Track per-mailbox rate limits and caps

**Tasks**:
- Create `mailbox_throttles` table:
  - `mailbox_id` (FK to `mailboxes.id`), `date` (date)
  - `sent_count` (emails sent today)
  - `hourly_sent` (array or JSONB tracking hourly counts, reset hourly)
  - `last_sent_at` (timestamp of last send for min-gap enforcement)
  - `daily_limit` (default: based on mailbox provider/Gmail limits, ~50-200/day)
  - `hourly_limit` (default: ~10/hour for Gmail)
  - `min_gap_seconds` (minimum time between sends from this mailbox, default: 180s)
- Indexes: `(mailbox_id, date)` for fast lookups
- **Note**: Domain and tenant throttles skipped for now. Gmail limits are per-mailbox (not per-domain), and tenant limits only needed if you have pricing tiers/usage-based billing.

### 1.6 Add Campaign Schedule
**Purpose**: Define when campaigns are active (when emails can be sent)

**Tasks**:
- Add `schedule` JSONB column to `campaigns` table:
  - Structure: `{timezone: string, start_hour: number, end_hour: number, days_of_week: number[] | null}`
  - Default: `null` (campaign runs 24/7)
  - Examples:
    - Business hours: `{timezone: "America/New_York", start_hour: 9, end_hour: 17, days_of_week: [1,2,3,4,5]}`
    - 24/7: `null`
    - Weekdays only: `{timezone: "UTC", start_hour: 0, end_hour: 24, days_of_week: [1,2,3,4,5]}`
- Add index if needed: `(schedule)` for querying campaigns with schedules
- Migration: Set all existing campaigns to `null` (24/7, no restrictions)

---

## Phase 2: AWS Infrastructure Setup

### 2.1 SQS Queues
**Purpose**: Decouple scheduling from execution, buffer spikes

**Tasks**:
- Create `send_queue` (Standard queue - order not critical, need throughput)
  - Visibility timeout: 5 minutes
  - Message retention: 14 days
  - Dead Letter Queue (DLQ) with max receive count: 3
  - Configure queue policies for ECS task roles

**Note**: We are starting simple and only using `send_queue`. `event_queue` and `inbox_queue` are skipped for now (see QUEUE_DECISION_ANALYSIS.md for rationale). Events are processed synchronously, and inbox checking uses scheduled tasks instead.

### 2.2 CloudWatch Scheduler + Lambda
**Purpose**: Periodic scheduler tick to evaluate flows

**Tasks**:
- Create CloudWatch Event Rule (every 30-60 seconds)
- Create `scheduler-lambda` function:
  - Query Supabase for `enrollments` where `next_run_at <= NOW()` and `state = 'active'`
  - For each enrollment:
    - Load flow graph from `campaigns.flow_data` or `nodes` table
    - Evaluate current position, find next node(s)
    - Apply campaign schedule, jitter, pacing rules
    - Create `message_jobs` for send actions
    - Update `enrollment.next_run_at` for wait/branch nodes
    - Push `message_job_id` to `send_queue`
  - Handle errors, retries, logging
- Set Lambda timeout (5-15 minutes depending on batch size)
- Configure IAM role with Supabase and SQS permissions

### 2.3 ECS Fargate Cluster & Services
**Purpose**: Scalable worker services

**Tasks**:
- Create ECS Cluster (Fargate)
- Create `send-workers` service:
  - Task definition: Docker image with send worker code
  - Desired count: Start with 2-5, auto-scaling based on queue depth
  - Environment variables: Supabase URL/key, SQS queue URL, AWS region
  - IAM role: SQS read, Supabase access, CloudWatch logs
  - Health checks, logging configuration
- **Note**: No `inbox-workers` or `event-workers` ECS services needed. Inbox checking uses scheduled tasks (Phase 2.5), and events are processed synchronously (Phase 3.5).

### 2.6 Docker Images
**Purpose**: Containerized worker applications

**Tasks**:
- Create `send-worker` Dockerfile:
  - Base: Node.js or Python
  - Install dependencies:
    - SMTP client library (e.g., `nodemailer` for Node.js, `smtplib` for Python)
    - MIME encoding library
    - Supabase client
    - AWS SDK (SQS, Secrets Manager if using)
  - Entrypoint: Long-running process that polls SQS `send_queue`
- Build and push to ECR (Elastic Container Registry)
- Set up CI/CD for image builds
- **Note**: No `inbox-worker` Docker image needed - inbox checking uses Lambda or scheduled ECS task

### 2.4 Inbox Checker (Scheduled Task)
**Purpose**: Periodically check mailboxes for replies/bounces

**Tasks**:
- Create CloudWatch Event Rule (every 5 minutes)
- Create Lambda function (or ECS Scheduled Task):
  - Query Supabase: `SELECT * FROM mailboxes WHERE sync_enabled = true AND status = 'active'`
  - For each mailbox:
    - Connect via IMAP
    - Check for new messages since `last_synced_at`
    - Process replies/bounces (see Phase 3.4)
    - Update `last_synced_at`
  - Handle errors, logging
- Configure IAM role with Supabase and IMAP access
- **Note**: Using scheduled tasks instead of `inbox_queue` for simplicity (see QUEUE_DECISION_ANALYSIS.md)

### 2.5 API Gateway / Lambda Functions (Optional)
**Purpose**: Tracking endpoints for opens/clicks

**Tasks**:
- Create Lambda@Edge or API Gateway + Lambda:
  - `/o/:message_job_id.png` - Open pixel
  - `/c/:link_id` - Click redirect
- Functions write to `events` table directly (synchronous, no queue)
- CloudFront distribution (if using Lambda@Edge)

---

## Phase 3: Core Application Logic

### 3.1 Flow Evaluation Engine
**Purpose**: Turn flow graphs into concrete jobs

**Tasks**:
- Implement flow traversal logic:
  - Load flow from `campaigns.flow_data` or `nodes` + edges
  - Traverse edges from current node
  - Handle branching (AICategorizer nodes)
  - Handle conditional logic (IF nodes)
- Implement scheduling logic:
  - Calculate `next_run_at` based on:
    - WaitTime node delays
    - Campaign schedule (when campaign is active/running)
    - Jitter (randomized delays)
    - Per-tenant pacing rules
- Update `schedule_next_node_job()` function in Supabase
- Unit tests for flow traversal edge cases

### 3.2 Send Worker Implementation
**Purpose**: Execute message jobs with pacing

**Tasks**:
- Worker main loop:
  - Poll `send_queue` (long polling)
  - For each message:
    1. Load `message_job` + related data from Supabase
    2. **Reserve job atomically**:
       - Check mailbox throttle (daily/hourly/min-gap limits)
       - Update `message_jobs.status = 'reserved'` with `reserved_at`
       - Update mailbox throttle counters (increment sent_count, update last_sent_at)
       - If throttle limit reached, mark job for retry/reschedule
    3. Generate MIME message:
       - Load template from `nodes.node_data`
       - Merge lead data
       - Plain-text + minimal HTML
       - Generate unique `Message-ID` header (for reply detection)
    4. Send via SMTP:
       - Get or create SMTP connection from connection pool
       - Authenticate using `mailboxes.smtp_username` and `smtp_password` (decrypted)
       - Send MIME message via SMTP protocol:
         - `MAIL FROM: <mailbox_email>`
         - `RCPT TO: <lead_email>`
         - `DATA` (MIME message)
       - Handle SMTP error codes:
         - `4xx` (temporary) → retry with exponential backoff
         - `5xx` (permanent) → mark as failed
         - Connection errors → reconnect, retry
       - Extract `Message-ID` from response or use generated one
    5. Update Supabase:
       - `message_jobs.status = 'sent'`
       - Store `provider_message_id` (Message-ID header), `sent_at`
       - Optionally update campaign stats (increment sent_count) - synchronous
    6. Write to `events` table (synchronous):
       - `{event_type: 'sent', message_job_id, campaign_id, lead_id, ...}`
- Error handling:
  - Temporary failures → retry with exponential backoff
  - Permanent failures → mark as failed, write event to `events` table
- Implement atomic reservation function in Supabase (PL/pgSQL)
- **Note**: Events are processed synchronously (no `event_queue`). See QUEUE_DECISION_ANALYSIS.md

### 3.3 SMTP Integration & Connection Management
**Purpose**: Send emails via SMTP with proper connection pooling and error handling

**Tasks**:
- Implement SMTP connection pool manager:
  - Per-mailbox connection pools (respect `smtp_connection_limit`)
  - Connection reuse (up to `smtp_messages_per_connection` messages per connection)
  - Connection health checks (ping before use)
  - Automatic reconnection on errors
  - Connection lifecycle management (close idle connections)
- Implement SMTP send function:
  - Create/retrieve connection from pool
  - Authenticate using credentials from `mailboxes` table
  - Send MIME message via SMTP protocol
  - Extract `Message-ID` from response or generate unique one
  - Return `Message-ID` for tracking
- Implement SMTP error code classification:
  - **4xx (Temporary failures)** → retry with exponential backoff:
    - `421` (service unavailable) → retry
    - `450` (mailbox unavailable) → retry
    - `451` (local error) → retry
  - **5xx (Permanent failures)** → mark as failed:
    - `550` (mailbox not found) → permanent failure
    - `551` (user not local) → permanent failure
    - `552` (exceeded storage) → permanent failure
    - `553` (mailbox name not allowed) → permanent failure
  - **Connection errors** → reconnect and retry (up to max retries)
- Handle provider-specific rate limits:
  - Track connection rate per mailbox
  - Implement backoff on `421` (too many connections) errors
  - Respect `smtp_connection_limit` per mailbox
- Credential security:
  - Decrypt `smtp_password` from database (use Supabase Vault or AWS Secrets Manager)
  - Never log credentials
  - Rotate credentials if provider supports it
- Update mailbox status:
  - On consecutive failures → mark `smtp_status = 'error'`
  - On rate limit → mark `smtp_status = 'throttled'`
  - On success → reset `smtp_error_count`

### 3.4 Inbox Checker Implementation
**Purpose**: Detect replies, bounces, unsubscribes via IMAP (scheduled task)

**Tasks**:
- Scheduled task (CloudWatch → Lambda or ECS Scheduled Task):
  - Runs every 5 minutes
  - Query Supabase: `SELECT * FROM mailboxes WHERE sync_enabled = true AND status = 'active'`
  - For each mailbox:
    1. Connect via IMAP using `mailboxes.imap_*` credentials
    2. Query for recent messages (since `last_synced_at`)
    3. For each message:
       - Parse headers: `In-Reply-To`, `References`, `Message-ID`
       - Check if it's a reply:
         - `In-Reply-To` header matches a `message_job.provider_message_id`
         - Or `References` header contains our `Message-ID`
       - Check if it's a bounce:
         - Subject patterns: "Undelivered", "Delivery Status", "Mail Delivery Failed"
         - Body patterns: "550", "551", "552", "553" SMTP codes
         - From address: "MAILER-DAEMON", "postmaster"
       - Check if it's an unsubscribe:
         - `List-Unsubscribe` header present
         - Subject/body contains "unsubscribe"
    4. For replies:
       - Find `message_job` by matching `provider_message_id` with `In-Reply-To` or `References`
       - Update `enrollment.state = 'stopped'` (synchronous)
       - Write to `events` table: `{event_type: 'replied', message_job_id, enrollment_id, ...}`
    5. For bounces:
       - Extract recipient email from bounce message
       - Find corresponding `lead` and mark as suppressed
       - Update `enrollment.state = 'stopped'` (synchronous)
       - Write to `events` table: `{event_type: 'bounced', message_job_id, enrollment_id, ...}`
    6. Update `mailboxes.last_synced_at`
- Error handling:
  - IMAP connection failures → log error, continue to next mailbox (retry on next scheduled run)
  - Authentication errors → mark mailbox as error, notify user, continue
  - Rate limits → log, continue (retry on next run)
- Optimizations:
  - Process mailboxes in parallel (if using ECS, can run multiple tasks)
  - Cache `Message-ID` lookups for faster reply detection
  - Consider IMAP IDLE (push notifications) later if needed
- **Note**: Using scheduled tasks instead of `inbox_queue` for simplicity. See QUEUE_DECISION_ANALYSIS.md

### 3.5 Event Processing (Synchronous)
**Purpose**: Handle events inline (no queue - see QUEUE_DECISION_ANALYSIS.md)

**Tasks**:
- Events are processed synchronously when they occur:
  1. **Send Worker** (Phase 3.2):
     - After sending email → Write to `events` table
     - Optionally update campaign stats (increment sent_count)
  2. **Inbox Checker** (Phase 3.4):
     - When reply detected → Update `enrollment.state = 'stopped'` immediately
     - Write to `events` table
  3. **Tracking Endpoints** (Phase 2.5):
     - When open/click detected → Write to `events` table directly
- Analytics aggregation:
  - Can be computed from `events` table (SQL queries)
  - Or updated incrementally during event writes (simpler, good for real-time stats)
- **Note**: No separate event processor needed. Events are handled synchronously where they occur. Add `event_queue` later if needed (> 10k emails/sec).

---

## Phase 4: Pacing & Throttling

### 4.1 Atomic Reservation Function
**Purpose**: Prevent race conditions when multiple workers reserve jobs

**Tasks**:
- Create Supabase function `reserve_message_job()`:
  ```sql
  -- Pseudocode:
  -- 1. SELECT FOR UPDATE message_job (lock it)
  -- 2. Check mailbox throttle:
  --    - Query mailbox_throttles for mailbox_id + today's date
  --    - Check: sent_count < daily_limit
  --    - Check: hourly_sent[hour] < hourly_limit
  --    - Check: NOW() - last_sent_at >= min_gap_seconds
  -- 3. If all checks pass:
  --    - Update message_job.status = 'reserved'
  --    - Update mailbox_throttles: increment sent_count, update hourly_sent, set last_sent_at
  --    - Return success
  -- 4. If any check fails:
  --    - Return failure reason (which limit was hit)
  --    - Optionally calculate next available time and reschedule job
  ```
- Handle concurrent access with row-level locking (SELECT FOR UPDATE)
- Return detailed failure reasons for logging (daily_limit_hit, hourly_limit_hit, min_gap_not_met)

### 4.2 Jitter & Randomization
**Purpose**: Avoid pattern fingerprints

**Tasks**:
- Implement per-tenant jitter seeds
- Randomize send spacing:
  - Base delay + random jitter (e.g., 30s ± 10s)
  - Per-mailbox min-gap + jitter
  - Avoid synchronized "top of hour" flushes
- Implement in scheduler Lambda (when calculating `next_run_at`)
- Store jitter configuration per account/tenant

### 4.3 Campaign Schedule
**Purpose**: Define when campaigns are active (when emails can be sent)

**Tasks**:
- Add `schedule` JSONB column to `campaigns` table:
  - `timezone` (e.g., "America/New_York")
  - `start_hour` (0-23, hour of day when campaign starts)
  - `end_hour` (0-23, hour of day when campaign ends, can be >= 24 for next day)
  - `days_of_week` (array of 0-6, where 0=Sunday, 6=Saturday, null = all days)
  - Example: `{timezone: "America/New_York", start_hour: 9, end_hour: 17, days_of_week: [1,2,3,4,5]}`
  - Default: `null` (campaign runs 24/7, no restrictions)
- Implement schedule checking in scheduler:
  - When calculating `next_run_at` for email nodes, check if campaign schedule allows sending
  - If outside schedule, calculate next allowed time within schedule
  - Handle timezone conversions (convert campaign schedule timezone to UTC)
  - Handle day-of-week restrictions (skip weekends if configured)
- UI/API: Allow users to configure campaign schedule (common patterns: 24/7, business hours, weekdays only, etc.)

---

## Phase 5: Monitoring & Observability

### 5.1 CloudWatch Metrics
**Purpose**: Track system health

**Tasks**:
- Custom metrics:
  - `MessageJobsCreated` (scheduler)
  - `MessageJobsSent` (send workers)
  - `MessageJobsFailed` (send workers)
  - `QueueDepth` (SQS)
  - `WorkerCount` (ECS)
  - `ThrottleHits` (per mailbox/domain/tenant)
- Set up CloudWatch dashboards
- Configure alarms:
  - High queue depth
  - High error rate
  - Worker failures

### 5.2 Logging
**Purpose**: Debug issues, audit trail

**Tasks**:
- Structured logging:
  - JSON format
  - Include: `message_job_id`, `enrollment_id`, `campaign_id`, `mailbox_id`
  - Log levels: DEBUG, INFO, WARN, ERROR
- CloudWatch Logs:
  - Lambda functions (automatic)
  - ECS tasks (configure log drivers)
- Log aggregation and search

### 5.3 Error Tracking
**Purpose**: Alert on critical failures

**Tasks**:
- Integrate error tracking (Sentry, CloudWatch Insights)
- Alert on:
  - SMTP connection failures (high rate)
  - SMTP 5xx errors (permanent failures)
  - IMAP sync failures
  - High failure rate
  - Worker crashes
  - Database connection issues
  - Throttle violations

---

## Phase 6: Testing & Validation

### 6.1 Unit Tests
**Tasks**:
- Flow evaluation logic
- Throttle reservation logic
- SMTP integration (mocked SMTP server)
- SMTP error code classification
- Connection pooling logic
- Event processing logic

### 6.2 Integration Tests
**Tasks**:
- End-to-end flow: enrollment → job creation → send → event
- Throttle enforcement
- Error handling and retries
- Concurrent worker behavior

### 6.3 Load Testing
**Tasks**:
- Simulate high enrollment volume
- Test queue scaling
- Test worker auto-scaling
- Validate throttle enforcement under load

---

## Phase 7: Migration & Rollout

### 7.1 Data Migration
**Tasks**:
- Delete `lead_states` table (app not in production use, no data to migrate)
- Update `scheduled_jobs` table if it exists to remove `lead_state_id` FK (or delete if not needed)
- Verify mailbox SMTP credentials are encrypted
- Test SMTP connectivity for all mailboxes

### 7.2 Gradual Rollout
**Tasks**:
- Start with test campaigns
- Monitor metrics closely
- Gradually increase traffic
- Rollback plan if issues arise

### 7.3 Documentation
**Tasks**:
- Architecture diagrams
- Runbooks for common operations
- Troubleshooting guides
- API documentation (if exposing APIs)

---

## Implementation Order (Recommended)

1. **Phase 1**: Database schema evolution (foundation)
2. **Phase 2.1-2.2**: SQS send_queue + Scheduler Lambda (core infrastructure)
3. **Phase 3.1**: Flow evaluation engine (scheduling logic)
4. **Phase 3.3**: SMTP integration (connection pooling, error handling)
5. **Phase 2.3, 2.6**: ECS + Docker images (execution plane)
6. **Phase 3.2**: Send worker implementation (execution)
7. **Phase 4**: Pacing & throttling (safety)
8. **Phase 2.4, 3.4**: Inbox checker (scheduled task, IMAP reply detection)
9. **Phase 3.5**: Event processing (synchronous, inline)
10. **Phase 5**: Monitoring (observability)
11. **Phase 6-7**: Testing & rollout (validation)

---

## Key Decisions & Considerations

### Schema Mapping
- **`lead_states` → `enrollments`**: Replaced entirely. `enrollments` is simpler (one per lead, not per node) and handles scheduling via `next_run_at`
- **`scheduled_jobs` → `message_jobs`**: `message_jobs` handles email sends. `scheduled_jobs` may be deleted if not needed, as `enrollments.next_run_at` handles scheduling

### SMTP AUTH Strategy
- **Decision**: Use SMTP AUTH to Gmail-hosted mailboxes
- **Rationale**: 
  - Gmail still owns SMTP reputation (no IP warmup needed)
  - Works with Gmail, Google Workspace, and Gmail-backed providers
  - Simpler credential management (username/password vs OAuth tokens)
  - Same deliverability as Gmail API (authentication method doesn't affect trust)
- **Key Points**:
  - Provider must be Gmail-hosted (verify via SMTP hostname at connection time)
  - System controls pacing, jitter, and behavior patterns
  - SMTP connection pooling required for efficiency
  - Proper SMTP error code classification critical (4xx vs 5xx)

### Queue Strategy
- **send_queue**: Standard queue (order not critical, need throughput) - **Required**
- **event_queue**: Skipped - events processed synchronously (see QUEUE_DECISION_ANALYSIS.md)
- **inbox_queue**: Skipped - inbox checking uses scheduled tasks (see QUEUE_DECISION_ANALYSIS.md)
- **Consider FIFO**: Only if strict ordering required (usually not needed)

### Scaling Strategy
- **Scheduler Lambda**: Single instance (CloudWatch rule)
- **Send Workers**: Auto-scale based on `send_queue` depth (target: ~70% queue utilization)
- **Inbox Workers**: Low count (1-2), scale based on mailbox count

### Error Handling
- **SMTP 4xx (Temporary)**: Retry with exponential backoff (max 3 retries)
  - Examples: `421` (service unavailable), `450` (mailbox unavailable), `451` (local error)
- **SMTP 5xx (Permanent)**: Mark as failed, emit event, alert
  - Examples: `550` (mailbox not found), `551` (user not local), `552` (storage exceeded)
- **Connection errors**: Reconnect and retry (up to max retries)
- **Rate limits**: Backoff on `421` (too many connections), reschedule job, update throttle
- **IMAP errors**: Retry with backoff, mark mailbox as error if persistent

### SMTP-Specific Considerations

#### Connection Management
- **Connection Limits**: Some providers limit concurrent SMTP connections per mailbox
  - Implement per-mailbox connection pools with configurable limits
  - Monitor connection count and back off if limit approached
  - Reuse connections for multiple messages (up to `smtp_messages_per_connection`)
- **Connection Health**: 
  - Ping connections before use (NOOP command)
  - Close idle connections after timeout
  - Reconnect on errors automatically

#### Error Code Classification
- **Critical**: Correctly classify 4xx vs 5xx errors
  - 4xx = temporary → retry
  - 5xx = permanent → fail immediately
- **Vague Errors**: Some SMTP servers return generic errors
  - Log full SMTP response for debugging
  - Implement provider-specific error handling if needed

#### Credential Security
- **Encryption**: Store `smtp_password` encrypted at rest
  - Use Supabase Vault or AWS Secrets Manager
  - Decrypt only in memory during send operations
- **Rotation**: Support credential rotation if provider allows
  - Update credentials without downtime
  - Test new credentials before marking active

#### Metadata Limitations
- **Message-ID**: SMTP only provides Message-ID header (not thread IDs like Gmail API)
  - Generate unique Message-ID for each sent message
  - Store Message-ID in `message_jobs.provider_message_id`
  - Use Message-ID for reply detection (In-Reply-To header matching)
- **Tracking**: Less metadata than Gmail API, but sufficient for:
  - Reply detection (In-Reply-To header)
  - Bounce detection (subject/body patterns)
  - Basic delivery tracking

#### Provider Verification
- **Gmail-Backed Confirmation**: Verify provider is truly Gmail-hosted
  - Check SMTP server hostname at connection time (should be Gmail/Google domain)
  - Validate during mailbox setup/connection test
  - Only use Gmail-backed mailboxes for this architecture
- **Provider-Specific Behavior**: Some Gmail resellers may have:
  - Different rate limits
  - Different connection limits
  - Different error messages
  - Document and handle provider-specific quirks

---

## Dependencies

- AWS Account with appropriate permissions
- Gmail-hosted mailboxes with SMTP/IMAP credentials
- Supabase project with Postgres
- Docker for container builds
- CI/CD pipeline (GitHub Actions, etc.)
- SMTP/IMAP client libraries (e.g., `nodemailer` for Node.js, `smtplib`/`imaplib` for Python)
- AWS Secrets Manager or Supabase Vault (for credential encryption)

---

## Estimated Timeline

- **Phase 1**: 1-2 weeks
- **Phase 2**: 2-3 weeks
- **Phase 3**: 3-4 weeks
- **Phase 4**: 1-2 weeks
- **Phase 5**: 1 week
- **Phase 6**: 1-2 weeks
- **Phase 7**: 1 week

**Total**: ~10-15 weeks (depending on team size and complexity)

---

## Next Steps

1. Review and refine this plan with the team
2. Prioritize phases based on business needs
3. Set up development/staging environments
4. Begin Phase 1 implementation
5. Set up regular review checkpoints

