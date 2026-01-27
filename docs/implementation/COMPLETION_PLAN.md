# Completion Plan - Sending Infrastructure

**Date**: January 21, 2026
**Based On**: Implementation Status Review  
**Goal**: Complete all remaining work to achieve production readiness

---

## Overview

Current completion: **~90%** (updated January 28, 2026)  
Target completion: **100%** (production ready)

**Completed**:
- ✅ Phase 1.1: Atomic Job Reservation with Throttle Checking (January 21, 2026)
- ✅ Phase 1.2: Full IMAP Inbox Checker Implementation (January 28, 2026)
- ✅ Phase 2.1: Hourly/Daily Limit Enforcement (included in 1.1)
- ✅ Phase 2.2: Email Thread Creation (backfilled on reply, January 28, 2026)

**Remaining Work**: ~10% across 3 main areas:
1. **Critical Production Gaps** (High Priority) - 1 item remaining (1.3)
2. **Feature Completeness** (Medium Priority) - 1 item remaining (2.3)
3. **Observability** (Medium Priority) - 1 item (3.1)
4. **Quality Assurance** (Low Priority) - 2 items (4.1, 4.2)

**Estimated Total Effort**: 3-5 days (depending on team size)

---

## Phase 1: Critical Production Gaps 🔴

**Priority**: Must complete before production  
**Estimated Effort**: 3-4 days  
**Blocks**: Production deployment

### 1.1 Atomic Job Reservation with Throttle Checking

**Status**: ✅ **COMPLETE** - January 21, 2026  
**Effort**: 4-6 hours (completed)  
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
- ✅ **COMPLETE**: No race conditions when multiple workers process jobs for same mailbox
- ✅ **COMPLETE**: Throttle limits enforced atomically (daily, hourly, min-gap)
- ✅ **COMPLETE**: Jobs that fail throttle are cancelled (status = 'cancelled')
- ✅ **COMPLETE**: Claim function stays simple (no throttle logic)
- ✅ **COMPLETE**: Clear separation: claim vs. throttle checking
- ✅ **COMPLETE**: Race condition test UI built and all scenarios passing (min-gap, daily-limit, hourly-limit, mixed)

---

### 1.2 Full IMAP Inbox Checker Implementation

**Status**: ✅ **COMPLETE** - January 28, 2026  
**Effort**: 2-3 days (completed)  
**Dependencies**: None  
**Architecture**: ECS Fargate worker (replaces Lambda for scale)

**Decision**: Moved from Lambda to ECS worker because:
- Lambda timeout (5 min) cannot handle 1,000+ mailboxes
- ECS allows continuous processing with no timeout limits
- Parallel processing (10 mailboxes at a time per worker)
- Consistent with existing worker architecture (send-worker, scheduler-worker)
- Better cost efficiency at scale

**Implementation Details**:
- ✅ ECS worker deployed (`workers/inbox-checker-worker/`)
- ✅ IMAP connection and message fetching via `imapflow` library
- ✅ Reply detection with `In-Reply-To` and `References` header fallback
- ✅ Reply-to-reply handling (multi-turn conversations)
- ✅ Bounce detection (subject/body/from patterns)
- ✅ Unsubscribe detection (`List-Unsubscribe` header)
- ✅ Email thread and message creation
- ✅ Original sent message backfilling (when reply received)
- ✅ Duplicate message handling
- ✅ Message-ID normalization (case-insensitive, bracket handling)
- ✅ Race condition fixes (message_count recalculation)
- ✅ IMAP UID storage for on-demand attachment fetching
- ✅ Attachment metadata extraction (filename, type, size, part, imapUid)

**Recent Enhancements** (January 28, 2026):
- ✅ References header fallback for Outlook-style threading
- ✅ Reply-to-reply support (handles complex conversation chains)
- ✅ Original sent message backfilling (threads now show both sent + received)
- ✅ Duplicate message prevention
- ✅ Case-insensitive Message-ID matching (RFC 5322 compliant)
- ✅ Attachment part identifiers stored for on-demand fetching

**Files Created/Modified**:
- `workers/inbox-checker-worker/` (complete ECS worker implementation)
- `supabase/migrations/20251229205236_create_email_threads_and_messages.sql`
- `supabase/migrations/20260128000000_add_imap_uid_for_attachment_fetching.sql`

