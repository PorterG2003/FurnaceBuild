-- ============================================
-- Migration: Add poll_enrollments_ready function with row-level locking
-- ============================================
-- This migration adds a PostgreSQL function that polls enrollments ready to process
-- using SELECT FOR UPDATE SKIP LOCKED to prevent race conditions when multiple
-- scheduler workers are running simultaneously.
--
-- The function ensures that:
-- 1. Only one worker can process a given enrollment at a time
-- 2. Multiple workers can process different enrollments in parallel
-- 3. No duplicate message jobs are created

CREATE OR REPLACE FUNCTION poll_enrollments_ready(
  p_batch_size INTEGER DEFAULT 100
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
BEGIN
  RETURN QUERY
  SELECT 
    e.id,
    e.campaign_id,
    e.lead_id,
    e.current_node_id,
    e.state,
    e.next_run_at,
    e.flow_position,
    e.created_at,
    e.updated_at
  FROM enrollments e
  WHERE e.state = 'active'
    AND e.next_run_at <= NOW()
  ORDER BY e.next_run_at ASC
  LIMIT p_batch_size
  FOR UPDATE SKIP LOCKED; -- Prevents multiple workers from picking same enrollment
  
  -- Note: FOR UPDATE SKIP LOCKED ensures:
  -- - First worker locks the row (prevents other workers from seeing it)
  -- - Other workers skip locked rows (automatically move to next available enrollment)
  -- - Locks are automatically released when transaction commits/rolls back
  -- - If worker crashes, lock is released when connection closes
END;
$$ LANGUAGE plpgsql;

-- Add comment
COMMENT ON FUNCTION poll_enrollments_ready IS 'Polls enrollments ready to process with row-level locking to prevent race conditions. Returns up to p_batch_size enrollments that are active and ready (next_run_at <= NOW()). Uses FOR UPDATE SKIP LOCKED to ensure only one worker processes each enrollment.';

