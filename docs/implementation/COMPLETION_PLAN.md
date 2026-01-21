# Completion Plan - Sending Infrastructure

**Date**: January 21, 2026
**Based On**: Implementation Status Review  
**Goal**: Complete all remaining work to achieve production readiness

---

## Overview

Current completion: **~75%**  
Target completion: **100%** (production ready)

**Remaining Work**: ~25% across 4 main areas:
1. **Critical Production Gaps** (High Priority) - 3 items
2. **Feature Completeness** (Medium Priority) - 3 items  
3. **Observability** (Medium Priority) - 1 item
4. **Quality Assurance** (Low Priority) - 2 items

**Estimated Total Effort**: 2-3 weeks (depending on team size)

---

## Phase 1: Critical Production Gaps 🔴

**Priority**: Must complete before production  
**Estimated Effort**: 3-4 days  
**Blocks**: Production deployment

### 1.1 Atomic Job Reservation with Throttle Checking

**Status**: ⚠️ Partial - Manual throttle checking, race conditions possible  
**Effort**: 4-6 hours  
**Dependencies**: None  
**Approach**: Option B (Simplified) - Separate throttle check function

**Decision** (January 21, 2026):
- **Problem**: Current throttle checking is non-atomic, allowing race conditions when multiple workers process jobs for the same mailbox
- **Requirements**:
  1. It's acceptable to cancel/fail jobs when throttle is exceeded (no rescheduling needed)
  2. Keep it simple - workers are already simple, claim function should stay simple too
  3. Reduce volume where possible
- **Options Considered**:
  - **Option A**: Add throttle checking to `claim_message_jobs_ready()` function
    - ❌ Makes claim function complex (workers are already simple, no benefit)
    - ✅ Reduces volume (filters at claim time)
  - **Option B**: Create separate `check_mailbox_throttle_and_reserve()` function
    - ✅ Keeps claim function simple (just claims jobs)
    - ✅ Clear separation of concerns
    - ✅ Flexible (can change throttle logic independently)
    - ✅ Atomic throttle checking (no race conditions)
  - **Option C**: Two-phase with intermediate status ('claimed' → 'reserved')
    - ❌ Requires schema changes
    - ❌ More complex state machine
- **Chosen**: **Option B** - Best balance of simplicity, separation of concerns, and flexibility while keeping claim function simple

**Context**: 
- Keep claim function focused (just claims jobs), throttle checking is separate concern
- Failed jobs are cancelled immediately (no rescheduling complexity)

**Tasks**:
1. Create `check_mailbox_throttle_and_reserve()` RPC function in Supabase:
   - Input: `p_message_job_id UUID`
   - Atomic operation: `SELECT FOR UPDATE` on `message_job` and `mailbox_throttles`
   - Check throttle limits:
     - `sent_count < daily_limit`
     - `hourly_sent[current_hour] < hourly_limit`
     - `NOW() - last_sent_at >= min_gap_seconds`
   - If all checks pass:
     - Update `mailbox_throttles`: increment `sent_count`, update `hourly_sent`, set `last_sent_at`
     - Return `success = true`
   - If any check fails:
     - Update `message_jobs.status = 'cancelled'`, set `error_message` (e.g., "Daily throttle limit exceeded")
     - Return `success = false, failure_reason = '...'`
2. **Keep `claim_message_jobs_ready()` unchanged**:
   - Function stays simple (just claims jobs, no throttle logic)
   - No modifications needed
3. Update send worker (`workers/send-worker/src/worker.ts`):
   - Replace manual throttle check (lines 115-155) with call to `check_mailbox_throttle_and_reserve()`
   - Remove throttle update code (lines 202-229) - already done in throttle function
   - Workers: claim → throttle check → send (if throttle passes)
4. Test with multiple workers:
   - Verify no race conditions (multiple workers, same mailbox)
   - Verify throttle limits enforced correctly (daily, hourly, min-gap)
   - Verify failed jobs are cancelled (not sent)
   - Verify workers only receive sendable jobs

**Files to Modify**:
- `supabase/migrations/YYYYMMDDHHMMSS_create_check_mailbox_throttle_and_reserve_function.sql` (new function)
- `workers/send-worker/src/worker.ts` (replace manual throttle check with RPC call)

