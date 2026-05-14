DROP FUNCTION IF EXISTS public.reclaim_stale_campaign_message_jobs(INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION public.reclaim_stale_campaign_message_jobs(
  p_batch_size INTEGER DEFAULT 50,
  p_rearm_delay_seconds INTEGER DEFAULT 60,
  p_reserved_stale_minutes INTEGER DEFAULT 5
)
RETURNS TABLE (
  message_job_id UUID,
  enrollment_id UUID,
  campaign_id UUID
) AS $$
BEGIN
  RETURN QUERY
  WITH candidate_jobs AS (
    SELECT mj.id, mj.enrollment_id, mj.campaign_id
    FROM message_jobs mj
    INNER JOIN campaigns c
      ON c.id = mj.campaign_id
     AND c.status = 'running'
     AND c.deleted_at IS NULL
    INNER JOIN enrollments e
      ON e.id = mj.enrollment_id
     AND e.state = 'active'
     AND e.deleted_at IS NULL
    INNER JOIN leads l
      ON l.id = mj.lead_id
     AND l.deleted_at IS NULL
    INNER JOIN mailboxes m
      ON m.id = mj.mailbox_id
     AND m.deleted_at IS NULL
    LEFT JOIN nodes n
      ON n.id = mj.node_id
    WHERE mj.status = 'reserved'
      AND (mj.message_type = 'campaign' OR mj.message_type IS NULL)
      AND (
        (mj.lease_expires_at IS NOT NULL AND mj.lease_expires_at < NOW())
        OR (
          mj.lease_expires_at IS NULL
          AND mj.reserved_at IS NOT NULL
          AND mj.reserved_at < NOW() - make_interval(mins => p_reserved_stale_minutes)
        )
      )
      AND (mj.node_id IS NULL OR (n.id IS NOT NULL AND n.deleted_at IS NULL))
      AND NOT EXISTS (
        SELECT 1
        FROM message_jobs newer
        WHERE newer.enrollment_id = mj.enrollment_id
          AND newer.node_id IS NOT DISTINCT FROM mj.node_id
          AND (newer.message_type = 'campaign' OR newer.message_type IS NULL)
          AND newer.created_at > mj.created_at
      )
    ORDER BY COALESCE(mj.lease_expires_at, mj.reserved_at) ASC
    LIMIT p_batch_size
    FOR UPDATE OF mj SKIP LOCKED
  ),
  updated_jobs AS (
    UPDATE message_jobs mj
    SET
      status = 'deferred',
      status_reason = 'transient_read_error',
      reserved_at = NULL,
      lease_expires_at = NULL,
      claim_token = NULL,
      error_message = COALESCE(
        NULLIF(mj.error_message, ''),
        'Reserved lease expired before send completed'
      ),
      send_wait_reason = NULL,
      updated_at = NOW()
    FROM candidate_jobs cj
    WHERE mj.id = cj.id
    RETURNING mj.id, mj.enrollment_id, mj.campaign_id
  ),
  rearmed_enrollments AS (
    UPDATE enrollments e
    SET
      next_run_at = NOW() + make_interval(secs => p_rearm_delay_seconds),
      updated_at = NOW()
    FROM updated_jobs uj
    WHERE e.id = uj.enrollment_id
      AND e.state = 'active'
      AND e.deleted_at IS NULL
    RETURNING e.id
  )
  SELECT
    uj.id AS message_job_id,
    uj.enrollment_id,
    uj.campaign_id
  FROM updated_jobs uj;
END;
$$ LANGUAGE plpgsql;
