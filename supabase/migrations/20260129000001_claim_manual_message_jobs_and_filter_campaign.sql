-- ============================================
-- Migration: Claim manual (inbox) jobs first; campaign claim only campaign jobs
-- ============================================
-- Manual sends (replies, forwards) take priority. Worker calls
-- claim_manual_message_jobs_ready first, then claim_message_jobs_ready.
-- Campaign claim only claims message_type = 'campaign' (or NULL for backward compat).

-- ============================================
-- 1. claim_manual_message_jobs_ready: claims inbox_reply and inbox_forward only
-- ============================================
CREATE OR REPLACE FUNCTION claim_manual_message_jobs_ready(
  p_batch_size INTEGER DEFAULT 50,
  p_processing_timeout_minutes INTEGER DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  enrollment_id UUID,
  campaign_id UUID,
  lead_id UUID,
  mailbox_id UUID,
  node_id UUID,
  message_type TEXT,
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
  SELECT ARRAY_AGG(subq.id)
  INTO v_claimed_ids
  FROM (
    SELECT message_jobs.id
    FROM message_jobs
    WHERE message_jobs.status = 'pending'
      AND message_jobs.scheduled_at <= NOW()
      AND message_jobs.message_type IN ('inbox_reply', 'inbox_forward')
    ORDER BY message_jobs.scheduled_at ASC
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  ) subq;

  IF v_claimed_ids IS NULL OR array_length(v_claimed_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH updated_jobs AS (
    UPDATE message_jobs
    SET status = 'reserved',
        reserved_at = NOW(),
        updated_at = NOW()
    WHERE message_jobs.id = ANY(v_claimed_ids)
      AND message_jobs.status = 'pending'
      AND message_jobs.scheduled_at <= NOW()
      AND message_jobs.message_type IN ('inbox_reply', 'inbox_forward')
    RETURNING
      message_jobs.id,
      message_jobs.enrollment_id,
      message_jobs.campaign_id,
      message_jobs.lead_id,
      message_jobs.mailbox_id,
      message_jobs.node_id,
      message_jobs.message_type,
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
    updated_jobs.message_type,
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
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION claim_manual_message_jobs_ready IS
  'Claims manual (inbox_reply, inbox_forward) message jobs ready to send. Call this before claim_message_jobs_ready so manual sends take priority.';

-- ============================================
-- 2. claim_message_jobs_ready: only claim campaign jobs (exclude manual)
-- ============================================
-- Must DROP first because return type changed (added message_type); PostgreSQL
-- does not allow changing return type with CREATE OR REPLACE.
DROP FUNCTION IF EXISTS claim_message_jobs_ready(INTEGER, INTEGER);

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
  message_type TEXT,
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
  SELECT ARRAY_AGG(subq.id)
  INTO v_claimed_ids
  FROM (
    SELECT message_jobs.id
    FROM message_jobs
    WHERE message_jobs.status = 'pending'
      AND message_jobs.scheduled_at <= NOW()
      AND (message_jobs.message_type = 'campaign' OR message_jobs.message_type IS NULL)
    ORDER BY message_jobs.scheduled_at ASC
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  ) subq;

  IF v_claimed_ids IS NULL OR array_length(v_claimed_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH updated_jobs AS (
    UPDATE message_jobs
    SET status = 'reserved',
        reserved_at = NOW(),
        updated_at = NOW()
    WHERE message_jobs.id = ANY(v_claimed_ids)
      AND message_jobs.status = 'pending'
      AND message_jobs.scheduled_at <= NOW()
      AND (message_jobs.message_type = 'campaign' OR message_jobs.message_type IS NULL)
    RETURNING
      message_jobs.id,
      message_jobs.enrollment_id,
      message_jobs.campaign_id,
      message_jobs.lead_id,
      message_jobs.mailbox_id,
      message_jobs.node_id,
      message_jobs.message_type,
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
    updated_jobs.message_type,
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
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION claim_message_jobs_ready IS
  'Atomically claims campaign message jobs ready to send. Manual (inbox) jobs are claimed via claim_manual_message_jobs_ready first.';
