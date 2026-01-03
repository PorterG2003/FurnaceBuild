-- ============================================
-- Migration: Create claim_message_jobs_ready function
-- ============================================
-- This migration creates an atomic database polling function for message jobs,
-- replacing SQS queue-based processing with direct database polling.
--
-- The function atomically claims message jobs by:
-- 1. Selecting candidate jobs with FOR UPDATE SKIP LOCKED (for ordering)
-- 2. Updating them to mark as "reserved" (sets status to 'reserved' and reserved_at)
-- 3. Returning the claimed jobs
--
-- This ensures:
-- - Only one worker can successfully UPDATE each job (atomic operation)
-- - WHERE clause ensures only ready jobs are claimed (status = 'pending' AND scheduled_at <= NOW())
-- - If worker crashes, jobs can be reset after timeout (based on reserved_at)
-- - No race conditions possible (database-level guarantee)

CREATE OR REPLACE FUNCTION claim_message_jobs_ready(
  p_batch_size INTEGER DEFAULT 100,
  p_processing_timeout_minutes INTEGER DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  enrollment_id UUID,
  campaign_id UUID,
  lead_id UUID,
  mailbox_id UUID,
  node_id UUID,
  status TEXT,
  scheduled_at TIMESTAMPTZ,
  reserved_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  provider_message_id TEXT,
  error_message TEXT,
  retry_count INTEGER,
  max_retries INTEGER,
  message_data JSONB,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
) AS $$
DECLARE
  v_claimed_ids UUID[];
BEGIN
  -- Step 1: Select and lock candidate message jobs (for ordering and contention prevention)
  SELECT ARRAY_AGG(subq.id)
  INTO v_claimed_ids
  FROM (
    SELECT message_jobs.id
    FROM message_jobs
    WHERE message_jobs.status = 'pending'
      AND message_jobs.scheduled_at <= NOW()
    ORDER BY message_jobs.scheduled_at ASC
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED  -- Prevent contention during selection
  ) subq;
  
  -- If no jobs found, return empty result
  IF v_claimed_ids IS NULL OR array_length(v_claimed_ids, 1) IS NULL THEN
    RETURN;
  END IF;
  
  -- Step 2: Atomically update claimed jobs (set status to 'reserved' and reserved_at)
  -- This UPDATE is atomic - only jobs that still match criteria are updated
  -- Workers trying to update already-updated jobs get 0 rows
  -- The WHERE clause ensures only ready jobs are claimed
  -- Note: Using a CTE (WITH clause) to avoid ambiguity with RETURNS TABLE variable names
  RETURN QUERY
  WITH updated_jobs AS (
    UPDATE message_jobs
    SET status = 'reserved',
        reserved_at = NOW(),
        updated_at = NOW()
    WHERE message_jobs.id = ANY(v_claimed_ids)
      AND message_jobs.status = 'pending'
      AND message_jobs.scheduled_at <= NOW()  -- Critical: Only update if still ready (prevents duplicates)
    RETURNING
      message_jobs.id,
      message_jobs.enrollment_id,
      message_jobs.campaign_id,
      message_jobs.lead_id,
      message_jobs.mailbox_id,
      message_jobs.node_id,
      message_jobs.status,
      message_jobs.scheduled_at,
      message_jobs.reserved_at,
      message_jobs.sent_at,
      message_jobs.provider_message_id,
      message_jobs.error_message,
      message_jobs.retry_count,
      message_jobs.max_retries,
      message_jobs.message_data,
      message_jobs.created_at,
      message_jobs.updated_at
  )
  SELECT 
    updated_jobs.id,
    updated_jobs.enrollment_id,
    updated_jobs.campaign_id,
    updated_jobs.lead_id,
    updated_jobs.mailbox_id,
    updated_jobs.node_id,
    updated_jobs.status,
    updated_jobs.scheduled_at,
    updated_jobs.reserved_at,
    updated_jobs.sent_at,
    updated_jobs.provider_message_id,
    updated_jobs.error_message,
    updated_jobs.retry_count,
    updated_jobs.max_retries,
    updated_jobs.message_data,
    updated_jobs.created_at,
    updated_jobs.updated_at
  FROM updated_jobs
  ORDER BY updated_jobs.scheduled_at ASC;
  
  -- Note: This provides 100% guarantee against duplicates:
  -- - FOR UPDATE SKIP LOCKED prevents contention during selection
  -- - UPDATE WHERE clause ensures only ready jobs are claimed
  -- - If Worker 2 tries to update a job Worker 1 already claimed,
  --   the WHERE clause fails (status is now 'reserved') → 0 rows updated
  -- - Worker 2 moves on to next job
  -- - If worker crashes, job can be reset to 'pending' after timeout (based on reserved_at)
END;
$$ LANGUAGE plpgsql;

-- Add comment
COMMENT ON FUNCTION claim_message_jobs_ready IS 
  'Atomically claims message jobs ready to send. Uses UPDATE-based claiming to provide 100% guarantee against duplicate processing. Sets status to reserved and reserved_at timestamp. If worker crashes, jobs can be reset after timeout. Returns up to p_batch_size jobs ordered by scheduled_at.';

