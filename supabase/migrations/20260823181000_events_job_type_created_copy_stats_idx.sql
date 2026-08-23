-- Nested-loop copy stats from stamped jobs needs a range on
-- (message_job_id, event_type, created_at). Bare message_job_id forces a heap
-- fetch of every event for that job (opens, clicks, etc.) then filters.

CREATE INDEX IF NOT EXISTS idx_events_job_id_type_created
  ON public.events (message_job_id, event_type, created_at)
  INCLUDE (campaign_id)
  WHERE event_type IN ('sent', 'replied', 'bounced')
    AND message_job_id IS NOT NULL;
