-- Diagnose master inbox wipe: run in Supabase SQL Editor (production or staging).
-- email_threads were CASCADE-deleted when: campaign, account, lead, enrollment, message_job, or mailbox was deleted.
-- If no campaigns/mailboxes were deleted, other possibilities: account delete, bulk lead/enrollment/job delete, or db reset/restore.

-- 1) Thread counts per account (is any account missing threads they used to have?)
SELECT et.account_id, a.name AS account_name, COUNT(*) AS thread_count
FROM email_threads et
LEFT JOIN accounts a ON a.id = et.account_id
GROUP BY et.account_id, a.name
ORDER BY thread_count DESC;

-- 2) Total threads and messages in DB
SELECT
  (SELECT COUNT(*) FROM email_threads) AS total_threads,
  (SELECT COUNT(*) FROM email_messages) AS total_messages;

-- 3) Recent campaigns (deleting a campaign CASCADE-deletes all its email_threads)
SELECT id, name, status, account_id, created_at, updated_at
FROM campaigns
ORDER BY updated_at DESC
LIMIT 20;

-- 4) If you know your account_id, check threads for that account only (replace UUID)
-- SELECT id, campaign_id, subject, last_message_at, has_reply
-- FROM email_threads
-- WHERE account_id = 'YOUR_ACCOUNT_ID'
-- ORDER BY last_message_at DESC
-- LIMIT 50;
