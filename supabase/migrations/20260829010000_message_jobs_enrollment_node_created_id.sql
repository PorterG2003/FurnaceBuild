-- Latest-attempt access path for (enrollment_id, node_id).
--
-- 20260828180000_get_latest_message_jobs_for_pairs.sql is correct about RPC
-- behavior (LATERAL ORDER BY created_at DESC, id DESC LIMIT 1). Its assumption
-- that each pair has only a handful of rows did not hold in production: some
-- pairs have 20k+ historical attempts, so
-- idx_message_jobs_enrollment_node_status identifies the pair then sorts the
-- entire history. The same missing created_at order shows up in
-- reclaim_stale_campaign_message_jobs' newer-sibling NOT EXISTS.
--
-- This index does not change retry, throttle, interval, or UI semantics.
-- CREATE INDEX CONCURRENTLY cannot run inside a migration transaction; build
-- the identical index concurrently in production first so this IF NOT EXISTS
-- is a no-op there.

SET lock_timeout = '5s';
SET statement_timeout = 0;

CREATE INDEX IF NOT EXISTS idx_message_jobs_enrollment_node_created_id
  ON public.message_jobs (enrollment_id, node_id, created_at DESC, id DESC);

SET statement_timeout = '30s';
SET lock_timeout = '0';
