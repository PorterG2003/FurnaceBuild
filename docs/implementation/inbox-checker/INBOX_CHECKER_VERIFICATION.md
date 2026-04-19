# Inbox Checker Verification Guide

After the inbox checker processes a reply, verify that:

1. **Thread linking** — reply is correctly linked to the original sent message
2. **Enrollment stopping** — enrollment is stopped when a reply is detected
3. **Message parsing** — all message data (headers, body, attachments) is captured correctly
4. **Alerting behavior** — retryable inbox-checker noise should post once immediately, then summarize repeats with counts instead of flooding Slack

---

## Quick Verification SQL

Run this query to see recent replies and their thread/enrollment status:

```sql
-- Find recent email threads with replies
SELECT 
  et.id as thread_id,
  et.subject,
  et.has_reply,
  et.message_count,
  et.participants,
  et.last_message_at,
  et.message_job_id,
  mj.provider_message_id as original_message_id,
  mj.enrollment_id,
  e.state as enrollment_state,
  e.id as enrollment_id,
  -- Count messages in thread
  (SELECT COUNT(*) FROM email_messages em WHERE em.thread_id = et.id) as actual_message_count,
  -- Get the reply message
  (SELECT em.message_id FROM email_messages em 
   WHERE em.thread_id = et.id AND em.direction = 'received' 
   ORDER BY em.received_at DESC LIMIT 1) as reply_message_id,
  (SELECT em.in_reply_to FROM email_messages em 
   WHERE em.thread_id = et.id AND em.direction = 'received' 
   ORDER BY em.received_at DESC LIMIT 1) as reply_in_reply_to
FROM email_threads et
LEFT JOIN message_jobs mj ON mj.id = et.message_job_id
LEFT JOIN enrollments e ON e.id = et.enrollment_id
WHERE et.has_reply = true
ORDER BY et.last_message_at DESC
LIMIT 10;
```

---

## Detailed Verification Steps

### 1. Thread Linking Verification

**What to check:**
- Thread exists with `message_job_id` pointing to the original sent message
- Thread has `has_reply = true`
- Thread's `message_count` is incremented (should be ≥ 2: original + reply)
- Thread's `participants` array includes both sender and receiver emails
- `last_message_at` is updated to the reply's timestamp

**SQL to verify:**

```sql
-- Get thread details for a specific message_job
SELECT 
  et.*,
  mj.id as original_message_job_id,
  mj.provider_message_id as original_provider_message_id,
  mj.sent_at as original_sent_at,
  -- Get all messages in this thread
  json_agg(
    json_build_object(
      'id', em.id,
      'direction', em.direction,
      'from_email', em.from_email,
      'to_email', em.to_email,
      'subject', em.subject,
      'message_id', em.message_id,
      'in_reply_to', em.in_reply_to,
      'received_at', em.received_at,
      'sent_at', CASE WHEN em.direction = 'sent' AND mj_sent.id IS NOT NULL THEN mj_sent.sent_at ELSE NULL END
    ) ORDER BY em.received_at
  ) as messages
FROM email_threads et
JOIN message_jobs mj ON mj.id = et.message_job_id
LEFT JOIN email_messages em ON em.thread_id = et.id
LEFT JOIN message_jobs mj_sent ON mj_sent.id = em.message_job_id AND em.direction = 'sent'
WHERE et.message_job_id = '<YOUR_MESSAGE_JOB_ID>'  -- Replace with actual ID
GROUP BY et.id, mj.id, mj.provider_message_id, mj.sent_at;
```

**Expected results:**
- `has_reply` = `true`
- `message_count` = 2 (or more if multiple replies)
- `messages` array contains:
  - One `direction = 'sent'` message (the original)
  - One `direction = 'received'` message (the reply)
- The reply's `in_reply_to` should match the original's `message_id` (with or without angle brackets)

---

### 2. Enrollment Stopping Verification

**What to check:**
- Enrollment `state` is set to `'stopped'` when a reply is detected
- The enrollment ID matches the one from the original `message_job`

**SQL to verify (after reply is processed):**

```sql
-- Check enrollment state for threads with replies
SELECT 
  e.id as enrollment_id,
  e.state as enrollment_state,
  e.campaign_id,
  e.lead_id,
  et.id as thread_id,
  et.has_reply,
  et.last_message_at as reply_received_at,
  mj.id as message_job_id,
  mj.sent_at as original_sent_at
FROM enrollments e
JOIN email_threads et ON et.enrollment_id = e.id
JOIN message_jobs mj ON mj.id = et.message_job_id
WHERE et.has_reply = true
ORDER BY et.last_message_at DESC
LIMIT 10;
```

