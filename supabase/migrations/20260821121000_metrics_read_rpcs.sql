-- Point metrics / chart RPCs at campaign_stats_daily; sargable copy stats + leads reached.

DROP FUNCTION IF EXISTS public.account_outreach_metrics(uuid, date, date, uuid[]);
DROP FUNCTION IF EXISTS public.account_outreach_stats_by_day(uuid, date, date, uuid[]);
DROP FUNCTION IF EXISTS public.campaign_stats_by_day(uuid, date, date);

CREATE OR REPLACE FUNCTION public.account_outreach_metrics(
  p_account_id uuid,
  p_start_date date,
  p_end_date date,
  p_campaign_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  total_sent bigint,
  total_replied bigint,
  total_positive_reply bigint,
  leads_reached bigint,
  leads_in_queue bigint,
  smartlead_import_warning boolean
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
  IF p_start_date IS NULL OR p_end_date IS NULL THEN
    RAISE EXCEPTION 'p_start_date and p_end_date are required';
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
  SELECT
    COALESCE(daily.sent_count, 0)::bigint,
    COALESCE(daily.replied_count, 0)::bigint,
    COALESCE(daily.positive_reply_count, 0)::bigint,
    COALESCE(ev_reach.dcnt, 0)::bigint,
    COALESCE(q.inq, 0)::bigint,
    COALESCE(sl.warn, false)
  FROM (
    SELECT
      SUM(d.sent_count)::bigint AS sent_count,
      SUM(d.replied_count)::bigint AS replied_count,
      SUM(d.positive_reply_count)::bigint AS positive_reply_count
    FROM public.campaign_stats_daily d
    INNER JOIN public.campaigns c ON c.id = d.campaign_id
    WHERE d.account_id = p_account_id
      AND d.stat_date >= p_start_date
      AND d.stat_date <= p_end_date
      AND c.deleted_at IS NULL
      AND c.source IS DISTINCT FROM 'smartlead'
      AND (
        p_campaign_ids IS NULL
        OR COALESCE(cardinality(p_campaign_ids), 0) = 0
        OR c.id = ANY (p_campaign_ids)
      )
  ) daily
  CROSS JOIN (
    SELECT COUNT(DISTINCT x.lid)::bigint AS dcnt
    FROM (
      SELECT COALESCE(ev.lead_id, en.lead_id) AS lid
      FROM public.events ev
      INNER JOIN public.campaigns c ON c.id = ev.campaign_id
      LEFT JOIN public.enrollments en
        ON en.id = ev.enrollment_id
       AND en.deleted_at IS NULL
      WHERE ev.account_id = p_account_id
        AND ev.event_type = 'sent'
        AND ev.created_at >= (p_start_date::timestamp AT TIME ZONE 'UTC')
        AND ev.created_at < ((p_end_date + 1)::timestamp AT TIME ZONE 'UTC')
        AND c.deleted_at IS NULL
        AND c.source IS DISTINCT FROM 'smartlead'
        AND (
          p_campaign_ids IS NULL
          OR COALESCE(cardinality(p_campaign_ids), 0) = 0
          OR c.id = ANY (p_campaign_ids)
        )
    ) x
    WHERE x.lid IS NOT NULL
  ) ev_reach
  CROSS JOIN (
    SELECT COUNT(DISTINCT e.lead_id)::bigint AS inq
    FROM public.enrollments e
    INNER JOIN public.campaigns c ON c.id = e.campaign_id
    WHERE e.account_id = p_account_id
      AND c.deleted_at IS NULL
      AND c.status = 'running'
      AND c.source IS DISTINCT FROM 'smartlead'
      AND (
        p_campaign_ids IS NULL
        OR COALESCE(cardinality(p_campaign_ids), 0) = 0
        OR c.id = ANY (p_campaign_ids)
      )
      AND e.deleted_at IS NULL
      AND e.state = 'active'
      AND e.lead_id IS NOT NULL
      AND e.has_been_contacted = false
  ) q
  CROSS JOIN (
    SELECT EXISTS (
      SELECT 1
      FROM public.smartlead_migration_runs r
      WHERE r.account_id = p_account_id
        AND r.finished_at IS NOT NULL
        AND (r.finished_at AT TIME ZONE 'UTC')::date >= p_start_date
        AND r.status IN ('completed', 'completed_with_warnings')
    ) AS warn
  ) sl;
END;
$$;

COMMENT ON FUNCTION public.account_outreach_metrics(uuid, date, date, uuid[]) IS
  'Account metrics page: Furnace sent/replied/positive from campaign_stats_daily; distinct leads reached from sent events in UTC range; in-queue from uncontacted active enrollments on running campaigns; smartlead_import_warning if a migration finished on or after range start.';

CREATE OR REPLACE FUNCTION public.account_outreach_stats_by_day(
  p_account_id uuid,
  p_start_date date,
  p_end_date date,
  p_campaign_ids uuid[] DEFAULT NULL
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
  IF p_account_id IS NULL THEN
    RAISE EXCEPTION 'p_account_id is required';
  END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL THEN
    RAISE EXCEPTION 'p_start_date and p_end_date are required';
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

  IF p_start_date > p_end_date THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH days AS (
    SELECT generate_series(p_start_date, p_end_date, interval '1 day')::date AS stat_date
  ),
  agg AS (
    SELECT
      d.stat_date,
      SUM(d.sent_count)::bigint AS sc,
      SUM(d.replied_count)::bigint AS rc,
      SUM(d.positive_reply_count)::bigint AS pc,
      SUM(d.bounce_count)::bigint AS bc,
      SUM(d.leads_first_contacted)::bigint AS fc
    FROM public.campaign_stats_daily d
    INNER JOIN public.campaigns c ON c.id = d.campaign_id
    WHERE d.account_id = p_account_id
      AND d.stat_date >= p_start_date
      AND d.stat_date <= p_end_date
      AND c.deleted_at IS NULL
      AND c.source IS DISTINCT FROM 'smartlead'
      AND (
        p_campaign_ids IS NULL
        OR COALESCE(cardinality(p_campaign_ids), 0) = 0
        OR c.id = ANY (p_campaign_ids)
      )
    GROUP BY d.stat_date
  )
  SELECT
    d.stat_date,
    COALESCE(a.sc, 0)::bigint,
    COALESCE(a.rc, 0)::bigint,
    COALESCE(a.pc, 0)::bigint,
    COALESCE(a.bc, 0)::bigint,
    COALESCE(a.fc, 0)::bigint
  FROM days d
  LEFT JOIN agg a ON a.stat_date = d.stat_date
  ORDER BY d.stat_date;
END;
$$;

COMMENT ON FUNCTION public.account_outreach_stats_by_day(uuid, date, date, uuid[]) IS
  'Account metrics chart: one row per UTC calendar day from campaign_stats_daily (Furnace campaigns only).';

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
    SELECT generate_series(p_start_date, p_end_date, interval '1 day')::date AS stat_date
  ),
  scoped AS (
    SELECT c.id
    FROM public.campaigns c
    WHERE c.id = p_campaign_id
      AND c.deleted_at IS NULL
      AND c.source IS DISTINCT FROM 'smartlead'
  ),
  agg AS (
    SELECT
      d.stat_date,
      d.sent_count::bigint AS sc,
      d.replied_count::bigint AS rc,
      d.positive_reply_count::bigint AS pc,
      d.bounce_count::bigint AS bc,
      d.leads_first_contacted::bigint AS fc
    FROM public.campaign_stats_daily d
    INNER JOIN scoped s ON s.id = d.campaign_id
    WHERE d.stat_date >= p_start_date
      AND d.stat_date <= p_end_date
  )
  SELECT
    d.stat_date,
    COALESCE(a.sc, 0)::bigint,
    COALESCE(a.rc, 0)::bigint,
    COALESCE(a.pc, 0)::bigint,
    COALESCE(a.bc, 0)::bigint,
    COALESCE(a.fc, 0)::bigint
  FROM days d
  LEFT JOIN agg a ON a.stat_date = d.stat_date
  ORDER BY d.stat_date;
END;
$$;

COMMENT ON FUNCTION public.campaign_stats_by_day(uuid, date, date) IS
  'Campaign detail chart: one row per UTC calendar day from campaign_stats_daily (Furnace campaigns only).';

CREATE OR REPLACE FUNCTION public.account_daily_outreach_volume(
  p_account_id uuid,
  p_start_date date,
  p_end_date date,
  p_campaign_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  stat_date date,
  emails_sent bigint,
  leads_first_contacted bigint
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
  IF p_start_date IS NULL OR p_end_date IS NULL THEN
    RAISE EXCEPTION 'p_start_date and p_end_date are required';
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

  IF p_start_date > p_end_date THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    s.stat_date,
    s.sent_count,
    s.leads_first_contacted
  FROM public.account_outreach_stats_by_day(
    p_account_id,
    p_start_date,
    p_end_date,
    p_campaign_ids
  ) s;
END;
$$;

COMMENT ON FUNCTION public.account_daily_outreach_volume(uuid, date, date, uuid[]) IS
  'Per UTC calendar day: emails sent and first-contacted leads from campaign_stats_daily.';

CREATE OR REPLACE FUNCTION public.account_weekly_outreach_volume(
  p_account_id uuid,
  p_start_date date,
  p_end_date date,
  p_campaign_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  week_start date,
  emails_sent bigint,
  leads_first_contacted bigint
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
  IF p_start_date IS NULL OR p_end_date IS NULL THEN
    RAISE EXCEPTION 'p_start_date and p_end_date are required';
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
  WITH weeks AS (
    SELECT generate_series(
      date_trunc('week', p_start_date::timestamp)::date,
      date_trunc('week', p_end_date::timestamp)::date,
      interval '1 week'
    )::date AS week_start
  ),
  agg AS (
    SELECT
      date_trunc('week', d.stat_date::timestamp)::date AS week_start,
      SUM(d.sent_count)::bigint AS emails_sent,
      SUM(d.leads_first_contacted)::bigint AS leads_first_contacted
    FROM public.campaign_stats_daily d
    INNER JOIN public.campaigns c ON c.id = d.campaign_id
    WHERE d.account_id = p_account_id
      AND d.stat_date >= p_start_date
      AND d.stat_date <= p_end_date
      AND c.deleted_at IS NULL
      AND c.source IS DISTINCT FROM 'smartlead'
      AND (
        p_campaign_ids IS NULL
        OR COALESCE(cardinality(p_campaign_ids), 0) = 0
        OR c.id = ANY (p_campaign_ids)
      )
    GROUP BY 1
  )
  SELECT
    w.week_start,
    COALESCE(a.emails_sent, 0)::bigint,
    COALESCE(a.leads_first_contacted, 0)::bigint
  FROM weeks w
  LEFT JOIN agg a ON a.week_start = w.week_start
  ORDER BY w.week_start;
END;
$$;

COMMENT ON FUNCTION public.account_weekly_outreach_volume(uuid, date, date, uuid[]) IS
  'Per ISO week (Monday UTC): emails sent and first-contacted leads from campaign_stats_daily.';

REVOKE ALL ON FUNCTION public.account_outreach_metrics(uuid, date, date, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.account_outreach_metrics(uuid, date, date, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.account_outreach_metrics(uuid, date, date, uuid[]) TO service_role;

REVOKE ALL ON FUNCTION public.account_outreach_stats_by_day(uuid, date, date, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.account_outreach_stats_by_day(uuid, date, date, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.account_outreach_stats_by_day(uuid, date, date, uuid[]) TO service_role;

REVOKE ALL ON FUNCTION public.campaign_stats_by_day(uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.campaign_stats_by_day(uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.campaign_stats_by_day(uuid, date, date) TO service_role;

REVOKE ALL ON FUNCTION public.account_daily_outreach_volume(uuid, date, date, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.account_daily_outreach_volume(uuid, date, date, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.account_daily_outreach_volume(uuid, date, date, uuid[]) TO service_role;

REVOKE ALL ON FUNCTION public.account_weekly_outreach_volume(uuid, date, date, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.account_weekly_outreach_volume(uuid, date, date, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.account_weekly_outreach_volume(uuid, date, date, uuid[]) TO service_role;

NOTIFY pgrst, 'reload schema';
