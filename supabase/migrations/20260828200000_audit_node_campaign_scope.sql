-- Read-only health check: count child rows whose campaign_id does not match
-- the referenced node's campaign_id, plus node_id values with no nodes row.
-- Deployable with zero behavior change so we can measure prod before adding
-- composite (campaign_id, node_id) foreign keys.

CREATE OR REPLACE FUNCTION public.audit_node_campaign_scope()
RETURNS TABLE (source text, mismatched bigint, orphaned bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = 0
AS $$
  SELECT
    'message_jobs'::text AS source,
    COUNT(*) FILTER (
      WHERE n.id IS NOT NULL
        AND n.campaign_id IS DISTINCT FROM mj.campaign_id
    )::bigint AS mismatched,
    COUNT(*) FILTER (
      WHERE mj.node_id IS NOT NULL AND n.id IS NULL
    )::bigint AS orphaned
  FROM public.message_jobs mj
  LEFT JOIN public.nodes n ON n.id = mj.node_id

  UNION ALL

  SELECT
    'enrollments.current_node_id'::text,
    COUNT(*) FILTER (
      WHERE n.id IS NOT NULL
        AND n.campaign_id IS DISTINCT FROM e.campaign_id
    )::bigint,
    COUNT(*) FILTER (WHERE n.id IS NULL)::bigint
  FROM public.enrollments e
  LEFT JOIN public.nodes n ON n.id = e.current_node_id
  WHERE e.current_node_id IS NOT NULL

  UNION ALL

  SELECT
    'enrollments.held_node_id'::text,
    COUNT(*) FILTER (
      WHERE n.id IS NOT NULL
        AND n.campaign_id IS DISTINCT FROM e.campaign_id
    )::bigint,
    COUNT(*) FILTER (WHERE n.id IS NULL)::bigint
  FROM public.enrollments e
  LEFT JOIN public.nodes n ON n.id = e.held_node_id
  WHERE e.held_node_id IS NOT NULL

  UNION ALL

  SELECT
    'campaign_node_variant_state'::text,
    COUNT(*) FILTER (
      WHERE n.id IS NOT NULL
        AND n.campaign_id IS DISTINCT FROM vs.campaign_id
    )::bigint,
    COUNT(*) FILTER (WHERE n.id IS NULL)::bigint
  FROM public.campaign_node_variant_state vs
  LEFT JOIN public.nodes n ON n.id = vs.node_id

  UNION ALL

  SELECT
    'campaign_variant_stats'::text,
    COUNT(*) FILTER (
      WHERE n.id IS NOT NULL
        AND n.campaign_id IS DISTINCT FROM cvs.campaign_id
    )::bigint,
    COUNT(*) FILTER (WHERE n.id IS NULL)::bigint
  FROM public.campaign_variant_stats cvs
  LEFT JOIN public.nodes n ON n.id = cvs.node_id
$$;

COMMENT ON FUNCTION public.audit_node_campaign_scope() IS
  'Counts campaign-scoped node mismatches and orphaned node_id refs on message_jobs, enrollments, campaign_node_variant_state, and campaign_variant_stats. Read-only.';

REVOKE ALL ON FUNCTION public.audit_node_campaign_scope() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.audit_node_campaign_scope() TO service_role;

NOTIFY pgrst, 'reload schema';
