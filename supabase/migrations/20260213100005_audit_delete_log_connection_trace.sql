-- ============================================
-- Audit delete: connection trace (application_name, client_addr, backend_pid)
-- When deleted_by is 'postgres', distinguish SQL Editor vs Table Editor vs script.
-- Depends on: 20260213100001, 20260213100002, 20260213100003
-- ============================================

ALTER TABLE audit_delete_log
  ADD COLUMN IF NOT EXISTS application_name TEXT,
  ADD COLUMN IF NOT EXISTS client_addr INET,
  ADD COLUMN IF NOT EXISTS backend_pid INTEGER;

COMMENT ON COLUMN audit_delete_log.application_name IS 'Connection application_name (e.g. Supabase SQL Editor, Dashboard). Set by client or connection string. NULL if unset.';
COMMENT ON COLUMN audit_delete_log.client_addr IS 'Client IP from inet_client_addr(). NULL for local/unix connections.';
COMMENT ON COLUMN audit_delete_log.backend_pid IS 'Postgres backend process ID at delete time; correlate with pg_stat_activity or logs.';

-- DELETE trigger: log connection trace so we can tell Dashboard vs script vs migration
CREATE OR REPLACE FUNCTION audit_delete_trigger_fn()
RETURNS TRIGGER AS $$
DECLARE
  v_app_name TEXT;
  v_client_addr INET;
  v_backend_pid INTEGER;
BEGIN
  BEGIN
    v_app_name := NULLIF(TRIM(current_setting('application_name', true)), '');
    v_client_addr := inet_client_addr();
    v_backend_pid := pg_backend_pid();
  EXCEPTION WHEN OTHERS THEN
    v_app_name := NULL;
    v_client_addr := NULL;
    v_backend_pid := NULL;
  END;

  INSERT INTO audit_delete_log (
    table_name, record_id, deleted_by, deleted_row,
    application_name, client_addr, backend_pid
  )
  VALUES (
    TG_TABLE_NAME, OLD.id, current_user, row_to_json(OLD),
    v_app_name, v_client_addr, v_backend_pid
  );
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- TRUNCATE trigger: same connection trace
CREATE OR REPLACE FUNCTION audit_truncate_trigger_fn()
RETURNS TRIGGER AS $$
DECLARE
  v_app_name TEXT;
  v_client_addr INET;
  v_backend_pid INTEGER;
BEGIN
  BEGIN
    v_app_name := NULLIF(TRIM(current_setting('application_name', true)), '');
    v_client_addr := inet_client_addr();
    v_backend_pid := pg_backend_pid();
  EXCEPTION WHEN OTHERS THEN
    v_app_name := NULL;
    v_client_addr := NULL;
    v_backend_pid := NULL;
  END;

  INSERT INTO audit_delete_log (
    table_name, record_id, deleted_by, deleted_row,
    application_name, client_addr, backend_pid
  )
  VALUES (
    TG_TABLE_NAME, NULL, current_user, '{"truncate": true}'::jsonb,
    v_app_name, v_client_addr, v_backend_pid
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Index for "recent deletes by app" investigation queries
CREATE INDEX IF NOT EXISTS idx_audit_delete_log_deleted_at_application_name
  ON audit_delete_log (deleted_at DESC, application_name)
  WHERE application_name IS NOT NULL;
