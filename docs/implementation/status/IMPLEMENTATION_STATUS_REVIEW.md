# Implementation Plan Status Review

**Date**: January 21, 2026  
**Status**: ⚠️ **OUTDATED** - See `COMPLETION_PLAN.md` for current status  
**Note**: This document reflects status before Phase 1.1 completion. Phase 1.1 (Atomic Job Reservation) is now complete.  
**Review Scope**: Complete implementation plan for sending infrastructure  
**Reviewer**: Auto (AI Assistant)  
**Based On**: Codebase analysis, migration files, and implementation documentation

---

## Executive Summary

The implementation has made **significant progress** across all phases, with most core infrastructure and logic implemented. The system has evolved from the original SQS-based approach to a **database polling architecture**, which simplifies operations and reduces costs. Key achievements include:

- ✅ **Phase 1 (Database Schema)**: **100% Complete** - All tables, indexes, and functions created
- ✅ **Phase 2 (AWS Infrastructure)**: **~90% Complete** - ECS workers deployed, database polling implemented
- ⚠️ **Phase 3 (Core Logic)**: **~85% Complete** - Flow evaluation, send workers, SMTP integration done
- ⚠️ **Phase 4 (Pacing & Throttling)**: **~60% Complete** - Basic throttling done, atomic reservation pending
- ❌ **Phase 5 (Monitoring)**: **~20% Complete** - Basic logging exists, metrics/alarms pending
- ❌ **Phase 6-7 (Testing & Rollout)**: **Not Started**

**Critical Gaps**:
1. Atomic job reservation with throttle checking (Phase 4.1)
2. Full IMAP inbox checker implementation (Phase 3.4)
3. CloudWatch metrics and alarms (Phase 5)
4. Comprehensive testing (Phase 6)

---

## Phase 1: Database Schema Evolution ✅ **COMPLETE**

### 1.0 Cleanup Existing Tables ✅ **DONE**
- ✅ `lead_states` table dropped (migration: `20251227225920_phase1_cleanup_and_new_schema.sql`)
- ✅ `scheduled_jobs` table dropped
- ✅ All triggers/functions referencing old tables removed

### 1.1 Create Enrollments Table ✅ **DONE**
- ✅ `enrollments` table created with all required fields
- ✅ Indexes created: `(next_run_at, state)` WHERE `state = 'active'`
- ✅ Unique constraint: `(campaign_id, lead_id)`

### 1.2 Create Message Jobs Table ✅ **DONE**
- ✅ `message_jobs` table created with all required fields
- ✅ Status tracking: 'pending', 'reserved', 'sending', 'sent', 'failed', 'cancelled'
- ✅ Indexes created for efficient polling
- ✅ **Note**: Uses database polling (no SQS message ID needed)

### 1.3 Enhance Mailboxes for SMTP Operations ✅ **DONE**
- ✅ SMTP columns verified: `smtp_host`, `smtp_port`, `smtp_username`, `smtp_password`
- ✅ `smtp_status` column added ('active', 'throttled', 'error', 'disabled')
- ✅ `smtp_connection_limit` column added (default: 5)
- ✅ `smtp_messages_per_connection` column added (default: 100)
- ✅ `smtp_last_connected_at` column added (for health tracking)
- ✅ `smtp_error_count` column added (track consecutive failures)
- ✅ `provider` column added (flexible provider name)
- **Status**: **All fields exist in schema**

### 1.4 Create Events Table ✅ **DONE**
- ✅ `events` table created with all required fields
- ✅ Event types: 'sent', 'delivered', 'opened', 'clicked', 'replied', 'bounced', 'unsubscribed'
- ✅ Indexes created for efficient querying

### 1.5 Create Mailbox Throttle Table ✅ **DONE**
- ✅ `mailbox_throttles` table created
- ✅ Fields: `sent_count`, `last_sent_at`, `min_gap_seconds`
- ✅ `hourly_sent` JSONB field exists (tracks hourly counts)
- ✅ `daily_limit` field exists (default: 50)
- ✅ `hourly_limit` field exists (default: 10)
- ⚠️ **Note**: Fields exist in schema, but hourly/daily limits are **not enforced in send worker code** (only `min_gap_seconds` is checked)
- **Impact**: Schema supports hourly/daily limits, but enforcement logic not implemented

### 1.6 Add Campaign Schedule ✅ **DONE**
- ✅ `schedule` JSONB column added to `campaigns` table
- ✅ Structure: `{timezone, start_hour, end_hour, days_of_week}`
- ✅ Default: `null` (24/7)

