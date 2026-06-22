ALTER TABLE mailboxes
  ADD COLUMN IF NOT EXISTS imap_last_recovery_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_mailboxes_imap_recovery_ready
  ON mailboxes(imap_last_recovery_at, imap_claimed_at, id)
  WHERE deleted_at IS NULL
    AND status = 'error';

CREATE OR REPLACE FUNCTION claim_mailboxes_for_imap_recovery(
  p_batch_size INTEGER DEFAULT 100,
  p_cooldown_hours INTEGER DEFAULT 24,
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
  updated_at TIMESTAMPTZ
) AS $$
DECLARE
  v_processing_timeout TIMESTAMPTZ;
  v_recovery_cutoff TIMESTAMPTZ;
BEGIN
  v_processing_timeout := NOW() - (p_processing_timeout_minutes || ' minutes')::INTERVAL;
  v_recovery_cutoff := NOW() - (p_cooldown_hours || ' hours')::INTERVAL;

  RETURN QUERY
  WITH candidate_mailboxes AS (
    SELECT
      m.id,
      CASE
        WHEN m.imap_last_recovery_at IS NULL THEN 1
        ELSE 2
      END AS claim_priority
    FROM mailboxes m
    WHERE m.deleted_at IS NULL
      AND m.status = 'error'
      AND m.email_address NOT LIKE '%@furnace.test'
      AND (m.imap_claimed_at IS NULL OR m.imap_claimed_at < v_processing_timeout)
      AND (m.imap_last_recovery_at IS NULL OR m.imap_last_recovery_at < v_recovery_cutoff)
    ORDER BY claim_priority ASC, m.imap_last_recovery_at ASC NULLS FIRST, m.updated_at ASC
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
      m.updated_at
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
    updated_mailboxes.updated_at
  FROM updated_mailboxes
  ORDER BY updated_mailboxes.updated_at ASC;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION claim_mailboxes_for_imap_recovery IS
  'Atomically claims error-status mailboxes for low-frequency IMAP recovery checks. Uses imap_claimed_at for locking and imap_last_recovery_at for cooldown.';
