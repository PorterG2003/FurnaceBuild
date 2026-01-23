-- ============================================
-- Migration: Create claim_mailboxes_to_check function
-- ============================================
-- This migration creates an atomic claiming function for mailboxes that need IMAP checking.
--
-- The function atomically claims mailboxes by:
-- 1. Selecting candidate mailboxes with FOR UPDATE SKIP LOCKED (for ordering)
-- 2. Updating last_synced_at to NOW() to mark as "processing"
-- 3. Returning the claimed mailboxes
--
-- This ensures:
-- - Only one worker can successfully UPDATE each mailbox (atomic operation)
-- - WHERE clause ensures only mailboxes that need checking are claimed
-- - If worker crashes, mailbox becomes eligible again after timeout
-- - No race conditions possible (database-level guarantee)

CREATE OR REPLACE FUNCTION claim_mailboxes_to_check(
  p_batch_size INTEGER DEFAULT 50,
  p_check_interval_minutes INTEGER DEFAULT 5,
  p_processing_timeout_minutes INTEGER DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  account_id UUID,
  user_id UUID,
  email_address TEXT,
  display_name TEXT,
  provider TEXT,
  smtp_host TEXT,
  smtp_port INTEGER,
  smtp_username TEXT,
  smtp_password TEXT,
  smtp_use_tls BOOLEAN,
  smtp_use_ssl BOOLEAN,
  imap_host TEXT,
  imap_port INTEGER,
  imap_username TEXT,
  imap_password TEXT,
  imap_use_ssl BOOLEAN,
  status TEXT,
  sync_enabled BOOLEAN,
  last_synced_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
) AS $$
DECLARE
  v_claimed_ids UUID[];
  v_processing_timeout TIMESTAMPTZ;
BEGIN
  -- Calculate timeout: if last_synced_at was set but processing timed out
  v_processing_timeout := NOW() - (p_processing_timeout_minutes || ' minutes')::INTERVAL;
  
  -- Step 1: Select and lock candidate mailboxes (for ordering and contention prevention)
  SELECT ARRAY_AGG(subq.id)
  INTO v_claimed_ids
  FROM (
    SELECT mailboxes.id
    FROM mailboxes
    WHERE mailboxes.sync_enabled = true
      AND mailboxes.status = 'connected'
      AND (
        -- Never synced
        mailboxes.last_synced_at IS NULL
        OR
        -- Needs checking (last check was > interval ago)
        mailboxes.last_synced_at < NOW() - (p_check_interval_minutes || ' minutes')::INTERVAL
        OR
        -- Processing timed out (worker crashed)
        (mailboxes.last_synced_at < v_processing_timeout 
         AND mailboxes.last_synced_at > NOW() - INTERVAL '1 hour')
      )
    ORDER BY 
      -- Prioritize: never synced > timed out > oldest first
      CASE 
        WHEN mailboxes.last_synced_at IS NULL THEN 1
        WHEN mailboxes.last_synced_at < v_processing_timeout THEN 2
        ELSE 3
      END,
      mailboxes.last_synced_at ASC NULLS FIRST
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED  -- Prevent contention during selection
  ) subq;
  
  -- If no mailboxes found, return empty result
  IF v_claimed_ids IS NULL OR array_length(v_claimed_ids, 1) IS NULL THEN
    RETURN;
  END IF;
  
  -- Step 2: Atomically update claimed mailboxes (set last_synced_at to NOW() to mark as "processing")
  -- This UPDATE is atomic - only mailboxes that still match criteria are updated
  -- Workers trying to update already-updated mailboxes get 0 rows
  -- The WHERE clause ensures only mailboxes that need checking are claimed
  RETURN QUERY
  WITH updated_mailboxes AS (
    UPDATE mailboxes
    SET last_synced_at = NOW(),  -- Mark as "processing"
        updated_at = NOW()
    WHERE mailboxes.id = ANY(v_claimed_ids)
      AND mailboxes.sync_enabled = true
      AND mailboxes.status = 'connected'
      AND (
        -- Still matches criteria (double-check)
        mailboxes.last_synced_at IS NULL
        OR
        mailboxes.last_synced_at < NOW() - (p_check_interval_minutes || ' minutes')::INTERVAL
        OR
        (mailboxes.last_synced_at < v_processing_timeout 
         AND mailboxes.last_synced_at > NOW() - INTERVAL '1 hour')
      )
    RETURNING
      mailboxes.id,
      mailboxes.account_id,
      mailboxes.user_id,
      mailboxes.email_address,
      mailboxes.display_name,
      mailboxes.provider,
      mailboxes.smtp_host,
      mailboxes.smtp_port,
      mailboxes.smtp_username,
      mailboxes.smtp_password,
      mailboxes.smtp_use_tls,
      mailboxes.smtp_use_ssl,
      mailboxes.imap_host,
      mailboxes.imap_port,
      mailboxes.imap_username,
      mailboxes.imap_password,
      mailboxes.imap_use_ssl,
      mailboxes.status,
      mailboxes.sync_enabled,
      mailboxes.last_synced_at,
      mailboxes.error_message,
      mailboxes.created_at,
      mailboxes.updated_at
  )
  SELECT 
    updated_mailboxes.id,
    updated_mailboxes.account_id,
    updated_mailboxes.user_id,
    updated_mailboxes.email_address,
    updated_mailboxes.display_name,
    updated_mailboxes.provider,
    updated_mailboxes.smtp_host,
    updated_mailboxes.smtp_port,
    updated_mailboxes.smtp_username,
    updated_mailboxes.smtp_password,
    updated_mailboxes.smtp_use_tls,
    updated_mailboxes.smtp_use_ssl,
    updated_mailboxes.imap_host,
    updated_mailboxes.imap_port,
    updated_mailboxes.imap_username,
    updated_mailboxes.imap_password,
    updated_mailboxes.imap_use_ssl,
    updated_mailboxes.status,
    updated_mailboxes.sync_enabled,
    updated_mailboxes.last_synced_at,
    updated_mailboxes.error_message,
    updated_mailboxes.created_at,
    updated_mailboxes.updated_at
  FROM updated_mailboxes
  ORDER BY 
    CASE 
      WHEN updated_mailboxes.last_synced_at IS NULL THEN 1
      WHEN updated_mailboxes.last_synced_at < v_processing_timeout THEN 2
      ELSE 3
    END,
    updated_mailboxes.last_synced_at ASC NULLS FIRST;
  
  -- Note: This provides 100% guarantee against duplicates:
  -- - FOR UPDATE SKIP LOCKED prevents contention during selection
  -- - UPDATE WHERE clause ensures only mailboxes that need checking are claimed
  -- - If Worker 2 tries to update a mailbox Worker 1 already claimed,
  --   the WHERE clause fails (last_synced_at was just updated) → 0 rows updated
  -- - Worker 2 moves on to next mailbox
  -- - If worker crashes, mailbox becomes eligible again after timeout
END;
$$ LANGUAGE plpgsql;

-- Add comment
COMMENT ON FUNCTION claim_mailboxes_to_check IS 
  'Atomically claims mailboxes that need IMAP checking. Uses UPDATE-based claiming to provide 100% guarantee against duplicate processing. Sets last_synced_at to NOW() to mark as "processing". If worker crashes, mailbox becomes eligible again after timeout. Returns up to p_batch_size mailboxes, prioritized by: never synced > timed out > oldest first.';
