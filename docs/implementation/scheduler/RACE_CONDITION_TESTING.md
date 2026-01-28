# Race Condition Testing Guide - Atomic Throttle Checking

**Purpose**: Test the `check_mailbox_throttle_and_reserve()` function to ensure no race conditions occur when multiple workers process jobs for the same mailbox simultaneously.

**Date**: January 21, 2026

---

## Test Scenarios

### Scenario 1: Min Gap Enforcement (Most Critical)

**Goal**: Verify that when multiple workers try to send from the same mailbox simultaneously, only one succeeds and the rest are cancelled due to min_gap.

**Setup**:
1. Create a mailbox with `min_gap_seconds = 180` (3 minutes)
2. Create 10-20 message jobs for the same mailbox, all scheduled for `NOW()`
3. Ensure multiple workers are running (scale up ECS service to 2-3 tasks)

**Expected Behavior**:
- ✅ Only **1 job** should succeed (status = 'sent')
- ✅ Remaining jobs should be **cancelled** (status = 'cancelled', error_message = 'Minimum gap between sends not met')
- ✅ `mailbox_throttles.last_sent_at` should be updated exactly once
- ✅ `mailbox_throttles.sent_count` should increment by exactly 1
- ✅ No duplicate sends occur

**Verification SQL**:
```sql
-- Check job statuses
SELECT 
  status,
  COUNT(*) as count,
  STRING_AGG(error_message, '; ') FILTER (WHERE error_message IS NOT NULL) as error_messages
FROM message_jobs
WHERE mailbox_id = '<your-test-mailbox-id>'
  AND created_at > NOW() - INTERVAL '10 minutes'
GROUP BY status;

-- Check throttle counters
SELECT 
  sent_count,
  last_sent_at,
  min_gap_seconds
FROM mailbox_throttles
WHERE mailbox_id = '<your-test-mailbox-id>'
  AND date = CURRENT_DATE;

-- Verify no duplicate sends (should be 0)
SELECT COUNT(*) as duplicate_sends
FROM (
  SELECT 
    lead_id,
    COUNT(*) as send_count
  FROM message_jobs
  WHERE mailbox_id = '<your-test-mailbox-id>'
    AND status = 'sent'
    AND created_at > NOW() - INTERVAL '10 minutes'
  GROUP BY lead_id
  HAVING COUNT(*) > 1
) duplicates;
```

---

### Scenario 2: Daily Limit Enforcement

**Goal**: Verify that daily limit is enforced atomically when multiple workers try to send.

**Setup**:
1. Create a mailbox with `daily_limit = 5`
2. Set `mailbox_throttles.sent_count = 4` (one below limit)
3. Create 10 message jobs for the same mailbox, all scheduled for `NOW()`
4. Ensure multiple workers are running

**Expected Behavior**:
- ✅ Exactly **1 job** should succeed (bringing total to 5, hitting daily limit)
- ✅ Remaining **9 jobs** should be cancelled (error_message = 'Daily throttle limit exceeded')
- ✅ `mailbox_throttles.sent_count` should be exactly 5
- ✅ No jobs should be sent beyond the daily limit

**Verification SQL**:
```sql
-- Check job statuses
SELECT status, COUNT(*) as count
FROM message_jobs
WHERE mailbox_id = '<your-test-mailbox-id>'
  AND created_at > NOW() - INTERVAL '10 minutes'
GROUP BY status;

-- Verify daily limit enforced
SELECT 
  sent_count,
  daily_limit,
  CASE 
    WHEN sent_count > daily_limit THEN '❌ LIMIT EXCEEDED'
    ELSE '✅ Within limit'
  END as limit_status
FROM mailbox_throttles
WHERE mailbox_id = '<your-test-mailbox-id>'
  AND date = CURRENT_DATE;
```

---

### Scenario 3: Hourly Limit Enforcement

**Goal**: Verify that hourly limit is enforced atomically.

