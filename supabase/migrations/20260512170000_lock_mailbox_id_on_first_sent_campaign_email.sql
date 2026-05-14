-- Reinterpret leads.mailbox_id as the locked mailbox chosen by the first
-- successfully sent campaign email. Before first send, the column should remain NULL.

COMMENT ON COLUMN public.leads.mailbox_id IS
  'Locked mailbox for this lead within its campaign after the first successfully sent campaign email. NULL means no campaign email has been successfully sent yet.';

WITH first_sent_campaign_job AS (
  SELECT DISTINCT ON (mj.lead_id)
    mj.lead_id,
    mj.mailbox_id
  FROM public.message_jobs mj
  WHERE mj.status = 'sent'
    AND (mj.message_type = 'campaign' OR mj.message_type IS NULL)
    AND mj.mailbox_id IS NOT NULL
  ORDER BY
    mj.lead_id,
    COALESCE(mj.sent_at, mj.created_at) ASC,
    mj.created_at ASC,
    mj.id ASC
)
UPDATE public.leads l
SET mailbox_id = first_sent_campaign_job.mailbox_id
FROM first_sent_campaign_job
WHERE l.id = first_sent_campaign_job.lead_id
  AND l.mailbox_id IS DISTINCT FROM first_sent_campaign_job.mailbox_id;

UPDATE public.leads l
SET mailbox_id = NULL
WHERE l.mailbox_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.message_jobs mj
    WHERE mj.lead_id = l.id
      AND mj.status = 'sent'
      AND (mj.message_type = 'campaign' OR mj.message_type IS NULL)
  );
