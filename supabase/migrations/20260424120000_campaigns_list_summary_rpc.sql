-- ============================================
-- Migration: campaigns_list_summary RPC
-- ============================================
-- Single account-scoped read for the campaigns list: campaign row subset plus
-- aggregated stats (campaign_stats, enrollments, contacted counts, has_flow).
-- Avoids client-side enrollment row fetch that could truncate at PostgREST max_rows.

CREATE OR REPLACE FUNCTION public.campaigns_list_summary(p_account_id uuid)
RETURNS TABLE (
  id uuid,
  name text,
  status text,
  created_at timestamptz,
  source text,
  has_flow boolean,
  sent_count int,
  replied_count int,
  positive_reply_count int,
  bounce_count int,
  enrollment_count int,
  terminal_enrollment_count int,
  contacted_enrollment_count int
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_account_id IS NULL THEN
    RAISE EXCEPTION 'p_account_id is required';
  END IF;

  IF auth.uid() IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.account_users au
      WHERE au.user_id = auth.uid()
        AND au.account_id = p_account_id
    ) THEN
      RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT
      c.id,
      c.name,
      c.status,
      c.created_at,
      c.source,
      c.flow_data
    FROM public.campaigns c
    WHERE c.account_id = p_account_id
      AND c.deleted_at IS NULL
  ),
  enrollment_agg AS (
    SELECT
      e.campaign_id,
      COUNT(*)::int AS enrollment_count,
      COUNT(*) FILTER (WHERE e.state IN ('stopped', 'completed'))::int AS terminal_enrollment_count
    FROM public.enrollments e
    INNER JOIN base b ON b.id = e.campaign_id
    WHERE e.deleted_at IS NULL
    GROUP BY e.campaign_id
  ),
  contacted_agg AS (
    SELECT
      mj.campaign_id,
      COUNT(DISTINCT mj.enrollment_id)::int AS contacted_enrollment_count
    FROM public.message_jobs mj
    INNER JOIN base b ON b.id = mj.campaign_id
    INNER JOIN public.enrollments e
      ON e.id = mj.enrollment_id
     AND e.deleted_at IS NULL
    WHERE mj.status = 'sent'
      AND (mj.message_type = 'campaign' OR mj.message_type IS NULL)
    GROUP BY mj.campaign_id
  )
  SELECT
    b.id,
    b.name,
    b.status::text,
    b.created_at,
    b.source::text,
    (
      b.flow_data IS NOT NULL
      AND jsonb_typeof((b.flow_data)::jsonb -> 'nodes') = 'array'
      AND jsonb_array_length((b.flow_data)::jsonb -> 'nodes') > 0
    ) AS has_flow,
    COALESCE(cs.sent_count, 0)::int,
    COALESCE(cs.replied_count, 0)::int,
    COALESCE(cs.positive_reply_count, 0)::int,
    COALESCE(cs.bounce_count, 0)::int,
    COALESCE(ea.enrollment_count, 0)::int,
    COALESCE(ea.terminal_enrollment_count, 0)::int,
    COALESCE(ca.contacted_enrollment_count, 0)::int
  FROM base b
  LEFT JOIN public.campaign_stats cs ON cs.campaign_id = b.id
  LEFT JOIN enrollment_agg ea ON ea.campaign_id = b.id
  LEFT JOIN contacted_agg ca ON ca.campaign_id = b.id
  ORDER BY b.created_at DESC;
END;
$$;

COMMENT ON FUNCTION public.campaigns_list_summary(uuid) IS
  'Campaigns list: one row per non-deleted campaign in the account with list-only columns and aggregated stats (mirrors getCampaigns + getCampaignStatsForCampaigns semantics).';

REVOKE ALL ON FUNCTION public.campaigns_list_summary(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.campaigns_list_summary(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.campaigns_list_summary(uuid) TO service_role;
