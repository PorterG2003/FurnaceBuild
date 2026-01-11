-- Diagnostic query to check if intervals are already processed
-- Replace the campaign_id with your actual campaign_id

-- Step 1: Check campaign's last_completed_interval_time
SELECT 
  id,
  name,
  last_completed_interval_time,
  sending_interval_seconds,
  (SELECT COUNT(*) FROM campaign_mailboxes WHERE campaign_id = campaigns.id) as total_mailboxes
FROM campaigns
WHERE id = '683a9d74-211b-4825-8670-a0fba37be8ac'; -- Replace with your campaign_id

-- Step 2: Check all intervals and their processing status
SELECT 
  ci.id as interval_id,
  ci.interval_time,
  ci.status as interval_status,
  ci.locked_at,
  ci.locked_by,
  -- Compare with last_completed_interval_time
  (SELECT last_completed_interval_time FROM campaigns WHERE id = '683a9d74-211b-4825-8670-a0fba37be8ac') as last_processed,
  CASE 
    WHEN (SELECT last_completed_interval_time FROM campaigns WHERE id = '683a9d74-211b-4825-8670-a0fba37be8ac') IS NULL THEN 'NO_PROCESSED_YET'
    WHEN ci.interval_time <= (SELECT last_completed_interval_time FROM campaigns WHERE id = '683a9d74-211b-4825-8670-a0fba37be8ac') THEN 'ALREADY_PROCESSED'
    ELSE 'NOT_PROCESSED'
  END as processed_status,
  -- Job statistics
  COUNT(DISTINCT mj.id) as total_jobs,
  COUNT(DISTINCT mj.mailbox_id) as mailboxes_with_jobs,
  COUNT(DISTINCT mj.mailbox_id) FILTER (WHERE mj.status IN ('sent', 'failed')) as mailboxes_with_completed_jobs,
  (SELECT COUNT(*) FROM campaign_mailboxes WHERE campaign_id = '683a9d74-211b-4825-8670-a0fba37be8ac') as total_mailboxes_required,
  -- Status breakdown
  COUNT(*) FILTER (WHERE mj.status = 'pending') as jobs_pending,
  COUNT(*) FILTER (WHERE mj.status = 'reserved') as jobs_reserved,
  COUNT(*) FILTER (WHERE mj.status = 'sending') as jobs_sending,
  COUNT(*) FILTER (WHERE mj.status = 'sent') as jobs_sent,
  COUNT(*) FILTER (WHERE mj.status = 'failed') as jobs_failed,
  -- Check if should be processed
  CASE 
    WHEN ci.status = 'scheduled'
      AND COUNT(DISTINCT mj.mailbox_id) FILTER (WHERE mj.status IN ('sent', 'failed')) = 
          (SELECT COUNT(*) FROM campaign_mailboxes WHERE campaign_id = '683a9d74-211b-4825-8670-a0fba37be8ac')
      AND (
        (SELECT last_completed_interval_time FROM campaigns WHERE id = '683a9d74-211b-4825-8670-a0fba37be8ac') IS NULL
        OR ci.interval_time > (SELECT last_completed_interval_time FROM campaigns WHERE id = '683a9d74-211b-4825-8670-a0fba37be8ac')
      )
    THEN 'SHOULD_BE_PROCESSED'
    WHEN ci.status = 'completed' THEN 'ALREADY_MARKED_COMPLETED'
    ELSE 'NOT_READY'
  END as should_be_processed
FROM campaign_intervals ci
LEFT JOIN message_jobs mj ON mj.interval_id = ci.id
WHERE ci.campaign_id = '683a9d74-211b-4825-8670-a0fba37be8ac' -- Replace with your campaign_id
GROUP BY ci.id, ci.interval_time, ci.status, ci.locked_at, ci.locked_by
ORDER BY ci.interval_time ASC;

-- Step 3: Detailed view of jobs per interval (to see which mailboxes are missing)
SELECT 
  ci.id as interval_id,
  ci.interval_time,
  ci.status as interval_status,
  mj.mailbox_id,
  m.email_address as mailbox_email,
  mj.status as job_status,
  mj.scheduled_at,
  mj.id as job_id
