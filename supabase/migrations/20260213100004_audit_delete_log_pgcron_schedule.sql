-- ============================================
-- Optional: schedule audit_delete_log_prune(7) daily via pg_cron
-- If pg_cron is not available, this migration does nothing (no error).
-- ============================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'cron') THEN
    EXECUTE 'SELECT cron.schedule($1, $2, $3)'
      USING 'audit-prune', '0 3 * * *', 'SELECT audit_delete_log_prune(7)';
  END IF;
END;
$$;
