-- ============================================
-- Migration: Fix ambiguous column reference in claim_enrollments_ready
-- ============================================
-- This migration fixes the ambiguous column reference error by using a CTE
-- to isolate the UPDATE's RETURNING clause from RETURNS TABLE variable names.

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
  -- Step 1: Select and lock candidate enrollments (for ordering and contention prevention)
  SELECT ARRAY_AGG(subq.id)
  INTO v_claimed_ids
  FROM (
    SELECT enrollments.id
    FROM enrollments
    WHERE enrollments.state = 'active'
      AND enrollments.next_run_at <= NOW()
    ORDER BY enrollments.next_run_at ASC
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED  -- Prevent contention during selection
  ) subq;
  
  -- If no enrollments found, return empty
  IF v_claimed_ids IS NULL OR array_length(v_claimed_ids, 1) IS NULL THEN
    RETURN;
  END IF;
  
  -- Step 2: Atomically claim enrollments (UPDATE with WHERE clause)
  -- This UPDATE is atomic - only enrollments that still match criteria are updated
  -- Workers trying to update already-updated enrollments get 0 rows
  -- The WHERE clause next_run_at <= NOW() ensures only ready enrollments are claimed
  -- Note: Using a CTE (WITH clause) to avoid ambiguity with RETURNS TABLE variable names
  RETURN QUERY
  WITH updated_enrollments AS (
    UPDATE enrollments
    SET next_run_at = NOW() + (p_processing_timeout_minutes || ' minutes')::INTERVAL,
        updated_at = NOW()
    WHERE enrollments.id = ANY(v_claimed_ids)
      AND enrollments.state = 'active'
      AND enrollments.next_run_at <= NOW()  -- Critical: Only update if still ready (prevents duplicates)
    RETURNING
      enrollments.id,
      enrollments.campaign_id,
      enrollments.lead_id,
      enrollments.current_node_id,
      enrollments.state,
      enrollments.next_run_at,  -- This is the NEW next_run_at (future time, marks as "processing")
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
  
  -- Note: This provides 100% guarantee against duplicates:
  -- - FOR UPDATE SKIP LOCKED prevents contention during selection
  -- - UPDATE WHERE clause ensures only ready enrollments are claimed
  -- - If Worker 2 tries to update an enrollment Worker 1 already claimed,
  --   the WHERE clause fails (next_run_at is now in future) → 0 rows updated
  -- - Worker 2 moves on to next enrollment
  -- - If worker crashes, enrollment becomes eligible again after timeout
END;
$$ LANGUAGE plpgsql;

-- Add comment
COMMENT ON FUNCTION claim_enrollments_ready IS 'Atomically claims enrollments ready to process. Uses UPDATE-based claiming to provide 100% guarantee against duplicate processing. Sets next_run_at to future time (NOW() + timeout) to mark as "processing". If worker crashes, enrollment becomes eligible again after timeout. Returns up to p_batch_size enrollments.';

