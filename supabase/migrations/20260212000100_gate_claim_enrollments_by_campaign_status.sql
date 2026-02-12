-- ============================================
-- Migration: Gate claim_enrollments_ready by campaign status
-- ============================================
-- Only claim enrollments for campaigns that are currently running.

CREATE OR REPLACE FUNCTION claim_enrollments_ready(
  p_batch_size INTEGER DEFAULT 100,
  p_processing_timeout_minutes INTEGER DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  campaign_id UUID,
  lead_id UUID,
  current_node_id UUID,
  state TEXT,
  next_run_at TIMESTAMPTZ,
  flow_position JSONB,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
) AS $$
DECLARE
  v_claimed_ids UUID[];
BEGIN
  SELECT ARRAY_AGG(subq.id)
  INTO v_claimed_ids
  FROM (
    SELECT enrollments.id
    FROM enrollments
    WHERE enrollments.state = 'active'
      AND enrollments.next_run_at <= NOW()
      AND EXISTS (
        SELECT 1
        FROM campaigns
        WHERE campaigns.id = enrollments.campaign_id
          AND campaigns.status = 'running'
      )
    ORDER BY enrollments.next_run_at ASC
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  ) subq;

  IF v_claimed_ids IS NULL OR array_length(v_claimed_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH updated_enrollments AS (
    UPDATE enrollments
    SET next_run_at = NOW() + (p_processing_timeout_minutes || ' minutes')::INTERVAL,
        updated_at = NOW()
    WHERE enrollments.id = ANY(v_claimed_ids)
      AND enrollments.state = 'active'
      AND enrollments.next_run_at <= NOW()
      AND EXISTS (
        SELECT 1
        FROM campaigns
        WHERE campaigns.id = enrollments.campaign_id
          AND campaigns.status = 'running'
      )
    RETURNING
      enrollments.id,
      enrollments.campaign_id,
      enrollments.lead_id,
      enrollments.current_node_id,
      enrollments.state,
      enrollments.next_run_at,
      enrollments.flow_position,
      enrollments.created_at,
      enrollments.updated_at
  )
  SELECT
    updated_enrollments.id,
    updated_enrollments.campaign_id,
    updated_enrollments.lead_id,
    updated_enrollments.current_node_id,
    updated_enrollments.state,
    updated_enrollments.next_run_at,
    updated_enrollments.flow_position,
    updated_enrollments.created_at,
    updated_enrollments.updated_at
  FROM updated_enrollments;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION claim_enrollments_ready IS
  'Atomically claims enrollments ready to process for running campaigns only. Uses UPDATE-based claiming to avoid duplicates.';
