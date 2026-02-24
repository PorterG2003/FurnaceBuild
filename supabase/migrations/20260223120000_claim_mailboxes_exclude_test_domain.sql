-- Sync eligibility by email pattern only: exclude *@furnace.test (test mailboxes).
-- Removes dependency on sync_enabled; column will be dropped in next migration.
-- Must DROP first because PostgreSQL does not allow changing return type with CREATE OR REPLACE.

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
  updated_at TIMESTAMPTZ
) AS $$
DECLARE
  v_claimed_ids UUID[];
  v_processing_timeout TIMESTAMPTZ;
BEGIN
  v_processing_timeout := NOW() - (p_processing_timeout_minutes || ' minutes')::INTERVAL;

  SELECT ARRAY_AGG(subq.id)
  INTO v_claimed_ids
  FROM (
    SELECT mailboxes.id
    FROM mailboxes
    WHERE mailboxes.status = 'connected'
      AND mailboxes.email_address NOT LIKE '%@furnace.test'
      AND (
        mailboxes.last_synced_at IS NULL
        OR mailboxes.last_synced_at < NOW() - (p_check_interval_minutes || ' minutes')::INTERVAL
        OR (mailboxes.last_synced_at < v_processing_timeout AND mailboxes.last_synced_at > NOW() - INTERVAL '1 hour')
      )
      AND (mailboxes.imap_claimed_at IS NULL OR mailboxes.imap_claimed_at < v_processing_timeout)
    ORDER BY
      CASE
        WHEN mailboxes.last_synced_at IS NULL THEN 1
        WHEN mailboxes.last_synced_at < v_processing_timeout THEN 2
        ELSE 3
      END,
      mailboxes.last_synced_at ASC NULLS FIRST
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  ) subq;

  IF v_claimed_ids IS NULL OR array_length(v_claimed_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH updated_mailboxes AS (
    UPDATE mailboxes
    SET imap_claimed_at = NOW(),
        updated_at = NOW()
    WHERE mailboxes.id = ANY(v_claimed_ids)
      AND mailboxes.status = 'connected'
      AND mailboxes.email_address NOT LIKE '%@furnace.test'
      AND (
        mailboxes.last_synced_at IS NULL
        OR mailboxes.last_synced_at < NOW() - (p_check_interval_minutes || ' minutes')::INTERVAL
        OR (mailboxes.last_synced_at < v_processing_timeout AND mailboxes.last_synced_at > NOW() - INTERVAL '1 hour')
      )
      AND (mailboxes.imap_claimed_at IS NULL OR mailboxes.imap_claimed_at < v_processing_timeout)
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
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION claim_mailboxes_to_check IS
  'Atomically claims mailboxes for IMAP checking. Excludes test mailboxes (email_address LIKE ''%@furnace.test''). Sets imap_claimed_at = NOW() only; last_synced_at unchanged until worker completes.';