**Benefits of This Approach**:
- ✅ **Keeps claim function simple**: No throttle logic added to claim function
- ✅ **Clear separation of concerns**: Claim just claims, throttle just checks throttles
- ✅ **Atomic throttle checking**: No race conditions possible
- ✅ **No rescheduling complexity**: Failed jobs just get cancelled
- ✅ **Flexible**: Can change throttle logic without touching claim function

**Success Criteria**:
- ✅ No race conditions when multiple workers process jobs for same mailbox
- ✅ Throttle limits enforced atomically (daily, hourly, min-gap)
- ✅ Jobs that fail throttle are cancelled (status = 'cancelled')
- ✅ Claim function stays simple (no throttle logic)
- ✅ Clear separation: claim vs. throttle checking

---

### 1.2 Full IMAP Inbox Checker Implementation

**Status**: ❌ Not Started - Infrastructure exists, logic missing  
**Effort**: 1-2 days  
**Dependencies**: None

**Tasks**:
1. Install IMAP library in Lambda:
   - Add `imapflow` to `amplify/functions/inboxChecker/package.json`
   - Update Lambda deployment
2. Implement IMAP connection and message fetching:
   - Connect via IMAP using `mailboxes.imap_*` credentials
   - Query for messages since `last_synced_at`
   - Fetch full message content (headers, body text/HTML, attachments metadata)
3. Implement reply detection:
   - Parse `In-Reply-To` and `References` headers
   - Match against `message_jobs.provider_message_id`
   - Find corresponding `message_job` and `enrollment`
4. Implement bounce detection:
   - Subject patterns: "Undelivered", "Delivery Status", "Mail Delivery Failed"
   - Body patterns: SMTP error codes (550, 551, 552, 553)
   - From address patterns: "MAILER-DAEMON", "postmaster"
5. Implement email thread/message creation:
   - For replies: Create or update `email_thread`, create `email_message` (direction='received')
   - Update `enrollment.state = 'stopped'` on reply
   - Update `enrollment.state = 'stopped'` on bounce
   - Set `has_reply = true` on thread when first reply received
6. Implement unsubscribe detection:
   - Check `List-Unsubscribe` header
   - Check subject/body for "unsubscribe" patterns
   - Update `enrollment.state = 'stopped'` on unsubscribe
7. Update `mailboxes.last_synced_at` after processing
8. Error handling:
   - IMAP connection failures → log, continue to next mailbox
   - Authentication errors → mark mailbox as error, notify user
   - Message fetch failures → log, skip message, continue

**Files to Modify**:
- `amplify/functions/inboxChecker/handler.ts` (major update)
- `amplify/functions/inboxChecker/package.json` (add imapflow dependency)