FROM campaign_intervals ci
LEFT JOIN message_jobs mj ON mj.interval_id = ci.id
LEFT JOIN mailboxes m ON m.id = mj.mailbox_id
WHERE ci.campaign_id = '683a9d74-211b-4825-8670-a0fba37be8ac' -- Replace with your campaign_id
  AND ci.status IN ('scheduled', 'completed') -- Only show intervals with jobs
ORDER BY ci.interval_time ASC, mj.mailbox_id ASC;

-- Step 4: Find mailboxes that don't have jobs in each interval (if any)
WITH campaign_mailboxes_list AS (
  SELECT mailbox_id
  FROM campaign_mailboxes
  WHERE campaign_id = '683a9d74-211b-4825-8670-a0fba37be8ac'
),
interval_mailboxes AS (
  SELECT 
    ci.id as interval_id,
    ci.interval_time,
    mj.mailbox_id
  FROM campaign_intervals ci
  INNER JOIN message_jobs mj ON mj.interval_id = ci.id
  WHERE ci.campaign_id = '683a9d74-211b-4825-8670-a0fba37be8ac'
    AND ci.status = 'scheduled'
)
SELECT 
  ci.id as interval_id,
  ci.interval_time,
  cm.mailbox_id as missing_mailbox,
  m.email_address as missing_mailbox_email
FROM campaign_intervals ci
CROSS JOIN campaign_mailboxes_list cm
LEFT JOIN mailboxes m ON m.id = cm.mailbox_id
WHERE ci.campaign_id = '683a9d74-211b-4825-8670-a0fba37be8ac'
  AND ci.status = 'scheduled'
  AND NOT EXISTS (
    SELECT 1 
    FROM interval_mailboxes im
    WHERE im.interval_id = ci.id
      AND im.mailbox_id = cm.mailbox_id
  )
ORDER BY ci.interval_time ASC, cm.mailbox_id ASC;

-- Step 5: Test the check_and_update_processed_intervals function logic directly
-- This shows which intervals WOULD be marked as processed
SELECT 
  ci.id as interval_id,
  ci.interval_time,
  ci.status,
  COUNT(DISTINCT mj.mailbox_id) FILTER (
    WHERE mj.status IN ('sent', 'failed')
  ) as completed_mailboxes,
  (SELECT COUNT(*) FROM campaign_mailboxes WHERE campaign_id = '683a9d74-211b-4825-8670-a0fba37be8ac') as total_mailboxes,
  CASE 
    WHEN COUNT(DISTINCT mj.mailbox_id) FILTER (
      WHERE mj.status IN ('sent', 'failed')
    ) = (SELECT COUNT(*) FROM campaign_mailboxes WHERE campaign_id = '683a9d74-211b-4825-8670-a0fba37be8ac')
    THEN 'SHOULD_BE_PROCESSED'
    ELSE 'NOT_READY'
  END as processing_status
FROM campaign_intervals ci
INNER JOIN message_jobs mj ON mj.interval_id = ci.id
WHERE ci.campaign_id = '683a9d74-211b-4825-8670-a0fba37be8ac'
  AND ci.status = 'scheduled'
  AND (
    (SELECT last_completed_interval_time FROM campaigns WHERE id = '683a9d74-211b-4825-8670-a0fba37be8ac') IS NULL
    OR ci.interval_time > (SELECT last_completed_interval_time FROM campaigns WHERE id = '683a9d74-211b-4825-8670-a0fba37be8ac')
  )
GROUP BY ci.id, ci.interval_time, ci.status
HAVING COUNT(DISTINCT mj.mailbox_id) FILTER (
  WHERE mj.status IN ('sent', 'failed')
) = (SELECT COUNT(*) FROM campaign_mailboxes WHERE campaign_id = '683a9d74-211b-4825-8670-a0fba37be8ac')
ORDER BY ci.interval_time ASC;

