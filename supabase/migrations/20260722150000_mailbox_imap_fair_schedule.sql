-- Fair IMAP schedule: attempt completion always advances imap_next_check_at so
-- transient failures cannot monopolize claim_mailboxes_to_check.

ALTER TABLE public.mailboxes
  ADD COLUMN IF NOT EXISTS imap_next_check_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS imap_last_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS imap_consecutive_failures INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS imap_last_error_code TEXT;

COMMENT ON COLUMN public.mailboxes.imap_next_check_at IS
  'When this mailbox is next due for hot-path IMAP check. Advanced on both success and failure.';
COMMENT ON COLUMN public.mailboxes.imap_last_attempt_at IS
  'Timestamp of the most recent hot-path IMAP attempt (success or failure).';
COMMENT ON COLUMN public.mailboxes.imap_consecutive_failures IS
  'Consecutive failed hot-path IMAP attempts since last success.';
COMMENT ON COLUMN public.mailboxes.imap_last_error_code IS
  'Normalized infra/auth error code from the last failed IMAP attempt.';

UPDATE public.mailboxes
SET imap_next_check_at = COALESCE(last_synced_at, created_at)
WHERE imap_next_check_at IS NULL
  AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_mailboxes_imap_next_check_ready
  ON public.mailboxes (imap_next_check_at ASC NULLS FIRST, imap_claimed_at, id)
  WHERE deleted_at IS NULL
    AND status = 'connected';

DROP FUNCTION IF EXISTS claim_mailboxes_to_check(INTEGER, INTEGER, INTEGER);

CREATE FUNCTION claim_mailboxes_to_check(
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
  last_synced_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  imap_next_check_at TIMESTAMPTZ,
  imap_last_attempt_at TIMESTAMPTZ,
  imap_consecutive_failures INTEGER,
  imap_last_error_code TEXT
) AS $$
DECLARE
  v_processing_timeout TIMESTAMPTZ;
BEGIN
  -- p_check_interval_minutes retained for API compatibility; schedule is driven by imap_next_check_at.
  v_processing_timeout := NOW() - (p_processing_timeout_minutes || ' minutes')::INTERVAL;

  RETURN QUERY
  WITH candidate_mailboxes AS (
    SELECT m.id
    FROM mailboxes m
    WHERE m.deleted_at IS NULL
      AND m.status = 'connected'
      AND m.email_address NOT LIKE '%@furnace.test'
      AND (m.imap_claimed_at IS NULL OR m.imap_claimed_at < v_processing_timeout)
      AND (m.imap_next_check_at IS NULL OR m.imap_next_check_at <= NOW())
    ORDER BY m.imap_next_check_at ASC NULLS FIRST, m.id ASC
    LIMIT p_batch_size
    FOR UPDATE OF m SKIP LOCKED
  ),
  updated_mailboxes AS (
    UPDATE mailboxes m
    SET
      imap_claimed_at = NOW(),
      updated_at = NOW()
    FROM candidate_mailboxes cm
    WHERE m.id = cm.id
    RETURNING
      m.id,
      m.account_id,
      m.user_id,
      m.email_address,
      m.display_name,
      m.provider,
      m.smtp_host,
      m.smtp_port,
      m.smtp_username,
      m.smtp_password,
      m.smtp_use_tls,
      m.smtp_use_ssl,
      m.imap_host,
      m.imap_port,
      m.imap_username,
      m.imap_password,
      m.imap_use_ssl,
      m.status,
      m.last_synced_at,
      m.error_message,
      m.created_at,
      m.updated_at,
      m.imap_next_check_at,
      m.imap_last_attempt_at,
      m.imap_consecutive_failures,
      m.imap_last_error_code
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
    updated_mailboxes.last_synced_at,
    updated_mailboxes.error_message,
    updated_mailboxes.created_at,
    updated_mailboxes.updated_at,
    updated_mailboxes.imap_next_check_at,
    updated_mailboxes.imap_last_attempt_at,
    updated_mailboxes.imap_consecutive_failures,
    updated_mailboxes.imap_last_error_code
  FROM updated_mailboxes
  ORDER BY updated_mailboxes.imap_next_check_at ASC NULLS FIRST, updated_mailboxes.id ASC;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION claim_mailboxes_to_check IS
  'Atomically claims due connected mailboxes for hot-path IMAP checking. Eligibility is imap_next_check_at <= now(); order is fair by next_check. Excludes @furnace.test. Sets imap_claimed_at only; schedule advances on attempt completion.';