### 1.7 Create Email Threads and Messages Tables ✅ **DONE**
- ✅ `email_threads` table created with all required fields
- ✅ `email_messages` table created with all required fields
- ✅ Indexes created for efficient inbox queries
- ✅ `has_reply` flag for efficient filtering

**Additional Schema (Beyond Plan)**:
- ✅ `campaign_intervals` table (for interval-based scheduling)
- ✅ `campaign_mailboxes` table (for mailbox-to-campaign associations)
- ✅ `claim_enrollments_ready()` RPC function (atomic enrollment claiming)
- ✅ `claim_message_jobs_ready()` RPC function (atomic job claiming)
- ✅ `account_id` added to `campaigns` table
- ✅ `jitter_percentage` added to `accounts` and `campaigns` tables

---

## Phase 2: AWS Infrastructure Setup ⚠️ **~90% COMPLETE**

### 2.1 SQS Queues ❌ **NOT NEEDED** (Architecture Changed)
- ❌ **Original Plan**: Create `send_queue` SQS queue
- ✅ **Actual**: Database polling approach implemented instead
- ✅ `claim_message_jobs_ready()` RPC function replaces SQS queue
- **Status**: **Intentional change** - database polling is simpler and cheaper

### 2.2 Scheduler Workers (ECS Fargate) ✅ **DONE**
- ✅ ECS service created (`scheduler-worker`)
- ✅ Docker image built and pushed to ECR
- ✅ Continuous polling implemented (not scheduled Lambda)
- ✅ Uses `claim_enrollments_ready()` RPC function (atomic claiming)
- ✅ Auto-scaling configured (based on enrollment count)
- ✅ Environment variables: Supabase URL/key, AWS region
- ✅ IAM role: Supabase access, CloudWatch logs
- **Status**: **Fully operational**

### 2.3 ECS Fargate Cluster & Services ✅ **DONE**
- ✅ ECS Cluster created (`furnace-cluster-dev`, `furnace-cluster-prod`)
- ✅ `send-workers` service created and deployed
- ✅ `scheduler-workers` service created and deployed
- ✅ Both services use database polling (no SQS)
- ✅ Auto-scaling configured for both services
- ✅ Health checks and logging configured
- ✅ **Infrastructure extracted from Amplify** to separate CDK project (`infra/workers/`)

### 2.4 Inbox Checker (Scheduled Task) ⚠️ **PARTIAL**
- ✅ Lambda function exists (`inboxChecker`)
- ✅ CloudWatch Event Rule configured (every 5 minutes)
- ⚠️ **Missing**: Full IMAP reply detection logic (see Phase 3.4)
- ⚠️ **Missing**: Email thread/message creation from IMAP
- **Status**: Infrastructure ready, logic incomplete

### 2.5 API Gateway / Lambda Functions (Optional) ❌ **NOT STARTED**
- ❌ Open pixel endpoint (`/o/:message_job_id.png`)
- ❌ Click redirect endpoint (`/c/:link_id`)
- **Status**: Not critical for MVP, can be added later

### 2.6 Docker Images ✅ **DONE**
- ✅ `send-worker` Dockerfile created
- ✅ `scheduler-worker` Dockerfile created
- ✅ Both images built and pushed to ECR
- ✅ CI/CD scripts created (`push-to-ecr.sh`, `build-and-push.sh`)
- ✅ Dependencies: SMTP client (`nodemailer`), Supabase client, AWS SDK

---

## Phase 3: Core Application Logic ⚠️ **~85% COMPLETE**

### 3.1 Flow Evaluation Engine ✅ **DONE**
- ✅ Migrated from Lambda to ECS workers
- ✅ Flow traversal logic implemented
- ✅ Handles entry point (null `current_node_id`)
- ✅ Handles branching (AICategorizer nodes)
- ✅ Handles flow completion (no next nodes)
- ✅ Campaign schedule enforcement
- ✅ Jitter implementation (account/campaign level)
- ✅ WaitTime node scheduling
- ✅ Mailbox selection and load balancing (round-robin)
- ✅ Account-to-mailbox relationship resolution
- **Status**: **Fully functional**

**Additional Features (Beyond Plan)**:
- ✅ Campaign intervals system (interval-based scheduling)
- ✅ Batch interval assignment process
- ✅ Stale lock cleanup
- ✅ Processed interval checking

