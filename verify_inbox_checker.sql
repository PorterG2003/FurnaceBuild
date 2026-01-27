-- Quick verification script for inbox checker
-- Run this in your Supabase SQL editor to verify recent replies

-- 1. Check most recent thread with reply
SELECT 
  '=== THREAD VERIFICATION ===' as section,
  et.id as thread_id,
  et.has_reply as "Thread has reply?",
  et.message_count as "Thread message count",
  (SELECT COUNT(*) FROM email_messages WHERE thread_id = et.id) as "Actual messages in thread",
  et.participants as "Participants",
  et.last_message_at as "Last message time",
  CASE 
    WHEN et.has_reply = true AND et.message_count >= 2 THEN '✅ PASS'
    ELSE '❌ FAIL'
  END as "Thread status"
FROM email_threads et
WHERE et.has_reply = true
ORDER BY et.last_message_at DESC
LIMIT 1;

-- 2. Check enrollment stopping
SELECT 
  '=== ENROLLMENT VERIFICATION ===' as section,
  e.id as enrollment_id,
  e.state as "Enrollment state",
  et.id as thread_id,
  et.has_reply as "Thread has reply",
  CASE 
    WHEN e.state = 'stopped' AND et.has_reply = true THEN '✅ PASS'
    ELSE '❌ FAIL'
  END as "Enrollment status"
FROM enrollments e
JOIN email_threads et ON et.enrollment_id = e.id
WHERE et.has_reply = true
ORDER BY et.last_message_at DESC
LIMIT 1;

-- 3. Check message linking (In-Reply-To matches original)
SELECT 
  '=== MESSAGE LINKING VERIFICATION ===' as section,
  et.id as thread_id,
  mj.provider_message_id as "Original message_id",
  em.in_reply_to as "Reply in_reply_to",
  CASE 
    WHEN em.in_reply_to LIKE '%' || REPLACE(REPLACE(mj.provider_message_id, '<', ''), '>', '') || '%' 
      THEN '✅ PASS'
    ELSE '❌ FAIL'
  END as "Linking status"
FROM email_threads et
JOIN message_jobs mj ON mj.id = et.message_job_id
JOIN email_messages em ON em.thread_id = et.id
WHERE et.has_reply = true 
  AND em.direction = 'received'
ORDER BY em.received_at DESC
LIMIT 1;

-- 4. Check message parsing
SELECT 
  '=== MESSAGE PARSING VERIFICATION ===' as section,
  em.id as message_id,
  em.from_email IS NOT NULL as "Has from_email",
  em.to_email IS NOT NULL as "Has to_email",
  em.subject IS NOT NULL as "Has subject",
  (em.body_text IS NOT NULL OR em.body_html IS NOT NULL) as "Has body",
  em.message_id IS NOT NULL as "Has message_id",
  em.in_reply_to IS NOT NULL as "Has in_reply_to",
  em.headers IS NOT NULL as "Has headers",
  jsonb_typeof(em.headers) = 'object' as "Headers is JSON",
  em.attachments IS NOT NULL as "Has attachments",
  jsonb_typeof(em.attachments) = 'array' as "Attachments is JSON array",
  em.received_at IS NOT NULL as "Has received_at",
  CASE 
    WHEN em.from_email IS NOT NULL 
      AND em.to_email IS NOT NULL 
      AND em.subject IS NOT NULL
      AND (em.body_text IS NOT NULL OR em.body_html IS NOT NULL)
      AND em.message_id IS NOT NULL
      AND em.headers IS NOT NULL
      AND jsonb_typeof(em.headers) = 'object'
      AND em.attachments IS NOT NULL
      AND jsonb_typeof(em.attachments) = 'array'
      AND em.received_at IS NOT NULL
    THEN '✅ PASS'
    ELSE '❌ FAIL'
  END as "Parsing status"
FROM email_messages em
JOIN email_threads et ON et.id = em.thread_id
WHERE et.has_reply = true 
  AND em.direction = 'received'
ORDER BY em.received_at DESC
LIMIT 1;

-- 5. Complete summary
SELECT 
  '=== SUMMARY ===' as section,
  COUNT(DISTINCT et.id) FILTER (WHERE et.has_reply = true) as "Threads with replies",
  COUNT(DISTINCT e.id) FILTER (WHERE e.state = 'stopped' AND et.has_reply = true) as "Enrollments stopped",
  COUNT(DISTINCT em.id) FILTER (WHERE em.direction = 'received' AND et.has_reply = true) as "Reply messages",
  MAX(et.last_message_at) FILTER (WHERE et.has_reply = true) as "Most recent reply"
FROM email_threads et
LEFT JOIN enrollments e ON e.id = et.enrollment_id
LEFT JOIN email_messages em ON em.thread_id = et.id AND em.direction = 'received'
WHERE et.has_reply = true;
