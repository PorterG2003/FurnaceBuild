# Inbox Checker Worker Testing Guide

**Purpose**: Test the IMAP inbox checker worker to ensure it correctly processes mailboxes, detects replies/bounces/unsubscribes, and creates email threads.

**Date**: January 23, 2026

---

## Pre-Testing Checklist

### 1. Verify Database Migration Applied

```sql
-- Check that claim_mailboxes_to_check function exists
SELECT 
  routine_name, 
  routine_type,
  routine_definition
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name = 'claim_mailboxes_to_check';
```

If the function doesn't exist, apply the migration:
```bash
cd /path/to/project
supabase db push
```

### 2. Verify Worker is Running

```bash
# Check ECS service status
aws ecs describe-services \
  --cluster furnace-cluster-dev \
  --services $(aws ecs list-services \
    --cluster furnace-cluster-dev \
    --query "serviceArns[?contains(@, 'InboxCheckerWorker')]" \
    --output text | awk -F'/' '{print $NF}') \
  --region us-west-2 \
  --query 'services[0].[runningCount,desiredCount,status]' \
  --output table
```

Expected: `runningCount` should match `desiredCount` (at least 1), `status` should be `ACTIVE`.

### 3. Check CloudWatch Logs

```bash
# Tail logs to see worker activity
aws logs tail /ecs/furnace/inbox-checker-worker-dev \
  --follow \
  --region us-west-2
```

Look for:
- `[STARTUP] Inbox checker worker process starting...`
- `[DATABASE] Claimed X mailbox(es) to check`
- `[INBOX CHECKER] Processing mailbox...`
- `[INBOX CHECKER] Found X new message(s)`

---

## Test Scenarios

### Test 1: Basic Mailbox Processing

**Goal**: Verify worker can connect to IMAP and process mailboxes.

**Setup**:
1. Ensure you have at least one mailbox with:
   - `sync_enabled = true`
   - `status = 'connected'`
   - Valid IMAP credentials
   - `last_synced_at` is NULL or older than 5 minutes

**Steps**:
1. Check mailbox status:
   ```sql
   SELECT 
     id,
     email_address,
     sync_enabled,
     status,
     last_synced_at,
     CASE 
       WHEN last_synced_at IS NULL THEN 'Never synced'
       WHEN last_synced_at < NOW() - INTERVAL '5 minutes' THEN 'Needs sync'
       ELSE 'Recently synced'
     END as sync_status
   FROM mailboxes
   WHERE sync_enabled = true
     AND status = 'connected'
   ORDER BY last_synced_at ASC NULLS FIRST
   LIMIT 10;
   ```

2. Monitor CloudWatch logs for processing activity

3. Wait 1-2 minutes, then check if `last_synced_at` was updated:
   ```sql
   SELECT 
     id,
     email_address,
     last_synced_at,
     updated_at
   FROM mailboxes
   WHERE id = '<your-mailbox-id>';
   ```

**Expected Results**:
- ✅ Worker logs show mailbox was claimed and processed
- ✅ `last_synced_at` is updated to current time
- ✅ No errors in CloudWatch logs

---

### Test 2: Reply Detection

**Goal**: Verify worker detects replies and creates email threads.

**Setup**:
1. Send a test email from your system (via send-worker) to a mailbox you control
2. Note the `provider_message_id` from the sent message_job
3. Reply to that email from your mailbox

**Steps**:
1. Wait for inbox checker to process the mailbox (check `last_synced_at`)

2. Check if email thread was created:
   ```sql
   SELECT 
     et.id,
     et.subject,
     et.has_reply,
     et.message_count,
     et.last_message_at,
     COUNT(em.id) as actual_message_count
   FROM email_threads et
   LEFT JOIN email_messages em ON em.thread_id = et.id
   WHERE et.message_job_id = '<your-message-job-id>'
   GROUP BY et.id, et.subject, et.has_reply, et.message_count, et.last_message_at;
   ```

3. Check if reply message was created:
   ```sql
   SELECT 
     em.id,
     em.direction,
     em.from_email,
     em.to_email,
     em.subject,
     em.received_at,
     em.in_reply_to
   FROM email_messages em
   JOIN email_threads et ON et.id = em.thread_id
   WHERE et.message_job_id = '<your-message-job-id>'
     AND em.direction = 'received'
   ORDER BY em.received_at DESC;
   ```