**Success Criteria**:
- ✅ Replies detected and enrollment stopped
- ✅ Bounces detected and enrollment stopped
- ✅ Email threads created with full conversation
- ✅ Email messages stored with full content
- ✅ Handles errors gracefully (doesn't crash on one mailbox failure)

---

### 1.3 Connection Pooling for SMTP

**Status**: ⚠️ Partial - Nodemailer pooling exists but not shared  
**Effort**: 1-2 days  
**Dependencies**: None

**Tasks**:
1. Create connection pool manager (`workers/send-worker/src/smtp-pool.ts`):
   - **LRU cache** (Map<mailbox_id, Transporter>) with size limit (50-100 mailboxes per worker)
   - Evict least-recently-used when cache is full
   - Track messages sent per transporter (for `smtp_messages_per_connection` limit)
   - Connection health checks (ping/NOOP before use, only if transporter idle > 1 minute)
   - Error handling:
     - Remove transporter from cache on connection/auth errors
     - Recreate transporter on next use
   - Respect `smtp_connection_limit` per mailbox (per worker)
   - Respect `smtp_messages_per_connection` (recreate transporter after limit reached)
   - Graceful shutdown: Close all cached transporters on worker stop
2. Update send worker to use pool manager:
   - Replace `createTransporter(mailbox)` with `poolManager.getTransporter(mailbox)`
   - Handle connection errors (transporter removed from cache automatically)
   - Add graceful shutdown handler (close pool on SIGTERM)
3. Update mailbox status tracking:
   - Update `smtp_last_connected_at` on successful connection
   - Update `smtp_error_count` on failures
   - Mark `smtp_status = 'error'` on consecutive failures
4. Test connection reuse:
   - Verify multiple emails from same mailbox reuse connection
   - Verify LRU cache eviction works (cache at limit)
   - Verify connection errors handled (transporter removed, recreated)
   - Verify graceful shutdown (connections closed)

**Files to Create**:
- `workers/send-worker/src/smtp-pool.ts` (new)

**Files to Modify**:
- `workers/send-worker/src/worker.ts`
- `workers/send-worker/src/email.ts` (update createTransporter usage)

**Success Criteria**:
- ✅ Connections reused across multiple sends from same mailbox (cost efficiency)
- ✅ LRU cache limits memory usage (50-100 mailboxes max per worker)
- ✅ Connection health checked before use (if idle > 1 minute)
- ✅ Connection errors handled gracefully (transporter removed from cache)
- ✅ Graceful shutdown closes all connections
- ✅ `maxMessages` limit respected (transporter recreated after limit)

---

## Phase 2: Feature Completeness 🟡

**Priority**: Important for full feature set  
**Estimated Effort**: 2-3 days  
**Blocks**: Full user experience

### 2.1 Hourly/Daily Limit Enforcement

**Status**: ⚠️ Schema exists, enforcement missing  
**Effort**: Already included in 1.1 (no separate work needed)  
**Dependencies**: 1.1 (Atomic Job Reservation)

**Note**: This is now part of 1.1 - throttle checking in `check_mailbox_throttle_and_reserve()` includes:
- ✅ Daily limit check: `sent_count < daily_limit`
- ✅ Hourly limit check: `hourly_sent[current_hour] < hourly_limit`
- ✅ Min gap check: `NOW() - last_sent_at >= min_gap_seconds`
- ✅ Throttle counter updates (increment sent_count, update hourly_sent)

**No separate implementation needed** - all throttle enforcement happens in 1.1.

**Success Criteria** (verified as part of 1.1):
- ✅ Daily limits enforced correctly
- ✅ Hourly limits enforced correctly
- ✅ Min gap enforced correctly
- ✅ Limits reset at appropriate times (daily at midnight, hourly at hour change)

---

### 2.2 Email Thread Creation from Send Worker

**Status**: ❌ Missing - Threads only created on reply  
**Effort**: 2-4 hours  
**Dependencies**: None

**Tasks**:
1. Update send worker (`workers/send-worker/src/worker.ts`):
   - After successful email send (step 6, after updating message_job status):
   - Create or find `email_thread` for this `message_job_id`:
     - Check if thread exists: `SELECT * FROM email_threads WHERE message_job_id = $1`
     - If not exists, create new thread:
       - `account_id` = from `mailbox.account_id` (use already-loaded mailbox from `loadJobData()` - no need to reload)
       - `campaign_id`, `lead_id`, `enrollment_id` from `message_job`
       - `message_job_id` = current job
       - `mailbox_id` = from `message_job.mailbox_id`
       - `subject` from `message_data`
       - `participants` = [mailbox.email_address, lead.email]
       - `has_reply` = `false` (no replies yet)
       - `last_message_at` = `sent_at`
       - `message_count` = 1
   - Create `email_message` record:
     - `thread_id` (from thread above)
     - `message_job_id` = current job
     - `direction` = 'sent'
     - `from_email`, `from_name` from mailbox
     - `to_email`, `to_name` from lead
     - `subject`, `body_text`, `body_html` from `message_data`
     - `message_id` = `provider_message_id`
     - `received_at` = `sent_at`
2. Handle errors gracefully:
   - If thread creation fails, log error but don't fail email send
   - Thread creation is for UX (inbox UI), not critical for sending

**Files to Modify**:
- `workers/send-worker/src/worker.ts`

**Success Criteria**:
- ✅ Email threads created when email is sent
- ✅ Email messages stored with sent emails
- ✅ Inbox UI can show sent emails immediately (not waiting for reply)

---

### 2.3 Tracking Endpoints (Open/Click Tracking)

**Status**: ❌ Not Started  
**Effort**: 1-2 days  
**Dependencies**: None

**Tasks**:
1. Create open tracking Lambda (`amplify/functions/trackOpen/`):
   - Endpoint: `/o/:message_job_id.png`
   - Load `message_job` by ID
   - Create event: `{event_type: 'opened', message_job_id, ...}`
   - Return 1x1 transparent PNG
2. Create click tracking Lambda (`amplify/functions/trackClick/`):
   - Endpoint: `/c/:link_id`
   - Load link mapping (need to create `email_links` table or store in `message_data`)
   - Create event: `{event_type: 'clicked', message_job_id, link_id, ...}`
   - Redirect to original URL
3. Create `email_links` table (if needed):
   - `id` (link_id), `message_job_id`, `original_url`, `created_at`
   - Store link mappings when generating email HTML
4. Update email generation to include tracking:
   - Add open pixel: `<img src="https://tracking.domain.com/o/{message_job_id}.png" />`
   - Replace links with tracking URLs: `https://tracking.domain.com/c/{link_id}`
5. Configure API Gateway or CloudFront:
   - Route `/o/*` to trackOpen Lambda
   - Route `/c/*` to trackClick Lambda

**Files to Create**:
- `amplify/functions/trackOpen/handler.ts`
- `amplify/functions/trackOpen/resource.ts`
- `amplify/functions/trackClick/handler.ts`
- `amplify/functions/trackClick/resource.ts`
- `supabase/migrations/YYYYMMDDHHMMSS_create_email_links_table.sql` (if needed)

**Files to Modify**:
- `workers/send-worker/src/email.ts` (add tracking pixel and link replacement)
- `amplify/backend.ts` (add Lambda functions)

**Success Criteria**:
- ✅ Open events tracked when email is opened
- ✅ Click events tracked when links are clicked
- ✅ Events stored in `events` table
- ✅ Analytics can query open/click rates

---

## Phase 3: Observability 🟡

**Priority**: Important for production operations  
**Estimated Effort**: 1-2 days  
**Blocks**: Production monitoring

### 3.1 CloudWatch Metrics & Alarms

**Status**: ❌ Not Started  
**Effort**: 1-2 days  
**Dependencies**: None

**Tasks**:
1. Create CloudWatch custom metrics Lambda (`amplify/functions/publishMetrics/`):
   - Query Supabase for metrics:
     - `MessageJobsCreated` (COUNT of message_jobs WHERE created_at > last_check)
     - `MessageJobsSent` (COUNT of message_jobs WHERE status='sent' AND sent_at > last_check)
     - `MessageJobsFailed` (COUNT of message_jobs WHERE status='failed' AND updated_at > last_check)
     - `PendingJobsCount` (COUNT of message_jobs WHERE status='pending' AND scheduled_at <= NOW())
     - `ActiveEnrollmentsCount` (COUNT of enrollments WHERE state='active')
   - Publish metrics to CloudWatch using AWS SDK
   - Run every 1-5 minutes (CloudWatch Event Rule)
2. Create CloudWatch dashboard:
   - Message job metrics (created, sent, failed)
   - Pending jobs count (for auto-scaling)
   - Active enrollments count (for scheduler auto-scaling)
   - Worker task counts (ECS metrics)
   - Error rates
3. Create CloudWatch alarms:
   - High pending jobs (> 1000) → Alert (scale up workers)
   - High error rate (> 10% failures) → Alert
   - Worker failures (> 5 in 5 minutes) → Alert
   - No workers running → Critical alert

**Files to Create**:
- `amplify/functions/publishMetrics/handler.ts`
- `amplify/functions/publishMetrics/resource.ts`
- CloudWatch dashboard JSON (or create via console)

**Files to Modify**:
- `amplify/backend.ts` (add Lambda function and EventBridge rule)

**Success Criteria**:
- ✅ Custom metrics published to CloudWatch
- ✅ Dashboard shows key system metrics
- ✅ Alarms configured for critical issues
- ✅ Alerts sent (email/SNS) on alarm triggers

---

## Phase 4: Quality Assurance 🟢

**Priority**: Important for long-term maintainability  
**Estimated Effort**: 1-2 weeks  
**Blocks**: Code quality, regression prevention

### 4.1 Unit Tests

**Status**: ❌ Not Started  
**Effort**: 1 week  
**Dependencies**: None

**Tasks**:
1. Set up testing framework:
   - Add Jest/Vitest to worker projects
   - Configure test scripts in `package.json`
2. Write unit tests for:
   - Flow evaluation logic (`workers/scheduler-worker/src/flow-evaluation.ts`)
   - Throttle reservation logic (`check_mailbox_throttle_and_reserve()` function)
   - SMTP integration (mocked SMTP server)
   - SMTP error code classification
   - Connection pooling logic
   - Event processing logic
   - Template merging
   - Jitter calculations
   - Schedule checking
3. Set up CI/CD to run tests:
   - GitHub Actions workflow
   - Run tests on PR
   - Fail build if tests fail

**Files to Create**:
- `workers/scheduler-worker/src/__tests__/` (test files)
- `workers/send-worker/src/__tests__/` (test files)
- `.github/workflows/test.yml` (CI/CD)

**Success Criteria**:
- ✅ All core logic has unit tests
- ✅ Tests run in CI/CD
- ✅ Test coverage > 70% for critical paths

---

### 4.2 Integration Tests

**Status**: ❌ Not Started  
**Effort**: 3-5 days  
**Dependencies**: 4.1 (Unit Tests)

**Tasks**:
1. Set up integration test environment:
   - Test Supabase database (or use test schema)
   - Mock SMTP server (e.g., MailHog, MailCatcher)
   - Test ECS workers (or run locally)
2. Write integration tests for:
   - End-to-end flow: enrollment → job creation → send → event
   - Throttle enforcement (multiple workers, same mailbox)
   - Error handling and retries
   - Concurrent worker behavior
   - Campaign schedule enforcement
   - Jitter application
3. Set up test data fixtures:
   - Test campaigns, leads, enrollments
   - Test mailboxes (test mode)
   - Test flow graphs

**Files to Create**:
- `tests/integration/` (integration test files)
- `tests/fixtures/` (test data)

**Success Criteria**:
- ✅ End-to-end flows tested
- ✅ Concurrent behavior validated
- ✅ Error scenarios covered

---

## Implementation Order

**Recommended sequence** (based on dependencies and priority):

### Week 1: Critical Production Gaps
1. **Day 1-2**: Atomic Job Reservation (1.1) - **Blocks production**
2. **Day 3-4**: IMAP Inbox Checker (1.2) - **Feature completeness**
3. **Day 5**: Connection Pooling (1.3) - **Cost efficiency**

### Week 2: Feature Completeness & Observability
4. **Day 1**: Email Thread Creation (2.2) - **UX improvement** (2.1 already done in 1.1)
5. **Day 2-3**: Tracking Endpoints (2.3) - **Feature enhancement**
6. **Day 4-5**: CloudWatch Metrics (3.1) - **Observability**

### Week 3: Quality Assurance
7. **Days 1-5**: Unit Tests (4.1)
8. **Days 6-7**: Integration Tests (4.2)

---

## Dependencies Graph

```
1.1 (Atomic Reservation) - includes 2.1 (Hourly/Daily Limits)

1.2 (IMAP Checker) - independent
1.3 (Connection Pooling) - independent
2.2 (Email Threads) - independent
2.3 (Tracking) - independent
3.1 (Metrics) - independent

4.1 (Unit Tests) - independent
4.2 (Integration Tests) - depends on 4.1
```

---

## Success Criteria

**Production Ready** when:
- ✅ All Phase 1 items complete (Critical Production Gaps)
- ✅ All Phase 2 items complete (Feature Completeness)
- ✅ Phase 3.1 complete (Observability)
- ✅ Basic smoke tests pass

**Fully Complete** when:
- ✅ All phases complete
- ✅ Unit tests > 70% coverage
- ✅ Integration tests pass
- ✅ Documentation complete

---

## Risk Mitigation

**High Risk Items**:
1. **Atomic Reservation (1.1)**: Complex database logic - test thoroughly with multiple workers
2. **IMAP Checker (1.2)**: IMAP can be flaky - implement robust error handling
3. **Connection Pooling (1.3)**: Connection management complexity - test edge cases

**Mitigation**:
- Test each item in isolation before integration
- Use test mailboxes for development
- Monitor CloudWatch logs during testing
- Roll out incrementally (dev → staging → prod)

---

## Notes

- **Estimated Total Effort**: 2-3 weeks (1 developer, full-time)
- **Can be parallelized**: Some items can be worked on simultaneously (e.g., 1.2 and 1.3)
- **MVP vs Full**: Phase 1 is minimum for production, Phases 2-4 are enhancements
- **Testing**: Can start Phase 4 in parallel with Phase 1-3 (different developer)

---

## Next Steps

1. **Review this plan** with team
2. **Prioritize** based on business needs
3. **Assign** tasks to developers
4. **Set up** development environment for testing
5. **Begin** Phase 1.1 (Atomic Job Reservation)