**Expected results:**
- All rows should have `enrollment_state = 'stopped'`
- `has_reply = true`
- `reply_received_at` should be after `original_sent_at`

**SQL to check pending replies (before inbox checker runs):**

```sql
-- Check sent message_jobs that should have replies but don't have threads yet
-- Useful for testing: shows enrollments that are still 'active' but have sent emails
SELECT 
  e.id as enrollment_id,
  e.state as enrollment_state,
  mj.id as message_job_id,
  mj.provider_message_id,
  mj.sent_at,
  mj.status as message_job_status,
  CASE 
    WHEN et.id IS NULL THEN 'No thread yet (reply not processed)'
    WHEN et.has_reply = false THEN 'Thread exists but no reply yet'
    ELSE 'Reply processed'
  END as thread_status
FROM enrollments e
JOIN message_jobs mj ON mj.enrollment_id = e.id
LEFT JOIN email_threads et ON et.message_job_id = mj.id
WHERE mj.status = 'sent'
  AND mj.provider_message_id IS NOT NULL
  AND e.state = 'active'  -- Should be 'stopped' after reply is processed
ORDER BY mj.sent_at DESC
LIMIT 10;
```

**Expected results (after reply is processed):**
- All rows should have `enrollment_state = 'stopped'`
- `has_reply = true`
- `reply_received_at` should be after `original_sent_at`

**If enrollment is NOT stopped:**
- Check worker logs for errors during `handleReply`
- Verify the `message_job.enrollment_id` is not null
- Check if the enrollment was already stopped before the reply
- Use the "pending replies" query above to see if the inbox checker has run yet

---

## Alert Verification

When validating inbox-checker deployments, also confirm the worker alerting contract:

1. Trigger or locate a retryable inbox-checker failure (for example a transient Supabase read-path error).
2. Confirm Slack posts one immediate warning.
3. If the same issue continues, confirm the channel does not get flooded on every loop iteration.
4. On the next rollover for that aggregation key, confirm the summary includes:
   - `occurrences`
   - `first_seen`
   - `last_seen`
5. Trigger or inspect a non-retryable failure and confirm it still posts as a critical alert immediately.

---

### 3. Message Parsing Verification

**What to check:**
- All email fields are populated correctly
- Headers are stored as JSON
- Attachments are stored as JSON array
- Body text and HTML are captured
- Message-ID, In-Reply-To, References are correct

**SQL to verify:**

```sql
-- Get full message details for a reply
SELECT 
  em.id,
  em.thread_id,
  em.direction,
  em.from_email,
  em.from_name,
  em.to_email,
  em.to_name,
  em.subject,
  em.body_text,
  em.body_html,
  em.message_id,
  em.in_reply_to,
  em.message_references,
  em.received_at,
  em.headers,
  em.attachments,
  -- Verify headers structure
  jsonb_typeof(em.headers) as headers_type,
  -- Verify attachments structure
  jsonb_typeof(em.attachments) as attachments_type,
  jsonb_array_length(em.attachments) as attachment_count
FROM email_messages em
WHERE em.direction = 'received'
  AND em.thread_id IN (
    SELECT id FROM email_threads WHERE has_reply = true
  )
ORDER BY em.received_at DESC
LIMIT 5;
```

**Expected results:**
- `from_email` and `to_email` are populated
- `subject` is populated (or '(No Subject)' if missing)
- `body_text` or `body_html` (or both) are populated
- `message_id` is populated (format: `<...@...>` or plain)
- `in_reply_to` matches the original message's `message_id` (with or without brackets)
- `headers` is a JSON object (not null)
- `attachments` is a JSON array (can be empty `[]`)
- `received_at` is a valid timestamp

**Verify header parsing accuracy:**

This query checks that parsed fields match the raw headers (validates parsing logic):