### 3.2 Send Worker Implementation ✅ **DONE**
- ✅ Worker main loop: Polls database using `claim_message_jobs_ready()`
- ✅ Atomic claiming: `FOR UPDATE SKIP LOCKED` prevents duplicates
- ✅ Batch processing: 50-100 jobs per poll
- ✅ Adaptive polling: 1-2s when jobs found, 5-30s when idle
- ✅ Job processing: Loads job data, generates MIME, sends via SMTP
- ✅ Error handling: Temporary vs permanent failures
- ✅ Event creation: Writes to `events` table synchronously
- ✅ Enrollment update: Triggers scheduler re-evaluation after send
- ⚠️ **Missing**: Atomic reservation with throttle checking (see Phase 4.1)
- ⚠️ **Missing**: Email thread/message creation (see Phase 3.2 step 6)
- **Status**: **Core functionality complete**, enhancements pending

### 3.3 SMTP Integration & Connection Management ⚠️ **PARTIAL**
- ✅ SMTP send function implemented (`sendEmail()`)
- ✅ MIME message generation
- ✅ SMTP error code classification (4xx vs 5xx)
- ✅ Connection error handling (reconnect, retry)
- ✅ Nodemailer connection pooling configured (`pool: true`, `maxConnections`, `maxMessages`)
- ⚠️ **Issue**: New transporter created per email (not reused across sends)
- ⚠️ **Impact**: Nodemailer pooling exists per-transporter, but transporters aren't shared, so connection reuse limited
- ⚠️ **Missing**: Application-level connection pool manager (shared transporters per mailbox)
- ⚠️ **Missing**: Connection health checks (ping before use)
- ⚠️ **Missing**: Connection lifecycle management (close idle connections)
- ⚠️ **Missing**: Provider-specific rate limit handling
- ⚠️ **Missing**: Credential decryption (currently assumes plaintext or Supabase Vault)
- **Status**: **Basic SMTP works**, connection pooling exists but not optimally utilized (new transporter per email)

### 3.4 Inbox Checker Implementation ❌ **NOT STARTED**
- ❌ Full IMAP reply detection logic
- ❌ Email thread creation from IMAP messages
- ❌ Email message storage (full content)
- ❌ Bounce detection (subject/body patterns)
- ❌ Unsubscribe detection
- ❌ Enrollment state updates on reply/bounce
- **Status**: **Infrastructure exists (Lambda), logic not implemented**

### 3.5 Event Processing (Synchronous) ✅ **DONE**
- ✅ Events processed synchronously when they occur
- ✅ Send worker writes to `events` table after sending
- ✅ Campaign stats can be computed from `events` table
- **Status**: **Fully functional**

---

## Phase 4: Pacing & Throttling ⚠️ **~60% COMPLETE**

### 4.1 Atomic Reservation Function ⚠️ **PARTIAL**
- ✅ `claim_message_jobs_ready()` RPC function created (atomic claiming)
- ✅ `claim_enrollments_ready()` RPC function created (atomic claiming)
- ⚠️ **Missing**: `reserve_message_job()` function (atomic throttle checking)
- ⚠️ **Missing**: Row-level locking for throttle updates
- ⚠️ **Missing**: Detailed failure reasons (daily_limit_hit, hourly_limit_hit, min_gap_not_met)
- **Current State**: Send worker checks throttle manually (not atomic), can have race conditions
- **Impact**: Multiple workers could send from same mailbox simultaneously if throttle check happens at same time

### 4.2 Jitter & Randomization ✅ **DONE**
- ✅ Per-account jitter configuration (`accounts.jitter_percentage`)
- ✅ Per-campaign jitter override (`campaigns.jitter_percentage`)
- ✅ Jitter applied to send spacing
- ✅ Randomization in scheduler workers
- **Status**: **Fully functional**

### 4.3 Campaign Schedule ✅ **DONE**
- ✅ `schedule` JSONB column in `campaigns` table
- ✅ Schedule checking in scheduler workers
- ✅ Timezone conversions handled
- ✅ Day-of-week restrictions handled
- ✅ Next allowed time calculation
- **Status**: **Fully functional**

**Additional Throttling (Beyond Plan)**:
- ✅ Minimum gap enforcement (`min_gap_seconds`) - implemented in send worker
- ✅ `mailbox_throttles` table tracking
- ⚠️ **Missing**: Hourly/daily limit enforcement (database-level)

---