**Setup**:
1. Create a mailbox with `hourly_limit = 3`
2. Set `mailbox_throttles.hourly_sent = '{"14": 2}'` (2 sends in current hour, limit is 3)
3. Create 10 message jobs for the same mailbox, all scheduled for `NOW()`
4. Ensure multiple workers are running

**Expected Behavior**:
- ✅ Exactly **1 job** should succeed (bringing hourly count to 3, hitting limit)
- ✅ Remaining **9 jobs** should be cancelled (error_message = 'Hourly throttle limit exceeded')
- ✅ `mailbox_throttles.hourly_sent[<current_hour>]` should be exactly 3
- ✅ No jobs should be sent beyond the hourly limit

**Verification SQL**:
```sql
-- Check job statuses
SELECT status, COUNT(*) as count
FROM message_jobs
WHERE mailbox_id = '<your-test-mailbox-id>'
  AND created_at > NOW() - INTERVAL '10 minutes'
GROUP BY status;

-- Check hourly counts
SELECT 
  hourly_sent,
  hourly_limit,
  EXTRACT(HOUR FROM NOW()) as current_hour,
  (hourly_sent->>EXTRACT(HOUR FROM NOW())::TEXT)::INTEGER as current_hour_count
FROM mailbox_throttles
WHERE mailbox_id = '<your-test-mailbox-id>'
  AND date = CURRENT_DATE;
```

---

### Scenario 4: Mixed Throttle Limits (Stress Test)

**Goal**: Test all throttle limits simultaneously with high concurrency.

**Setup**:
1. Create a mailbox with:
   - `daily_limit = 10`
   - `hourly_limit = 5`
   - `min_gap_seconds = 60` (1 minute)
2. Set `mailbox_throttles`:
   - `sent_count = 8` (2 below daily limit)
   - `hourly_sent = '{"14": 3}'` (3 in current hour, 2 below hourly limit)
   - `last_sent_at = NOW() - INTERVAL '30 seconds'` (30 seconds ago, min gap is 60)
3. Create 20 message jobs for the same mailbox, all scheduled for `NOW()`
4. Scale workers to 3-5 tasks for maximum concurrency

**Expected Behavior**:
- ✅ **0 jobs** should succeed (min_gap not met yet)
- ✅ All **20 jobs** should be cancelled (error_message = 'Minimum gap between sends not met')
- ✅ `mailbox_throttles.sent_count` should remain 8 (no increment)
- ✅ `mailbox_throttles.last_sent_at` should remain unchanged

**After waiting 60+ seconds**:
- Create 5 more jobs (now min_gap is met)
- Expected: **2 jobs** succeed (hitting daily limit of 10), **3 jobs** cancelled (daily limit exceeded)

---

## Test Execution Methods

### Method 1: Using Test UI (Easiest)

1. **Go to Test Worker Page**: `/test/worker`
2. **Configure Test**:
   - Select "Scale Test" mode
   - Set count to 20-50 jobs
   - Use a test mailbox (ends with `@furnace.test`) to skip SMTP
3. **Create Jobs**: All jobs will be created for the same mailbox
4. **Monitor**: Watch CloudWatch logs or query database

**Limitation**: All jobs use the same mailbox, which is perfect for race condition testing!

---

### Method 2: SQL Script (More Control)

Create test jobs directly via SQL:

```sql
-- Step 1: Get or create test mailbox
DO $$
DECLARE
  v_mailbox_id UUID;
  v_campaign_id UUID;
  v_lead_id UUID;
  v_enrollment_id UUID;
  v_node_id UUID;
BEGIN
  -- Get existing test mailbox or create one
  SELECT id INTO v_mailbox_id
  FROM mailboxes
  WHERE email_address LIKE '%@furnace.test'
  LIMIT 1;
  
  IF v_mailbox_id IS NULL THEN
    -- Create test mailbox (you'll need to provide account_id)
    INSERT INTO mailboxes (account_id, email_address, display_name, smtp_host, smtp_port, smtp_username, smtp_password, smtp_use_tls, smtp_status)
    VALUES (
      '<your-account-id>',
      'test-race@furnace.test',
      'Test Race Condition Mailbox',
      'smtp.gmail.com',
      587,
      'test@example.com',
      'password',
      true,
      'active'
    )
    RETURNING id INTO v_mailbox_id;
  END IF;
  
  -- Get or create test campaign
  SELECT id INTO v_campaign_id
  FROM campaigns
  LIMIT 1;
  
  -- Get or create test lead
  SELECT id INTO v_lead_id
  FROM leads
  LIMIT 1;
  
  -- Get or create test enrollment
  SELECT id INTO v_enrollment_id
  FROM enrollments
  WHERE campaign_id = v_campaign_id
  LIMIT 1;
  
  -- Get a node_id from campaign flow_data (or create a dummy one)
  -- For testing, we'll use a dummy UUID
  v_node_id := gen_random_uuid();
  
  -- Step 2: Set up throttle limits
  INSERT INTO mailbox_throttles (mailbox_id, date, sent_count, daily_limit, hourly_limit, min_gap_seconds)
  VALUES (v_mailbox_id, CURRENT_DATE, 0, 10, 5, 180)
  ON CONFLICT (mailbox_id, date) DO UPDATE
  SET sent_count = 0,
      daily_limit = 10,
      hourly_limit = 5,
      min_gap_seconds = 180;
  
  -- Step 3: Create 20 message jobs all scheduled for NOW()
  INSERT INTO message_jobs (
    enrollment_id,
    campaign_id,
    lead_id,
    mailbox_id,
    node_id,
    status,
    scheduled_at,
    message_data
  )
  SELECT 
    v_enrollment_id,
    v_campaign_id,
    v_lead_id,
    v_mailbox_id,
    v_node_id,
    'pending',
    NOW(), -- All scheduled for immediate processing
    jsonb_build_object(
      'node_config', jsonb_build_object('subject', 'Test', 'body', 'Test body'),
      'skip_smtp', true -- Skip SMTP for testing
    )
  FROM generate_series(1, 20);
  
  RAISE NOTICE 'Created 20 test jobs for mailbox %', v_mailbox_id;
END $$;
```

---

### Method 3: Scale Workers for Maximum Concurrency

**Before running tests**, scale up your ECS service to maximize concurrency:

```bash
# Scale send worker service to 5 tasks
aws ecs update-service \
  --cluster WorkerStack-Dev-Cluster \
  --service WorkerStack-Dev-SendWorkerService \
  --desired-count 5 \
  --region us-west-2
```

**After tests**, scale back down:
```bash
aws ecs update-service \
  --cluster WorkerStack-Dev-Cluster \
  --service WorkerStack-Dev-SendWorkerService \
  --desired-count 1 \
  --region us-west-2
```

---

## Monitoring During Tests

### 1. CloudWatch Logs

Watch worker logs in real-time:

```bash
# Get log group name
aws logs describe-log-groups \
  --log-group-name-prefix "/ecs/WorkerStack-Dev-SendWorker" \
  --region us-west-2

# Tail logs
aws logs tail /ecs/WorkerStack-Dev-SendWorker --follow --region us-west-2
```

**Look for**:
- `[SEND WORKER] Throttle check failed` - Expected for cancelled jobs
- `[SEND WORKER] Processing message job` - Job being processed
- `[SEND WORKER] Email sent successfully` - Job succeeded (should be limited)

### 2. Database Queries (Real-time)

Run these queries in Supabase SQL Editor while tests are running:

```sql
-- Watch job statuses change in real-time
SELECT 
  status,
  COUNT(*) as count,
  MIN(created_at) as first_created,
  MAX(updated_at) as last_updated
FROM message_jobs
WHERE mailbox_id = '<your-test-mailbox-id>'
  AND created_at > NOW() - INTERVAL '5 minutes'
GROUP BY status
ORDER BY status;

-- Watch throttle counters
SELECT 
  sent_count,
  daily_limit,
  hourly_limit,
  last_sent_at,
  EXTRACT(EPOCH FROM (NOW() - last_sent_at)) as seconds_since_last_send
FROM mailbox_throttles
WHERE mailbox_id = '<your-test-mailbox-id>'
  AND date = CURRENT_DATE;
```