**Success Criteria**:
- ✅ **COMPLETE**: Replies detected and enrollment stopped
- ✅ **COMPLETE**: Bounces detected and enrollment stopped
- ✅ **COMPLETE**: Email threads created with full conversation
- ✅ **COMPLETE**: Email messages stored with full content (sent + received)
- ✅ **COMPLETE**: Handles errors gracefully (doesn't crash on one mailbox failure)
- ✅ **COMPLETE**: Reply-to-reply handling (multi-turn conversations)
- ✅ **COMPLETE**: References header fallback (Outlook compatibility)
- ✅ **COMPLETE**: Attachment metadata stored for on-demand fetching

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

**Status**: ✅ **COMPLETE** - January 21, 2026 (included in 1.1)  
**Effort**: Already included in 1.1 (no separate work needed)  
**Dependencies**: 1.1 (Atomic Job Reservation)

**Note**: This is now part of 1.1 - throttle checking in `check_mailbox_throttle_and_reserve()` includes:
- ✅ **COMPLETE**: Daily limit check: `sent_count < daily_limit`
- ✅ **COMPLETE**: Hourly limit check: `hourly_sent[current_hour] < hourly_limit`
- ✅ **COMPLETE**: Min gap check: `NOW() - last_sent_at >= min_gap_seconds`
- ✅ **COMPLETE**: Throttle counter updates (increment sent_count, update hourly_sent)

**No separate implementation needed** - all throttle enforcement happens in 1.1.

**Success Criteria** (verified as part of 1.1):
- ✅ **COMPLETE**: Daily limits enforced correctly
- ✅ **COMPLETE**: Hourly limits enforced correctly
- ✅ **COMPLETE**: Min gap enforced correctly
- ✅ **COMPLETE**: Limits reset at appropriate times (daily at midnight, hourly at hour change)

---

### 2.2 Email Thread Creation from Send Worker

**Status**: ✅ **COMPLETE** - January 28, 2026 (via inbox checker backfilling)  
**Effort**: Included in 1.2  
**Dependencies**: 1.2 (IMAP Inbox Checker)

**Decision**: Threads are created when replies are received, with original sent message backfilled:
- When inbox checker processes a reply, it creates the thread
- Original sent message is automatically backfilled into `email_messages` (direction='sent')
- This avoids storing threads for emails that never get replies (saves storage)
- Threads show complete conversation (original + all replies)
- Inbox UI shows threads with replies (current design)

**Implementation**:
- ✅ Thread created when first reply is received
- ✅ Original sent message backfilled into `email_messages` table
- ✅ Reply messages stored with full content
- ✅ Multi-turn conversations supported (reply-to-reply)

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
1. **Day 1-2**: ✅ **COMPLETE** Atomic Job Reservation (1.1) - January 21, 2026
2. **Day 3-5**: ✅ **COMPLETE** IMAP Inbox Checker (1.2) - January 28, 2026
3. **Day 6-7**: Connection Pooling (1.3) - **Cost efficiency** (REMAINING)

### Week 2: Feature Completeness & Observability
4. **Day 1-2**: Tracking Endpoints (2.3) - **Feature enhancement** (REMAINING)
5. **Day 3-4**: CloudWatch Metrics (3.1) - **Observability** (REMAINING)

### Week 3: Quality Assurance
7. **Days 1-5**: Unit Tests (4.1)
8. **Days 6-7**: Integration Tests (4.2)

---

## Dependencies Graph

```
✅ 1.1 (Atomic Reservation) - includes 2.1 (Hourly/Daily Limits) - COMPLETE

✅ 1.2 (IMAP Checker) - COMPLETE
⚠️ 1.3 (Connection Pooling) - REMAINING
✅ 2.2 (Email Threads) - COMPLETE (via 1.2 backfilling)
⚠️ 2.3 (Tracking) - REMAINING
⚠️ 3.1 (Metrics) - REMAINING

⚠️ 4.1 (Unit Tests) - REMAINING
⚠️ 4.2 (Integration Tests) - depends on 4.1 - REMAINING
```

---

## Success Criteria

**Production Ready** when:
- ✅ Phase 1.1 complete (Atomic Job Reservation) - **DONE**
- ✅ Phase 1.2 complete (IMAP Inbox Checker) - **DONE**
- ⚠️ Phase 1.3 complete (Connection Pooling) - **REMAINING** (cost efficiency, not blocking)
- ✅ Phase 2.2 complete (Email Thread Creation) - **DONE** (via backfilling)
- ⚠️ Phase 2.3 complete (Tracking Endpoints) - **REMAINING** (nice to have)
- ⚠️ Phase 3.1 complete (CloudWatch Metrics) - **REMAINING** (observability)
- ⚠️ Basic smoke tests pass - **REMAINING**

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

1. ✅ **COMPLETE** Phase 1.1 (Atomic Job Reservation) - January 21, 2026
2. ✅ **COMPLETE** Phase 1.2 (IMAP Inbox Checker) - January 28, 2026
3. ✅ **COMPLETE** Phase 2.2 (Email Thread Creation via backfilling) - January 28, 2026
4. **Next Priority**: Phase 1.3 (Connection Pooling) - **Cost efficiency, performance**
5. **Then**: Phase 2.3 (Tracking Endpoints) - **Feature enhancement**
6. **Then**: Phase 3.1 (CloudWatch Metrics) - **Observability**
7. **Finally**: Phase 4 (Testing) - **Quality assurance**