## Phase 5: Monitoring & Observability ❌ **~20% COMPLETE**

### 5.1 CloudWatch Metrics ❌ **NOT STARTED**
- ❌ Custom metrics: `MessageJobsCreated`, `MessageJobsSent`, `MessageJobsFailed`
- ❌ Custom metrics: `WorkerCount`, `ThrottleHits`
- ❌ CloudWatch dashboards
- ❌ Alarms: High queue depth, high error rate, worker failures
- **Status**: **Basic logging exists, metrics not published**

### 5.2 Logging ✅ **PARTIAL**
- ✅ Structured logging: JSON format (via console.log)
- ✅ CloudWatch Logs: ECS tasks configured
- ✅ Log levels: DEBUG, INFO, WARN, ERROR
- ⚠️ **Missing**: Log aggregation and search (CloudWatch Insights)
- **Status**: **Basic logging works**, aggregation pending

### 5.3 Error Tracking ❌ **NOT STARTED**
- ❌ Error tracking integration (Sentry, CloudWatch Insights)
- ❌ Alerts on critical failures
- ❌ Error categorization (critical vs recoverable)
- **Status**: **Errors logged to CloudWatch**, no alerting

---

## Phase 6: Testing & Validation ❌ **NOT STARTED**

### 6.1 Unit Tests ❌ **NOT STARTED**
- ❌ Flow evaluation logic tests
- ❌ Throttle reservation logic tests
- ❌ SMTP integration tests (mocked)
- ❌ Connection pooling tests
- ❌ Event processing tests

### 6.2 Integration Tests ❌ **NOT STARTED**
- ❌ End-to-end flow tests
- ❌ Throttle enforcement tests
- ❌ Error handling and retries tests
- ❌ Concurrent worker behavior tests

### 6.3 Load Testing ❌ **NOT STARTED**
- ❌ High enrollment volume simulation
- ❌ Worker auto-scaling validation
- ❌ Throttle enforcement under load

---

## Phase 7: Migration & Rollout ⚠️ **PARTIAL**

### 7.1 Data Migration ✅ **DONE**
- ✅ `lead_states` table deleted (no data to migrate)
- ✅ `scheduled_jobs` table deleted
- ✅ Mailbox SMTP credentials verified
- **Status**: **Complete** (app not in production)

### 7.2 Gradual Rollout ⚠️ **IN PROGRESS**
- ✅ Test campaigns working
- ⚠️ **Missing**: Metrics monitoring setup
- ⚠️ **Missing**: Rollback plan documented
- **Status**: **Deployed to dev, prod infrastructure ready**

### 7.3 Documentation ⚠️ **PARTIAL**
- ✅ Architecture diagrams (in docs/)
- ✅ Implementation plans (detailed)
- ⚠️ **Missing**: Runbooks for common operations
- ⚠️ **Missing**: Troubleshooting guides
- ⚠️ **Missing**: API documentation (if exposing APIs)

---

## Architecture Changes from Original Plan

### ✅ **Database Polling Instead of SQS**
- **Original**: SQS `send_queue` for message jobs
- **Actual**: Database polling using `claim_message_jobs_ready()` RPC function
- **Benefits**: 
  - No per-request charges ($0 vs $1-5/month)
  - Simpler infrastructure
  - Built-in scheduling (WHERE clause)
  - Consistent with scheduler worker pattern
- **Status**: **Fully implemented and working**

### ✅ **ECS Workers Instead of Lambda Scheduler**
- **Original**: CloudWatch Event Rule → Lambda (every 30-60 seconds)
- **Actual**: ECS Fargate workers (continuous polling)
- **Benefits**:
  - No timeout limits (Lambda max 15 minutes)
  - Better scaling (auto-scales based on enrollment count)
  - Continuous processing (no 30-60s delays)
  - Parallel processing (multiple workers)
- **Status**: **Fully implemented and working**

### ✅ **Campaign Intervals System** (Beyond Original Plan)
- **New Feature**: Interval-based scheduling for campaigns
- **Purpose**: Ensures consistent spacing between emails in a campaign
- **Implementation**: `campaign_intervals` table, batch assignment process
- **Status**: **Fully implemented**

---

## Critical Gaps & Recommendations

### 🔴 **High Priority**

1. **Atomic Job Reservation with Throttle Checking** (Phase 4.1)
   - **Issue**: Send workers check throttle manually, race conditions possible
   - **Impact**: Multiple workers could send from same mailbox simultaneously
   - **Solution**: Implement `reserve_message_job()` RPC function with atomic throttle checking
   - **Effort**: 4-6 hours

