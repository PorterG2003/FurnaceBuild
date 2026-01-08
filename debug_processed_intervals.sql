-- Diagnostic query to see why intervals are being marked as processed prematurely
-- Replace campaign_id with your actual campaign_id

-- Check current state of intervals and their jobs
SELECT 
  ci.id as interval_id,
  ci.interval_time,
  ci.status as interval_status,
  (SELECT last_completed_interval_time FROM campaigns WHERE id = '683a9d74-211b-4825-8670-a0fba37be8ac') as last_processed,
  -- Count eligible mailboxes
  (SELECT COUNT(*)
   FROM campaign_mailboxes cm
   JOIN mailboxes m ON m.id = cm.mailbox_id
   WHERE cm.campaign_id = '683a9d74-211b-4825-8670-a0fba37be8ac'
     AND m.status = 'connected'
     AND m.smtp_status = 'active'
  ) as total_eligible_mailboxes,
  -- Count mailboxes with jobs in this interval
  (SELECT COUNT(DISTINCT cm.mailbox_id)
   FROM campaign_mailboxes cm
   JOIN mailboxes m ON m.id = cm.mailbox_id
   JOIN message_jobs mj ON mj.mailbox_id = cm.mailbox_id AND mj.interval_id = ci.id
   WHERE cm.campaign_id = '683a9d74-211b-4825-8670-a0fba37be8ac'
     AND m.status = 'connected'
     AND m.smtp_status = 'active'
  ) as mailboxes_with_jobs,
  -- Check if condition 1 passes (all eligible mailboxes have jobs)
  CASE 
    WHEN (
      SELECT COUNT(DISTINCT cm.mailbox_id)
      FROM campaign_mailboxes cm
      JOIN mailboxes m ON m.id = cm.mailbox_id
      JOIN message_jobs mj ON mj.mailbox_id = cm.mailbox_id AND mj.interval_id = ci.id
      WHERE cm.campaign_id = '683a9d74-211b-4825-8670-a0fba37be8ac'
        AND m.status = 'connected'
        AND m.smtp_status = 'active'
    ) = (
      SELECT COUNT(*)
      FROM campaign_mailboxes cm
      JOIN mailboxes m ON m.id = cm.mailbox_id
      WHERE cm.campaign_id = '683a9d74-211b-4825-8670-a0fba37be8ac'
        AND m.status = 'connected'
        AND m.smtp_status = 'active'
    )
    THEN 'PASSES'
    ELSE 'FAILS'
  END as condition_1_all_mailboxes_have_jobs,
  -- Check if condition 2 passes (no non-completed jobs)
  CASE 
    WHEN NOT EXISTS (
      SELECT 1
      FROM campaign_mailboxes cm2
      JOIN mailboxes m2 ON m2.id = cm2.mailbox_id
      JOIN message_jobs mj2 ON mj2.mailbox_id = cm2.mailbox_id AND mj2.interval_id = ci.id
      WHERE cm2.campaign_id = '683a9d74-211b-4825-8670-a0fba37be8ac'
        AND m2.status = 'connected'
        AND m2.smtp_status = 'active'
        AND mj2.status NOT IN ('sent', 'failed')
    )
    THEN 'PASSES'
    ELSE 'FAILS'
  END as condition_2_no_non_completed_jobs,
  -- Show non-completed jobs
  (SELECT COUNT(*)
   FROM campaign_mailboxes cm2
   JOIN mailboxes m2 ON m2.id = cm2.mailbox_id
   JOIN message_jobs mj2 ON mj2.mailbox_id = cm2.mailbox_id AND mj2.interval_id = ci.id
   WHERE cm2.campaign_id = '683a9d74-211b-4825-8670-a0fba37be8ac'
     AND m2.status = 'connected'
     AND m2.smtp_status = 'active'
     AND mj2.status NOT IN ('sent', 'failed')
  ) as non_completed_jobs_count
FROM campaign_intervals ci
WHERE ci.campaign_id = '683a9d74-211b-4825-8670-a0fba37be8ac'
  AND ci.status IN ('scheduled', 'completed')
ORDER BY ci.interval_time ASC;

-- Show all jobs for a specific interval to see their statuses
SELECT 
  mj.id as job_id,
  mj.mailbox_id,
  m.email_address as mailbox_email,
  m.status as mailbox_status,
  m.smtp_status as mailbox_smtp_status,
  mj.status as job_status,
  mj.scheduled_at,
  mj.sent_at,
  mj.error_message
FROM message_jobs mj
JOIN mailboxes m ON m.id = mj.mailbox_id
WHERE mj.interval_id = 'be76e7bc-6831-4ea9-b543-f043366a23e3' -- Replace with an interval_id from above
ORDER BY mj.mailbox_id, mj.created_at;

