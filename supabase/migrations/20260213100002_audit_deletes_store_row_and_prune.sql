-- ============================================
-- Audit delete: store full row for recovery + prune after 7 days
-- Depends on: 20260213100001_audit_deletes_trigger.sql (creates audit_delete_log + triggers)
-- ============================================

-- Store the deleted row as JSON so it can be recovered
ALTER TABLE audit_delete_log
  ADD COLUMN IF NOT EXISTS deleted_row JSONB;

COMMENT ON COLUMN audit_delete_log.deleted_row IS 'Full row at delete time (row_to_json(OLD)). Use for recovery.';

-- Update trigger function to capture OLD row
CREATE OR REPLACE FUNCTION audit_delete_trigger_fn()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO audit_delete_log (table_name, record_id, deleted_by, deleted_row)
  VALUES (TG_TABLE_NAME, OLD.id, current_user, row_to_json(OLD));
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Prune rows older than 7 days (run daily via pg_cron or external cron)
CREATE OR REPLACE FUNCTION audit_delete_log_prune(days_retention int DEFAULT 7)
RETURNS bigint AS $$
DECLARE
  deleted_count bigint;
BEGIN
  WITH deleted AS (
    DELETE FROM audit_delete_log
    WHERE deleted_at < NOW() - (days_retention || ' days')::interval
    RETURNING id
  )
  SELECT count(*)::bigint INTO deleted_count FROM deleted;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION audit_delete_log_prune(int) IS 'Deletes audit_delete_log rows older than days_retention (default 7). Run daily. With pg_cron: SELECT cron.schedule(''audit-prune'', ''0 3 * * *'', ''SELECT audit_delete_log_prune(7)'');';

-- Optional: run once to apply retention to any existing rows
SELECT audit_delete_log_prune(7);
