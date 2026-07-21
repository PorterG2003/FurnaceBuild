-- Collapse the scheduler's batch-interval enrollment eligibility + duplicate-job
-- filter into one set-based RPC. Replaces the prior JS pattern of:
--   SELECT enrollments ... .in(current_node_id, ...)
--   + get_existing_message_job_pairs(up to 1000 pairs round-tripped)
-- with a single indexed NOT EXISTS join. Semantics match the previous filter:
-- same readiness predicates, same blocking statuses as get_existing_message_job_pairs,
-- same ORDER BY (next_run_at, created_at, id).

CREATE INDEX IF NOT EXISTS idx_enrollments_campaign_node_ready
  ON enrollments (campaign_id, current_node_id, next_run_at)
  WHERE state = 'active' AND deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.get_ready_interval_enrollments(
  p_campaign_id UUID,
  p_node_ids UUID[] DEFAULT '{}'::UUID[],
  p_now TIMESTAMPTZ DEFAULT NOW()
)
RETURNS TABLE (
  id UUID,
  lead_id UUID,
  current_node_id UUID,
  next_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  lead_mailbox_id UUID,
  lead_email TEXT,
  lead_name TEXT,
  lead_first_name TEXT,
  lead_last_name TEXT
) AS $$
  SELECT
    e.id,
    e.lead_id,
    e.current_node_id,
    e.next_run_at,
    e.created_at,
    l.mailbox_id AS lead_mailbox_id,
    l.email AS lead_email,
    l.name AS lead_name,
    l.first_name AS lead_first_name,
    l.last_name AS lead_last_name
  FROM enrollments e
  INNER JOIN leads l
    ON l.id = e.lead_id
   AND l.deleted_at IS NULL
  WHERE e.campaign_id = p_campaign_id
    AND e.state = 'active'
    AND e.deleted_at IS NULL
    AND e.next_run_at IS NOT NULL
    AND e.next_run_at <= p_now
    AND e.current_node_id = ANY (COALESCE(p_node_ids, '{}'::UUID[]))
    AND NOT EXISTS (
      SELECT 1
      FROM message_jobs mj
      WHERE mj.enrollment_id = e.id
        AND mj.node_id = e.current_node_id
        AND mj.status IN (
          'pending',
          'reserved',
          'sending',
          'sent',
          'failed',
          'cancelled',
          'blocked'
        )
    )
  ORDER BY e.next_run_at ASC, e.created_at ASC, e.id ASC;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION public.get_ready_interval_enrollments(UUID, UUID[], TIMESTAMPTZ) IS
  'Returns active enrollments ready for interval email assignment: due next_run_at, current_node in p_node_ids, no duplicate-blocking message_job, non-deleted lead. Ordered by next_run_at, created_at, id.';

REVOKE ALL ON FUNCTION public.get_ready_interval_enrollments(UUID, UUID[], TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_ready_interval_enrollments(UUID, UUID[], TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_ready_interval_enrollments(UUID, UUID[], TIMESTAMPTZ) TO service_role;