```sql
-- Compare parsed fields with raw headers to verify parsing is correct
SELECT 
  em.id,
  em.message_id as parsed_message_id,
  em.headers->>'message-id' as raw_message_id,
  CASE 
    WHEN em.message_id IS NULL AND em.headers->>'message-id' IS NULL THEN '✓ Both null'
    WHEN em.message_id = em.headers->>'message-id' THEN '✓ Match'
    WHEN em.message_id = REPLACE(REPLACE(em.headers->>'message-id', '<', ''), '>', '') THEN '✓ Match (brackets removed)'
    ELSE '✗ Mismatch'
  END as message_id_check,
  em.in_reply_to as parsed_in_reply_to,
  em.headers->>'in-reply-to' as raw_in_reply_to,
  CASE 
    WHEN em.in_reply_to IS NULL AND em.headers->>'in-reply-to' IS NULL THEN '✓ Both null'
    WHEN em.in_reply_to = em.headers->>'in-reply-to' THEN '✓ Match'
    WHEN em.in_reply_to = REPLACE(REPLACE(em.headers->>'in-reply-to', '<', ''), '>', '') THEN '✓ Match (brackets removed)'
    ELSE '✗ Mismatch'
  END as in_reply_to_check,
  em.from_email as parsed_from_email,
  em.headers->>'from' as raw_from_header,
  em.subject as parsed_subject,
  em.headers->>'subject' as raw_subject,
  CASE 
    WHEN em.subject = em.headers->>'subject' THEN '✓ Match'
    WHEN em.subject = '(No Subject)' AND (em.headers->>'subject' IS NULL OR em.headers->>'subject' = '') THEN '✓ Default applied'
    ELSE '✗ Mismatch'
  END as subject_check
FROM email_messages em
WHERE em.direction = 'received'
ORDER BY em.received_at DESC
LIMIT 5;
```

**What to verify:**
- ✅ `message_id_check` should be "✓ Match" or "✓ Match (brackets removed)" (brackets may be stripped during parsing)
- ✅ `in_reply_to_check` should be "✓ Match" or "✓ Match (brackets removed)" (for replies)
- ✅ `subject_check` should be "✓ Match" or "✓ Default applied" (if subject was missing)
- ✅ `parsed_from_email` should contain a valid email address (extracted from `raw_from_header`)
- ✅ All header fields should be present: `message-id`, `from`, `to`, `subject`, `date` (at minimum)

**Verify required headers exist:**

```sql
-- Check that all expected headers are present
SELECT 
  em.id,
  em.subject,
  CASE WHEN em.headers ? 'message-id' THEN '✓' ELSE '✗' END as has_message_id,
  CASE WHEN em.headers ? 'from' THEN '✓' ELSE '✗' END as has_from,
  CASE WHEN em.headers ? 'to' THEN '✓' ELSE '✗' END as has_to,
  CASE WHEN em.headers ? 'subject' THEN '✓' ELSE '✗' END as has_subject,
  CASE WHEN em.headers ? 'date' THEN '✓' ELSE '✗' END as has_date,
  CASE WHEN em.headers ? 'in-reply-to' THEN '✓' ELSE '✗' END as has_in_reply_to,
  CASE WHEN em.headers ? 'references' THEN '✓' ELSE '✗' END as has_references
FROM email_messages em
WHERE em.direction = 'received'
ORDER BY em.received_at DESC
LIMIT 5;
```

**What to verify:**
- ✅ All required headers should have "✓": `message-id`, `from`, `to`, `subject`, `date`
- ✅ For replies: `in-reply-to` should have "✓"
- ✅ `references` may or may not be present (optional header)

**Check attachments:**

```sql
-- View attachment details and verify structure
SELECT 
  em.id,
  em.subject,
  jsonb_array_length(em.attachments) as attachment_count,
  jsonb_array_elements(em.attachments) as attachment
FROM email_messages em
WHERE em.direction = 'received'
  AND jsonb_array_length(em.attachments) > 0
ORDER BY em.received_at DESC
LIMIT 10;
```

**Expected attachment structure (each attachment should have):**
```json
{
  "filename": "example.pdf",        // Required: attachment filename
  "contentType": "application/pdf", // Required: MIME type
  "size": 12345                      // Required: size in bytes
}
```

**What to verify:**
- ✅ If message has attachments, `attachment_count` > 0
- ✅ Each attachment object has `filename`, `contentType`, and `size` fields
- ✅ `filename` is not null/empty (or defaults to 'attachment' if missing)
- ✅ `contentType` is a valid MIME type (e.g., 'application/pdf', 'image/png', 'text/plain')
- ✅ `size` is a number >= 0

---

## End-to-End Verification Query

This query checks everything at once for a specific reply:

```sql
-- Complete verification for a specific thread
WITH thread_data AS (
  SELECT 
    et.id as thread_id,
    et.message_job_id,
    et.enrollment_id,
    et.has_reply,
    et.message_count,
    et.participants,
    et.last_message_at,
    mj.provider_message_id as original_message_id,
    mj.sent_at as original_sent_at,
    e.state as enrollment_state
  FROM email_threads et
  JOIN message_jobs mj ON mj.id = et.message_job_id
  LEFT JOIN enrollments e ON e.id = et.enrollment_id
  WHERE et.has_reply = true
  ORDER BY et.last_message_at DESC
  LIMIT 1
),
reply_message AS (
  SELECT 
    em.*,
    td.thread_id,
    td.enrollment_id,
    td.enrollment_state,
    td.original_message_id,
    td.original_sent_at
  FROM email_messages em
  JOIN thread_data td ON td.thread_id = em.thread_id
  WHERE em.direction = 'received'
  ORDER BY em.received_at DESC
  LIMIT 1
)
SELECT 
  -- Thread verification
  td.thread_id,
  td.has_reply as "✅ Thread has_reply",
  td.message_count as "✅ Thread message_count",
  (SELECT COUNT(*) FROM email_messages WHERE thread_id = td.thread_id) as "✅ Actual message count",
  td.participants as "✅ Thread participants",
  -- Enrollment verification
  td.enrollment_id,
  td.enrollment_state = 'stopped' as "✅ Enrollment stopped",
  -- Message linking verification
  td.original_message_id as "Original message_id",
  rm.in_reply_to as "Reply in_reply_to",
  (rm.in_reply_to LIKE '%' || REPLACE(REPLACE(td.original_message_id, '<', ''), '>', '') || '%') as "✅ In-Reply-To matches",
  -- Message parsing verification
  rm.from_email IS NOT NULL as "✅ From email populated",
  rm.to_email IS NOT NULL as "✅ To email populated",
  rm.subject IS NOT NULL as "✅ Subject populated",
  (rm.body_text IS NOT NULL OR rm.body_html IS NOT NULL) as "✅ Body populated",
  rm.message_id IS NOT NULL as "✅ Message-ID populated",
  rm.headers IS NOT NULL as "✅ Headers populated",
  jsonb_typeof(rm.headers) = 'object' as "✅ Headers is JSON object",
  rm.attachments IS NOT NULL as "✅ Attachments populated",
  jsonb_typeof(rm.attachments) = 'array' as "✅ Attachments is JSON array",
  rm.received_at IS NOT NULL as "✅ Received_at populated"
FROM thread_data td
JOIN reply_message rm ON rm.thread_id = td.thread_id;
```

All the `✅` columns should be `true` if everything is working correctly.

---

## Common Issues and Fixes

### Issue: Thread created but `has_reply = false`
**Cause:** `handleReply` didn't complete or failed after creating the message  
**Fix:** Check worker logs for errors; verify `email_messages` insert succeeded

### Issue: Enrollment not stopped
**Cause:** `message_job.enrollment_id` is null, or enrollment update failed  
**Fix:** Check that original message_job has an enrollment_id; check logs for update errors

### Issue: `in_reply_to` doesn't match `provider_message_id`
**Cause:** Message-ID format mismatch (with/without angle brackets)  
**Fix:** The code handles both formats (line 36 in thread-manager.ts), but verify the match logic

### Issue: Headers or attachments are null
**Cause:** Message parsing failed or IMAP fetch didn't include those fields  
**Fix:** Check IMAP client logs; verify message actually has headers/attachments

### Issue: Body is empty
**Cause:** MIME parsing failed or message has no text/html parts  
**Fix:** Check `body_text` and `body_html` separately; some emails are HTML-only or plain-text-only

---

## Testing Checklist

After sending a test email and receiving a reply:

- [ ] Thread exists in `email_threads` with `has_reply = true`
- [ ] Thread's `message_count` matches actual message count
- [ ] Thread's `participants` includes both sender and receiver
- [ ] Enrollment `state = 'stopped'`
- [ ] Reply message exists in `email_messages` with `direction = 'received'`
- [ ] Reply's `in_reply_to` matches original's `message_id`
- [ ] Reply has `from_email`, `to_email`, `subject` populated
- [ ] Reply has `body_text` or `body_html` (or both)
- [ ] Reply has `message_id`, `in_reply_to`, `message_references`
- [ ] Reply has `headers` as JSON object
- [ ] Reply has `attachments` as JSON array (can be empty)
- [ ] Reply has `received_at` timestamp
