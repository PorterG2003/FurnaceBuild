-- Account-scoped sequence-step stats, generalizing get_campaign_variant_stats.

CREATE OR REPLACE FUNCTION public.account_node_stats(
  p_account_id uuid,
  p_start_date date DEFAULT NULL,
  p_end_date date DEFAULT NULL,
  p_campaign_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  campaign_id uuid,
  campaign_name text,
  node_id uuid,
  flow_node_id text,
  node_label text,
  sent_count bigint,
  replied_count bigint,
  positive_reply_count bigint,
  bounce_count bigint
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
  WITH campaign_scope AS (
    SELECT c.id, c.name
    FROM public.campaigns c
    WHERE c.account_id = p_account_id
      AND c.deleted_at IS NULL
      AND c.source IS DISTINCT FROM 'smartlead'
      AND (
        p_campaign_ids IS NULL
        OR COALESCE(cardinality(p_campaign_ids), 0) = 0
        OR c.id = ANY (p_campaign_ids)
      )
  ),
  sent AS (
    SELECT mj.campaign_id, mj.node_id, COUNT(*)::bigint AS c
    FROM public.message_jobs mj
    INNER JOIN campaign_scope cs ON cs.id = mj.campaign_id
    WHERE mj.status = 'sent'
      AND public.is_campaign_outbound_message_type(mj.message_type)
      AND (
        p_start_date IS NULL OR p_end_date IS NULL
        OR (mj.sent_at AT TIME ZONE 'UTC')::date BETWEEN p_start_date AND p_end_date
      )
    GROUP BY mj.campaign_id, mj.node_id
  ),
  replied AS (
    SELECT mj.campaign_id, mj.node_id, COUNT(*)::bigint AS c
    FROM public.events e
    INNER JOIN public.message_jobs mj ON mj.id = e.message_job_id
    INNER JOIN campaign_scope cs ON cs.id = mj.campaign_id
    WHERE e.event_type = 'replied'
      AND public.is_paced_campaign_message_type(mj.message_type)
      AND (
        p_start_date IS NULL OR p_end_date IS NULL
        OR (e.created_at AT TIME ZONE 'UTC')::date BETWEEN p_start_date AND p_end_date
      )
    GROUP BY mj.campaign_id, mj.node_id
  ),
  pos AS (
    SELECT mj.campaign_id, mj.node_id, COUNT(*)::bigint AS c
    FROM public.events e
    INNER JOIN public.message_jobs mj ON mj.id = e.message_job_id
    INNER JOIN campaign_scope cs ON cs.id = mj.campaign_id
    WHERE e.event_type = 'replied'
      AND COALESCE((e.event_data->>'is_positive')::boolean, false) = true
      AND public.is_paced_campaign_message_type(mj.message_type)
      AND (
        p_start_date IS NULL OR p_end_date IS NULL
        OR (e.created_at AT TIME ZONE 'UTC')::date BETWEEN p_start_date AND p_end_date
      )
    GROUP BY mj.campaign_id, mj.node_id
  ),
  bnc AS (
    SELECT mj.campaign_id, mj.node_id, COUNT(*)::bigint AS c
    FROM public.events e
    INNER JOIN public.message_jobs mj ON mj.id = e.message_job_id
    INNER JOIN campaign_scope cs ON cs.id = mj.campaign_id
    WHERE e.event_type = 'bounced'
      AND public.is_campaign_outbound_message_type(mj.message_type)
      AND (
        p_start_date IS NULL OR p_end_date IS NULL
        OR (e.created_at AT TIME ZONE 'UTC')::date BETWEEN p_start_date AND p_end_date
      )
    GROUP BY mj.campaign_id, mj.node_id
  ),
  keys AS (
    SELECT s.campaign_id, s.node_id FROM sent s
    UNION
    SELECT r.campaign_id, r.node_id FROM replied r
    UNION
    SELECT p.campaign_id, p.node_id FROM pos p
    UNION
    SELECT b.campaign_id, b.node_id FROM bnc b
  )
  SELECT
    k.campaign_id,
    cs.name AS campaign_name,
    k.node_id,
    n.flow_node_id,
    COALESCE(NULLIF(btrim(n.node_data->>'label'), ''), 'Email step') AS node_label,
    COALESCE(s.c, 0)::bigint,
    COALESCE(r.c, 0)::bigint,
    COALESCE(p.c, 0)::bigint,
    COALESCE(b.c, 0)::bigint
  FROM keys k
  INNER JOIN campaign_scope cs ON cs.id = k.campaign_id
  LEFT JOIN public.nodes n ON n.id = k.node_id
  LEFT JOIN sent s ON s.campaign_id = k.campaign_id AND s.node_id = k.node_id
  LEFT JOIN replied r ON r.campaign_id = k.campaign_id AND r.node_id = k.node_id
  LEFT JOIN pos p ON p.campaign_id = k.campaign_id AND p.node_id = k.node_id
  LEFT JOIN bnc b ON b.campaign_id = k.campaign_id AND b.node_id = k.node_id
  ORDER BY COALESCE(p.c, 0) DESC, COALESCE(s.c, 0) DESC;
END;
$$;

COMMENT ON FUNCTION public.account_node_stats(uuid, date, date, uuid[]) IS
  'Per email node across Furnace campaigns: sent, replied, interested, bounce. Optional UTC date filter.';

REVOKE ALL ON FUNCTION public.account_node_stats(uuid, date, date, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.account_node_stats(uuid, date, date, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.account_node_stats(uuid, date, date, uuid[]) TO service_role;