---

## Success Criteria

### ✅ Test Passes If:

1. **No Duplicate Sends**: 
   - Each lead receives at most 1 email per mailbox
   - `sent_count` increments exactly by the number of successful sends

2. **Throttle Limits Enforced**:
   - Daily limit: No more than `daily_limit` sends per day
   - Hourly limit: No more than `hourly_limit` sends per hour
   - Min gap: No sends within `min_gap_seconds` of each other

3. **Atomic Updates**:
   - `mailbox_throttles` counters are updated correctly (no race conditions)
   - `last_sent_at` is updated exactly once per successful send

4. **Failed Jobs Handled Correctly**:
   - Jobs that fail throttle checks are marked as `cancelled`
   - `error_message` contains the reason (e.g., "Daily throttle limit exceeded")
   - No jobs are left in `reserved` status indefinitely

5. **No Database Deadlocks**:
   - Workers don't hang waiting for locks
   - All jobs eventually processed (either sent or cancelled)

### ❌ Test Fails If:

1. **Duplicate Sends**: Same lead receives multiple emails from same mailbox
2. **Limit Exceeded**: More than `daily_limit` or `hourly_limit` sends occur
3. **Min Gap Violated**: Sends occur within `min_gap_seconds` of each other
4. **Counter Mismatch**: `sent_count` doesn't match actual number of sends
5. **Deadlocks**: Workers hang or jobs stuck in `reserved` status

---

## Troubleshooting

### Jobs Stuck in 'reserved' Status

If jobs are stuck in `reserved` status (worker crashed), reset them:

```sql
-- Reset stuck jobs (older than 5 minutes)
UPDATE message_jobs
SET status = 'pending',
    reserved_at = NULL,
    updated_at = NOW()
WHERE status = 'reserved'
  AND reserved_at < NOW() - INTERVAL '5 minutes';
```

### Throttle Counters Out of Sync

If throttle counters don't match actual sends:

```sql
-- Recalculate sent_count from actual sends
UPDATE mailbox_throttles mt
SET sent_count = (
  SELECT COUNT(*)
  FROM message_jobs mj
  WHERE mj.mailbox_id = mt.mailbox_id
    AND mj.status = 'sent'
    AND DATE(mj.sent_at) = mt.date
)
WHERE date = CURRENT_DATE;
```

### Workers Not Processing Jobs

Check:
1. Workers are running: `aws ecs list-tasks --cluster <cluster> --service <service>`
2. Workers can connect to database (check CloudWatch logs)
3. Jobs are in `pending` status and `scheduled_at <= NOW()`

---

## Next Steps After Testing

Once race condition tests pass:

1. ✅ **Document Results**: Record test results and any issues found
2. ✅ **Production Readiness**: If all tests pass, system is ready for production
3. ✅ **Monitor in Production**: Set up alerts for throttle limit violations
4. ✅ **Load Testing**: Test with higher volumes (100+ concurrent jobs)

---

## Quick Test Checklist

- [ ] Scenario 1: Min Gap Enforcement (10-20 jobs, same mailbox)
- [ ] Scenario 2: Daily Limit Enforcement (10 jobs, 1 below limit)
- [ ] Scenario 3: Hourly Limit Enforcement (10 jobs, 1 below limit)
- [ ] Scenario 4: Mixed Limits Stress Test (20 jobs, multiple limits)
- [ ] Verify no duplicate sends
- [ ] Verify throttle counters accurate
- [ ] Verify failed jobs cancelled correctly
- [ ] Check CloudWatch logs for errors
- [ ] Verify no deadlocks or stuck jobs

---

**Note**: Always use test mailboxes (`@furnace.test`) or set `skip_smtp: true` in `message_data` to avoid sending real emails during testing.
