-- ============================================
-- Audit DELETEs on key tables (no extension required)
-- Use this if pgaudit is not available in your Supabase project.
-- Logs who deleted what and when into audit_delete_log.
--
-- Tables tracked: email_threads, email_messages, campaigns, mailboxes,
--   leads, enrollments, message_jobs.
-- Run 20260213100002_audit_deletes_store_row_and_prune.sql next to store
-- full row (recovery) and get 7-day prune function.
-- ============================================

CREATE TABLE IF NOT EXISTS audit_delete_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name TEXT NOT NULL,
  record_id UUID,           -- id of deleted row (when applicable)
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_by TEXT NOT NULL DEFAULT current_user
);

CREATE INDEX IF NOT EXISTS idx_audit_delete_log_table_deleted_at
  ON audit_delete_log (table_name, deleted_at DESC);

COMMENT ON TABLE audit_delete_log IS 'Logs DELETE operations on key tables for debugging (e.g. inbox wipe). Query by table_name and deleted_at.';

-- Generic trigger function: expects trigger to fire BEFORE DELETE, OLD has id UUID.
CREATE OR REPLACE FUNCTION audit_delete_trigger_fn()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO audit_delete_log (table_name, record_id, deleted_by)
  VALUES (TG_TABLE_NAME, OLD.id, current_user);
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Attach to tables that can cause inbox wipe when deleted
CREATE TRIGGER audit_delete_email_threads
  BEFORE DELETE ON email_threads
  FOR EACH ROW EXECUTE FUNCTION audit_delete_trigger_fn();

CREATE TRIGGER audit_delete_email_messages
  BEFORE DELETE ON email_messages
  FOR EACH ROW EXECUTE FUNCTION audit_delete_trigger_fn();

CREATE TRIGGER audit_delete_campaigns
  BEFORE DELETE ON campaigns
  FOR EACH ROW EXECUTE FUNCTION audit_delete_trigger_fn();

CREATE TRIGGER audit_delete_mailboxes
  BEFORE DELETE ON mailboxes
  FOR EACH ROW EXECUTE FUNCTION audit_delete_trigger_fn();

CREATE TRIGGER audit_delete_leads
  BEFORE DELETE ON leads
  FOR EACH ROW EXECUTE FUNCTION audit_delete_trigger_fn();

CREATE TRIGGER audit_delete_enrollments
  BEFORE DELETE ON enrollments
  FOR EACH ROW EXECUTE FUNCTION audit_delete_trigger_fn();

CREATE TRIGGER audit_delete_message_jobs
  BEFORE DELETE ON message_jobs
  FOR EACH ROW EXECUTE FUNCTION audit_delete_trigger_fn();
