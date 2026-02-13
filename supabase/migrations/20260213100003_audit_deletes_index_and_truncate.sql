-- ============================================
-- Audit delete: index for prune + TRUNCATE auditing
-- Depends on: 20260213100001, 20260213100002 (audit_delete_log and prune)
-- ============================================

-- Index so prune DELETE by deleted_at is efficient
CREATE INDEX IF NOT EXISTS idx_audit_delete_log_deleted_at
  ON audit_delete_log (deleted_at);

-- Log TRUNCATE as one row per table (no row payload; record_id stays NULL)
CREATE OR REPLACE FUNCTION audit_truncate_trigger_fn()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO audit_delete_log (table_name, record_id, deleted_by, deleted_row)
  VALUES (TG_TABLE_NAME, NULL, current_user, '{"truncate": true}'::jsonb);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- AFTER TRUNCATE FOR EACH STATEMENT on the same 7 tables
CREATE TRIGGER audit_truncate_email_threads
  AFTER TRUNCATE ON email_threads
  FOR EACH STATEMENT EXECUTE FUNCTION audit_truncate_trigger_fn();

CREATE TRIGGER audit_truncate_email_messages
  AFTER TRUNCATE ON email_messages
  FOR EACH STATEMENT EXECUTE FUNCTION audit_truncate_trigger_fn();

CREATE TRIGGER audit_truncate_campaigns
  AFTER TRUNCATE ON campaigns
  FOR EACH STATEMENT EXECUTE FUNCTION audit_truncate_trigger_fn();

CREATE TRIGGER audit_truncate_mailboxes
  AFTER TRUNCATE ON mailboxes
  FOR EACH STATEMENT EXECUTE FUNCTION audit_truncate_trigger_fn();

CREATE TRIGGER audit_truncate_leads
  AFTER TRUNCATE ON leads
  FOR EACH STATEMENT EXECUTE FUNCTION audit_truncate_trigger_fn();

CREATE TRIGGER audit_truncate_enrollments
  AFTER TRUNCATE ON enrollments
  FOR EACH STATEMENT EXECUTE FUNCTION audit_truncate_trigger_fn();

CREATE TRIGGER audit_truncate_message_jobs
  AFTER TRUNCATE ON message_jobs
  FOR EACH STATEMENT EXECUTE FUNCTION audit_truncate_trigger_fn();