2. **Full IMAP Inbox Checker Implementation** (Phase 3.4)
   - **Issue**: Infrastructure exists but logic not implemented
   - **Impact**: Replies and bounces not detected automatically
   - **Solution**: Implement full IMAP checking, reply detection, thread creation
   - **Effort**: 1-2 days

3. **Connection Pooling for SMTP** (Phase 3.3)
   - **Issue**: New transporter created for each email (nodemailer pooling exists but not shared)
   - **Impact**: Slower sends, more connection overhead, connection reuse limited
   - **Solution**: Implement application-level connection pool manager (shared transporters per mailbox)
   - **Effort**: 1-2 days

### 🟡 **Medium Priority**

4. **CloudWatch Metrics & Alarms** (Phase 5.1)
   - **Issue**: No visibility into system health
   - **Impact**: Can't detect issues proactively
   - **Solution**: Publish custom metrics, create dashboards and alarms
   - **Effort**: 1-2 days

5. **Hourly/Daily Limit Enforcement** (Phase 4.1)
   - **Issue**: Schema fields exist (`hourly_sent`, `daily_limit`, `hourly_limit`) but not enforced in send worker
   - **Impact**: Could exceed provider limits (only `min_gap_seconds` is currently enforced)
   - **Solution**: Add enforcement logic in send worker to check hourly/daily limits before sending
   - **Effort**: 4-6 hours

6. **Email Thread Creation from Send Worker** (Phase 3.2)
   - **Issue**: Threads only created when replies detected
   - **Impact**: Inbox UI won't show sent emails until reply received
   - **Solution**: Create thread/message when email is sent
   - **Effort**: 2-4 hours

### 🟢 **Low Priority**

7. **Unit & Integration Tests** (Phase 6)
   - **Issue**: No automated tests
   - **Impact**: Risk of regressions
   - **Solution**: Add comprehensive test suite
   - **Effort**: 1-2 weeks

8. **Error Tracking Integration** (Phase 5.3)
   - **Issue**: Errors only in CloudWatch logs
   - **Impact**: Hard to track and alert on errors
   - **Solution**: Integrate Sentry or CloudWatch Insights
   - **Effort**: 1 day

9. **Tracking Endpoints** (Phase 2.5)
   - **Issue**: Open/click tracking not implemented
   - **Impact**: Can't track email engagement
   - **Solution**: Create Lambda endpoints for open/click tracking
   - **Effort**: 1-2 days

---

## Summary by Phase

| Phase | Status | Completion | Notes |
|-------|--------|------------|-------|
| **Phase 1: Database Schema** | ✅ Complete | 100% | All tables, indexes, functions created |
| **Phase 2: AWS Infrastructure** | ⚠️ Mostly Complete | 90% | ECS workers deployed, inbox checker logic pending |
| **Phase 3: Core Logic** | ⚠️ Mostly Complete | 85% | Flow evaluation done, SMTP basic, inbox checker pending |
| **Phase 4: Pacing & Throttling** | ⚠️ Partial | 60% | Jitter/schedule done, atomic reservation pending |
| **Phase 5: Monitoring** | ❌ Not Started | 20% | Basic logging only, no metrics/alarms |
| **Phase 6: Testing** | ❌ Not Started | 0% | No automated tests |
| **Phase 7: Rollout** | ⚠️ Partial | 50% | Dev deployed, prod ready, docs incomplete |

**Overall Completion**: **~75%**

---

## Next Steps (Recommended Order)

1. **Implement atomic job reservation** (Phase 4.1) - **Critical for production**
2. **Add connection pooling** (Phase 3.3) - **Performance improvement**
3. **Implement inbox checker logic** (Phase 3.4) - **Feature completeness**
4. **Add CloudWatch metrics** (Phase 5.1) - **Observability**
5. **Create email threads on send** (Phase 3.2) - **UX improvement**
6. **Add unit tests** (Phase 6.1) - **Quality assurance**
7. **Add tracking endpoints** (Phase 2.5) - **Feature enhancement**

---

## Notes

- The system is **functional** for basic email sending workflows
- **Production readiness** requires addressing high-priority gaps (atomic reservation, inbox checker)
- Architecture changes (database polling, ECS workers) are **improvements** over original plan
- Most **core functionality** is implemented and working
- **Testing and monitoring** are the main gaps for production readiness