4. Check if enrollment was stopped:
   ```sql
   SELECT 
     id,
     state,
     stopped_at
   FROM enrollments
   WHERE id = '<enrollment-id-from-message-job>';
   ```

**Expected Results**:
- ✅ Email thread created with `has_reply = true`
- ✅ Reply message created in `email_messages` with `direction = 'received'`
- ✅ Enrollment `state` changed to `'stopped'`
- ✅ `message_count` matches actual message count

---

### Test 3: Bounce Detection

**Goal**: Verify worker detects bounces and stops enrollments.

**Setup**:
1. Send a test email to an invalid email address (will bounce)
2. Or manually create a bounce message in your mailbox

**Steps**:
1. Wait for inbox checker to process the mailbox

2. Check if enrollments were stopped:
   ```sql
   SELECT 
     e.id,
     e.state,
     e.stopped_at,
     mj.id as message_job_id,
     mj.sent_at
   FROM enrollments e
   JOIN message_jobs mj ON mj.enrollment_id = e.id
   WHERE mj.mailbox_id = '<your-mailbox-id>'
     AND mj.sent_at > NOW() - INTERVAL '1 day'
     AND e.state = 'stopped'
   ORDER BY e.stopped_at DESC;
   ```

**Expected Results**:
- ✅ Enrollments from recent sends are stopped
- ✅ Worker logs show "Bounce detected"

---

### Test 4: Unsubscribe Detection

**Goal**: Verify worker detects unsubscribe requests.

**Setup**:
1. Send a test email to a mailbox you control
2. Reply with "unsubscribe" or "opt-out" in the subject/body

**Steps**:
1. Wait for inbox checker to process the mailbox

2. Check if enrollments were stopped:
   ```sql
   SELECT 
     e.id,
     e.state,
     e.stopped_at
   FROM enrollments e
   JOIN message_jobs mj ON mj.enrollment_id = e.id
   WHERE mj.mailbox_id = '<your-mailbox-id>'
     AND e.state = 'stopped'
     AND e.stopped_at > NOW() - INTERVAL '1 hour'
   ORDER BY e.stopped_at DESC;
   ```

**Expected Results**:
- ✅ Enrollments are stopped
- ✅ Worker logs show "Unsubscribe detected"

---

### Test 5: Atomic Claiming (No Duplicates)

**Goal**: Verify multiple workers don't process the same mailbox simultaneously.

**Setup**:
1. Scale inbox checker worker to 2-3 tasks:
   ```bash
   cd infra/workers
   bash scripts/scale-services.sh dev 1 1 3  # 3 inbox checker workers
   ```

2. Ensure there are multiple mailboxes that need checking

**Steps**:
1. Monitor CloudWatch logs for all workers

2. Check for duplicate processing:
   ```sql
   -- Check if any mailbox was processed multiple times in the same minute
   SELECT 
     mailbox_id,
     COUNT(*) as processing_count,
     MIN(last_synced_at) as first_sync,
     MAX(last_synced_at) as last_sync,
     MAX(last_synced_at) - MIN(last_synced_at) as time_diff
   FROM mailboxes
   WHERE last_synced_at > NOW() - INTERVAL '5 minutes'
   GROUP BY mailbox_id
   HAVING COUNT(*) > 1
     AND MAX(last_synced_at) - MIN(last_synced_at) < INTERVAL '1 minute';
   ```

**Expected Results**:
- ✅ No mailboxes processed multiple times in the same minute
- ✅ Each mailbox processed exactly once per check interval
- ✅ Worker logs show different mailboxes being claimed by different workers

---

### Test 6: Error Handling

**Goal**: Verify worker handles IMAP connection errors gracefully.

**Setup**:
1. Create a test mailbox with invalid IMAP credentials
2. Or temporarily disable IMAP access for a mailbox

**Steps**:
1. Wait for worker to attempt processing

