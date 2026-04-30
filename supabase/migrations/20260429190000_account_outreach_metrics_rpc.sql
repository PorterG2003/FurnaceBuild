-- ============================================
-- Migration: account_outreach_metrics RPC
-- ============================================
-- Furnace-only account rollup for the metrics page: sent / positive reply (event
-- counts), leads reached / in queue (COUNT DISTINCT lead_id). Optional
-- smartlead_import_warning when a migration finished on or after range start.

CREATE OR REPLACE FUNCTION public.account_outreach_metrics(
  p_account_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS TABLE (
  total_sent bigint,
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
    COALESCE(ev_sent.cnt, 0)::bigint,
    COALESCE(ev_pos.cnt, 0)::bigint,
    COALESCE(ev_reach.dcnt, 0)::bigint,
    COALESCE(q.inq, 0)::bigint,
    COALESCE(sl.warn, false)
  FROM (
    SELECT COUNT(*)::bigint AS cnt
    FROM public.events ev
    INNER JOIN public.campaigns c ON c.id = ev.campaign_id
    WHERE c.account_id = p_account_id
      AND c.deleted_at IS NULL
      AND c.source IS DISTINCT FROM 'smartlead'
      AND ev.event_type = 'sent'
      AND (ev.created_at AT TIME ZONE 'UTC')::date BETWEEN p_start_date AND p_end_date
  ) ev_sent
  CROSS JOIN (
    SELECT COUNT(*)::bigint AS cnt
    FROM public.events ev
    INNER JOIN public.campaigns c ON c.id = ev.campaign_id
    WHERE c.account_id = p_account_id
      AND c.deleted_at IS NULL
      AND c.source IS DISTINCT FROM 'smartlead'
      AND ev.event_type = 'replied'
      AND (ev.event_data->>'is_positive') = 'true'
      AND (ev.created_at AT TIME ZONE 'UTC')::date BETWEEN p_start_date AND p_end_date
  ) ev_pos
  CROSS JOIN (
    SELECT COUNT(DISTINCT x.lid)::bigint AS dcnt
    FROM (
      SELECT COALESCE(ev.lead_id, en.lead_id) AS lid
      FROM public.events ev
      INNER JOIN public.campaigns c ON c.id = ev.campaign_id
      LEFT JOIN public.enrollments en
        ON en.id = ev.enrollment_id
       AND en.deleted_at IS NULL
      WHERE c.account_id = p_account_id
        AND c.deleted_at IS NULL
        AND c.source IS DISTINCT FROM 'smartlead'
        AND ev.event_type = 'sent'
        AND (ev.created_at AT TIME ZONE 'UTC')::date BETWEEN p_start_date AND p_end_date
    ) x
    WHERE x.lid IS NOT NULL
  ) ev_reach
  CROSS JOIN (
    SELECT COUNT(DISTINCT e.lead_id)::bigint AS inq
    FROM public.enrollments e
    INNER JOIN public.campaigns c ON c.id = e.campaign_id
    WHERE c.account_id = p_account_id
      AND c.deleted_at IS NULL
      AND c.status = 'running'
      AND c.source IS DISTINCT FROM 'smartlead'
      AND e.deleted_at IS NULL
      AND e.state = 'active'
      AND e.lead_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.message_jobs mj
        WHERE mj.enrollment_id = e.id
          AND mj.status = 'sent'
          AND (mj.message_type = 'campaign' OR mj.message_type IS NULL)
      )
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

COMMENT ON FUNCTION public.account_outreach_metrics(uuid, date, date) IS
  'Account metrics page: Furnace-only sent/positive reply event counts in UTC date range; distinct lead_id for reached (sent) and in-queue (active running, no sent campaign job); smartlead_import_warning if a migration finished on or after range start.';

REVOKE ALL ON FUNCTION public.account_outreach_metrics(uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.account_outreach_metrics(uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.account_outreach_metrics(uuid, date, date) TO service_role;
