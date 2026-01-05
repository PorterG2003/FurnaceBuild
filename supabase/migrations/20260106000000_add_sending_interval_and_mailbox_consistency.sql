-- ============================================
-- Migration: Add Sending Interval and Mailbox Consistency
-- ============================================
-- This migration adds:
-- 1. sending_interval_seconds to campaigns table
-- 2. mailbox_id to leads table
-- 3. create_message_job_if_slot_available function for atomic slot-based job creation

-- ============================================
-- 1. ADD sending_interval_seconds TO campaigns
-- ============================================

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS sending_interval_seconds INTEGER NOT NULL DEFAULT 300;

-- Add constraint: interval must be positive
ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS campaigns_sending_interval_check;
ALTER TABLE campaigns ADD CONSTRAINT campaigns_sending_interval_check 
  CHECK (sending_interval_seconds > 0);

-- Add comment
COMMENT ON COLUMN campaigns.sending_interval_seconds IS 'Interval between sends per mailbox (seconds). Campaign with 3 mailboxes and 300s interval = 3 messages every 5 minutes (one per mailbox). Default: 300 (5 minutes).';

-- ============================================
-- 2. ADD mailbox_id TO leads
-- ============================================

ALTER TABLE leads ADD COLUMN IF NOT EXISTS mailbox_id UUID REFERENCES mailboxes(id);

-- Add index for fast lookups
CREATE INDEX IF NOT EXISTS idx_leads_mailbox_id ON leads(mailbox_id);

-- Add comment
COMMENT ON COLUMN leads.mailbox_id IS 'Mailbox assigned to this lead for this campaign. Set on first email node via round-robin. Must remain consistent for all subsequent email nodes. NULL before first email node is processed.';

-- ============================================
-- 3. CREATE FUNCTION: create_message_job_if_slot_available
-- ============================================
-- Atomically ensures only one message_job per mailbox per interval slot
-- Rounds scheduled_at to slot boundary and checks for existing job
-- Returns existing job if slot is taken, creates new job if slot is available

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
  SELECT id INTO v_existing_job_id
  FROM message_jobs
  WHERE mailbox_id = p_mailbox_id
    AND campaign_id = p_campaign_id
    AND scheduled_at >= v_slot_time - (v_tolerance_seconds || ' seconds')::INTERVAL
    AND scheduled_at <= v_slot_time + (v_tolerance_seconds || ' seconds')::INTERVAL
    AND status IN ('pending', 'reserved', 'sending') -- Only count active jobs
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
  RETURN QUERY
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
    message_jobs.id,
    message_jobs.enrollment_id,
    message_jobs.campaign_id,
    message_jobs.lead_id,
    message_jobs.mailbox_id,
    message_jobs.node_id,
    message_jobs.status,
    message_jobs.scheduled_at,
    message_jobs.message_data,
    message_jobs.created_at,
    message_jobs.updated_at,
    true AS is_new_job;
END;
$$ LANGUAGE plpgsql;

-- Add comment
COMMENT ON FUNCTION create_message_job_if_slot_available IS 'Atomically ensures only one message_job per mailbox per interval slot. Rounds scheduled_at to slot boundary and checks for existing job. Returns existing job if slot is taken, creates new job if slot is available.';

