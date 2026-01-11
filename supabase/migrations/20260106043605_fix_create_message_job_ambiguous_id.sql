-- ============================================
-- Migration: Fix ambiguous column reference in create_message_job_if_slot_available
-- ============================================
-- Fixes: "column reference 'id' is ambiguous" error
-- Issue: SELECT id INTO was ambiguous because function RETURNS TABLE also defines 'id'
-- Solution: Qualify column references with table name

CREATE OR REPLACE FUNCTION create_message_job_if_slot_available(
  p_enrollment_id UUID,
  p_campaign_id UUID,
  p_lead_id UUID,
  p_mailbox_id UUID,
  p_node_id UUID,
  p_scheduled_at TIMESTAMPTZ,
  p_message_data JSONB,
  p_campaign_interval_seconds INTEGER
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
  message_data JSONB,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  is_new_job BOOLEAN
) AS $$
DECLARE
  v_slot_time TIMESTAMPTZ;
  v_existing_job_id UUID;
  v_tolerance_seconds INTEGER;
BEGIN
  -- Step 1: Round scheduled_at to slot boundary
  -- Formula: roundDown(scheduled_at / interval) * interval
  -- This ensures all jobs in the same slot have the same slot_time
  v_slot_time := to_timestamp(
    floor(extract(epoch from p_scheduled_at) / p_campaign_interval_seconds) * p_campaign_interval_seconds
  );
  
  -- Step 2: Define tolerance window (1 second) to account for jitter
  -- Jobs scheduled within tolerance of slot_time are considered the same slot
  v_tolerance_seconds := 1;
  
  -- Step 3: Check if message_job already exists for this mailbox at this slot
  -- Look for jobs with scheduled_at within tolerance of slot_time
  -- FIX: Qualify column references to avoid ambiguity with RETURNS TABLE columns
  SELECT message_jobs.id INTO v_existing_job_id
  FROM message_jobs
  WHERE message_jobs.mailbox_id = p_mailbox_id
    AND message_jobs.campaign_id = p_campaign_id
    AND message_jobs.scheduled_at >= v_slot_time - (v_tolerance_seconds || ' seconds')::INTERVAL
    AND message_jobs.scheduled_at <= v_slot_time + (v_tolerance_seconds || ' seconds')::INTERVAL
    AND message_jobs.status IN ('pending', 'reserved', 'sending') -- Only count active jobs
  LIMIT 1
  FOR UPDATE SKIP LOCKED; -- Prevent concurrent checks from seeing the same slot
  
  -- Step 4: If slot is taken, return existing job
  IF v_existing_job_id IS NOT NULL THEN
    RETURN QUERY
    SELECT 
      mj.id,
      mj.enrollment_id,
      mj.campaign_id,
      mj.lead_id,
      mj.mailbox_id,
      mj.node_id,
      mj.status,
      mj.scheduled_at,
      mj.message_data,
      mj.created_at,
      mj.updated_at,
      false AS is_new_job
    FROM message_jobs mj
    WHERE mj.id = v_existing_job_id;
    RETURN;
  END IF;
  
  -- Step 5: Slot is available - insert new message_job
  -- Use the rounded slot_time as scheduled_at (ensures consistency)
  -- Use CTE to avoid ambiguity with RETURNS TABLE column names
  RETURN QUERY
  WITH inserted_job AS (
    INSERT INTO message_jobs (
      enrollment_id,
      campaign_id,
      lead_id,
      mailbox_id,
      node_id,
      status,
      scheduled_at,
      message_data
    )
    VALUES (
      p_enrollment_id,
      p_campaign_id,
      p_lead_id,
      p_mailbox_id,
      p_node_id,
      'pending',
      v_slot_time, -- Use rounded slot_time, not original scheduled_at
      p_message_data
    )
    RETURNING
      id,
      enrollment_id,
      campaign_id,
      lead_id,
      mailbox_id,
      node_id,
      status,
      scheduled_at,
      message_data,
      created_at,
      updated_at
  )
  SELECT 
    ij.id,
    ij.enrollment_id,
    ij.campaign_id,
    ij.lead_id,
    ij.mailbox_id,
    ij.node_id,
    ij.status,
    ij.scheduled_at,
    ij.message_data,
    ij.created_at,
    ij.updated_at,
    true AS is_new_job
  FROM inserted_job ij;
END;
$$ LANGUAGE plpgsql;

-- Add comment
COMMENT ON FUNCTION create_message_job_if_slot_available IS 'Atomically ensures only one message_job per mailbox per interval slot. Rounds scheduled_at to slot boundary and checks for existing job. Returns existing job if slot is taken, creates new job if slot is available. Fixed ambiguous column reference issue.';

