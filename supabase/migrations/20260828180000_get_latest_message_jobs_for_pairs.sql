-- Scheduler latest-job preload: one indexed lookup per (enrollment, node) pair.
-- Replaces the cartesian PostgREST filter
--   enrollment_id IN (...) AND node_id IN (...) ORDER BY created_at DESC
-- which returned every historical job on any listed node for any listed enrollment.
--
-- No new index: the LATERAL rides idx_message_jobs_enrollment_node_status
-- (enrollment_id, node_id, status) and sorts the handful of matching rows.

CREATE OR REPLACE FUNCTION public.get_latest_message_jobs_for_pairs(
  p_pairs jsonb DEFAULT '[]'::jsonb
)
RETURNS TABLE (
  id uuid,
  enrollment_id uuid,
  node_id uuid,
  sent_at timestamptz,
  status text,
  status_reason text,
  error_message text,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH pairs AS (
    SELECT DISTINCT
      pair.enrollment_id,
      pair.node_id
    FROM jsonb_to_recordset(
      CASE
        WHEN p_pairs IS NULL OR jsonb_typeof(p_pairs) <> 'array' THEN '[]'::jsonb
        ELSE p_pairs
      END
    ) AS pair(
      enrollment_id uuid,
      node_id uuid
    )
    WHERE pair.enrollment_id IS NOT NULL
      AND pair.node_id IS NOT NULL
    LIMIT 200
  )
  SELECT
    mj.id,
    mj.enrollment_id,
    mj.node_id,
    mj.sent_at,
    mj.status,
    mj.status_reason,
    mj.error_message,
    mj.created_at
  FROM pairs p
  JOIN LATERAL (
    SELECT
      inner_mj.id,
      inner_mj.enrollment_id,
      inner_mj.node_id,
      inner_mj.sent_at,
      inner_mj.status,
      inner_mj.status_reason,
      inner_mj.error_message,
      inner_mj.created_at
    FROM public.message_jobs inner_mj
    WHERE inner_mj.enrollment_id = p.enrollment_id
      AND inner_mj.node_id = p.node_id
    ORDER BY inner_mj.created_at DESC, inner_mj.id DESC
    LIMIT 1
  ) mj ON true;
$$;

COMMENT ON FUNCTION public.get_latest_message_jobs_for_pairs(jsonb) IS
  'Latest message_job per (enrollment_id, node_id) pair: LATERAL created_at DESC, id DESC LIMIT 1. Dedupes pairs, drops nulls, caps at 200. Used by the scheduler flow-gate preload.';

REVOKE ALL ON FUNCTION public.get_latest_message_jobs_for_pairs(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_latest_message_jobs_for_pairs(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_latest_message_jobs_for_pairs(jsonb) TO service_role;
