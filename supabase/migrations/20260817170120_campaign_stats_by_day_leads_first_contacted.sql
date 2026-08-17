-- Add campaign-scoped first-contact counts to campaign_stats_by_day.
-- Postgres cannot CREATE OR REPLACE a changed RETURNS TABLE, so drop first.

DROP FUNCTION IF EXISTS public.campaign_stats_by_day(uuid, date, date);

CREATE FUNCTION public.campaign_stats_by_day(
  p_campaign_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS TABLE (
  stat_date date,
  sent_count bigint,
  replied_count bigint,
  positive_reply_count bigint,
  bounce_count bigint,
  leads_first_contacted bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_campaign_id IS NULL THEN
    RAISE EXCEPTION 'p_campaign_id is required';
  END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL THEN
    RAISE EXCEPTION 'p_start_date and p_end_date are required';
  END IF;

  IF auth.uid() IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.campaigns c
      INNER JOIN public.account_users au
        ON au.account_id = c.account_id AND au.user_id = auth.uid()
      WHERE c.id = p_campaign_id
        AND c.deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_start_date > p_end_date THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH days AS (
    SELECT (p_start_date + g.s) AS stat_date
    FROM generate_series(0, (p_end_date - p_start_date)::integer) AS g(s)
  ),
  agg AS (
    SELECT
      (ev.created_at AT TIME ZONE 'UTC')::date AS d,
      COUNT(*) FILTER (WHERE ev.event_type = 'sent')::bigint AS sc,
      COUNT(*) FILTER (WHERE ev.event_type = 'replied')::bigint AS rc,
      COUNT(*) FILTER (
        WHERE ev.event_type = 'replied'
          AND (ev.event_data->>'is_positive') = 'true'
      )::bigint AS pc,
      COUNT(*) FILTER (WHERE ev.event_type = 'bounced')::bigint AS bc
    FROM public.events ev
    INNER JOIN public.campaigns c ON c.id = ev.campaign_id
    WHERE c.id = p_campaign_id
      AND c.deleted_at IS NULL
      AND c.source IS DISTINCT FROM 'smartlead'
      AND ev.event_type IN ('sent', 'replied', 'bounced')
      AND (ev.created_at AT TIME ZONE 'UTC')::date BETWEEN p_start_date AND p_end_date
    GROUP BY 1
  ),
  sent_events AS (
    SELECT
      ev.created_at,
      COALESCE(ev.lead_id, en.lead_id) AS lead_id
    FROM public.events ev
    INNER JOIN public.campaigns c ON c.id = ev.campaign_id
    LEFT JOIN public.enrollments en ON en.id = ev.enrollment_id
    WHERE c.id = p_campaign_id
      AND c.deleted_at IS NULL
      AND c.source IS DISTINCT FROM 'smartlead'
      AND ev.event_type = 'sent'
      AND COALESCE(ev.lead_id, en.lead_id) IS NOT NULL
  ),
  first_contact AS (
    SELECT
      se.lead_id,
      MIN(se.created_at) AS first_sent_at
    FROM sent_events se
    GROUP BY se.lead_id
  ),
  first_in_range AS (
    SELECT
      (fc.first_sent_at AT TIME ZONE 'UTC')::date AS stat_date,
      COUNT(*)::bigint AS leads_first_contacted
    FROM first_contact fc
    WHERE (fc.first_sent_at AT TIME ZONE 'UTC')::date BETWEEN p_start_date AND p_end_date
    GROUP BY 1
  )
  SELECT
    d.stat_date,
    COALESCE(a.sc, 0)::bigint,
    COALESCE(a.rc, 0)::bigint,
    COALESCE(a.pc, 0)::bigint,
    COALESCE(a.bc, 0)::bigint,
    COALESCE(f.leads_first_contacted, 0)::bigint
  FROM days d
  LEFT JOIN agg a ON a.d = d.stat_date
  LEFT JOIN first_in_range f ON f.stat_date = d.stat_date
  ORDER BY d.stat_date;
END;
$$;

COMMENT ON FUNCTION public.campaign_stats_by_day(uuid, date, date) IS
  'Campaign detail chart: one row per UTC calendar day in range with sent/replied/positive/bounce counts and campaign-scoped first-contact leads (Furnace campaigns only). First contact uses full send history, not the selected window.';

REVOKE ALL ON FUNCTION public.campaign_stats_by_day(uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.campaign_stats_by_day(uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.campaign_stats_by_day(uuid, date, date) TO service_role;
