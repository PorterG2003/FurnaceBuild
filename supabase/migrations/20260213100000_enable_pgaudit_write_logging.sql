-- ============================================
-- Enable PGAudit write logging (INSERT, UPDATE, DELETE, TRUNCATE)
-- so Postgres logs show what deleted rows (e.g. inbox wipe investigation).
--
-- If pgaudit is NOT in Dashboard → Database → Extensions:
--   Try in SQL Editor: CREATE EXTENSION IF NOT EXISTS pgaudit;
--   If that fails, skip this migration and use the trigger-based audit instead
--   (migration 20260213100001_audit_deletes_trigger.sql).
-- ============================================

CREATE EXTENSION IF NOT EXISTS pgaudit;

-- Log all write operations from the PostgREST API (app, workers, client).
-- This catches deletes from deleteCampaign, deleteMailbox, etc.
ALTER ROLE authenticator SET pgaudit.log = 'write';

-- Log all write operations from Dashboard (SQL Editor, Table Editor).
-- This catches manual DELETE/TRUNCATE run in the dashboard.
ALTER ROLE postgres SET pgaudit.log = 'write';

-- To view audit logs: Dashboard → Logs → Postgres Logs, filter by event_message
-- containing 'AUDIT' and 'DELETE' (or search for email_threads, campaigns, etc.).