2. Check mailbox status:
   ```sql
   SELECT 
     id,
     email_address,
     status,
     error_message,
     last_synced_at
   FROM mailboxes
   WHERE id = '<test-mailbox-id>';
   ```

3. Check CloudWatch logs for error messages

**Expected Results**:
- ✅ Mailbox `status` changed to `'error'`
- ✅ `error_message` contains error details
- ✅ Worker logs show error but continues processing other mailboxes
- ✅ Worker doesn't crash or stop

---

## Monitoring Queries

### Check Worker Activity

```sql
-- Mailboxes processed in last hour
SELECT 
  COUNT(*) as mailboxes_processed,
  COUNT(DISTINCT DATE_TRUNC('minute', last_synced_at)) as unique_minutes
FROM mailboxes
WHERE last_synced_at > NOW() - INTERVAL '1 hour'
  AND sync_enabled = true;
```

### Check Reply Detection Rate

```sql
-- Replies detected in last 24 hours
SELECT 
  COUNT(*) as replies_detected,
  COUNT(DISTINCT et.enrollment_id) as enrollments_stopped
FROM email_threads et
WHERE et.has_reply = true
  AND et.last_message_at > NOW() - INTERVAL '24 hours';
```

### Check Processing Queue Depth

```sql
-- Mailboxes waiting to be checked
SELECT COUNT(*) as pending_mailboxes
FROM mailboxes
WHERE sync_enabled = true
  AND status = 'connected'
  AND (
    last_synced_at IS NULL
    OR last_synced_at < NOW() - INTERVAL '5 minutes'
  );
```

---

## Troubleshooting

### Worker Not Processing Mailboxes

1. **Check worker is running**:
   ```bash
   aws ecs list-tasks --cluster furnace-cluster-dev --service-name <inbox-checker-service>
   ```

2. **Check CloudWatch logs** for errors

3. **Verify database connection**:
   - Check `SUPABASE_URL` and `SUPABASE_SERVICE_KEY_PARAM_PATH` are set correctly
   - Verify SSM parameter exists and is accessible

4. **Check mailbox criteria**:
   ```sql
   -- Mailboxes that should be claimed
   SELECT COUNT(*)
   FROM mailboxes
   WHERE sync_enabled = true
     AND status = 'connected'
     AND (
       last_synced_at IS NULL
       OR last_synced_at < NOW() - INTERVAL '5 minutes'
     );
   ```

### No Replies Detected

1. **Verify message was sent**:
   ```sql
   SELECT id, provider_message_id, status, sent_at
   FROM message_jobs
   WHERE id = '<message-job-id>';
   ```

2. **Check In-Reply-To header**:
   - Reply email must have `In-Reply-To` header matching `provider_message_id`
   - Remove `<` and `>` brackets if present

3. **Verify IMAP search is working**:
   - Check CloudWatch logs for "Found X new message(s)"
   - Verify messages are being fetched

### Duplicate Processing

1. **Check atomic claiming**:
   ```sql
   -- Should return 0 rows (no duplicates)
   SELECT mailbox_id, COUNT(*)
   FROM mailboxes
   WHERE last_synced_at > NOW() - INTERVAL '1 minute'
   GROUP BY mailbox_id
   HAVING COUNT(*) > 1;
   ```

2. **Verify `claim_mailboxes_to_check` function**:
   ```sql
   -- Test the function directly
   SELECT * FROM claim_mailboxes_to_check(10, 5, 10);
   ```

---

## Success Criteria

- ✅ Worker processes mailboxes without errors
- ✅ Replies are detected and enrollments stopped
- ✅ Bounces are detected and enrollments stopped
- ✅ Unsubscribes are detected and enrollments stopped
- ✅ Email threads and messages are created correctly
- ✅ No duplicate processing (atomic claiming works)
- ✅ Error handling works (invalid credentials don't crash worker)
- ✅ Worker scales horizontally (multiple workers don't conflict)

---

## Next Steps

Once all tests pass:

1. ✅ **Monitor in production**: Set up CloudWatch alarms
2. ✅ **Scale as needed**: Adjust worker count based on mailbox volume
3. ✅ **Disable Lambda**: Remove or disable the old Lambda inbox checker
4. ✅ **Document any issues**: Update this guide with learnings
