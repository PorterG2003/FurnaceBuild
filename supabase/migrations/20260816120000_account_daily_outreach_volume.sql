-- Account daily outreach volume: emails sent + distinct leads first contacted per UTC day.
-- First contact is computed against full send history so a previously contacted lead
-- is not counted as new when it reappears in the selected window.

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
  WITH days AS (
    SELECT generate_series(p_start_date, p_end_date, interval '1 day')::date AS stat_date
  ),
  campaign_scope AS (
    SELECT c.id
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
  sent_events AS (
    SELECT
      ev.created_at,
      COALESCE(ev.lead_id, en.lead_id) AS lead_id,
      (ev.created_at AT TIME ZONE 'UTC')::date AS stat_date
    FROM public.events ev
    INNER JOIN campaign_scope cs ON cs.id = ev.campaign_id
    LEFT JOIN public.enrollments en ON en.id = ev.enrollment_id
    WHERE ev.event_type = 'sent'
      AND COALESCE(ev.lead_id, en.lead_id) IS NOT NULL
  ),
  sent_in_range AS (
    SELECT se.stat_date, COUNT(*)::bigint AS emails_sent
    FROM sent_events se
    WHERE se.stat_date BETWEEN p_start_date AND p_end_date
    GROUP BY se.stat_date
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
    COALESCE(s.emails_sent, 0)::bigint,
    COALESCE(f.leads_first_contacted, 0)::bigint
  FROM days d
  LEFT JOIN sent_in_range s ON s.stat_date = d.stat_date
  LEFT JOIN first_in_range f ON f.stat_date = d.stat_date
  ORDER BY d.stat_date;
END;
$$;

COMMENT ON FUNCTION public.account_daily_outreach_volume(uuid, date, date, uuid[]) IS
  'Per UTC calendar day: emails sent and distinct campaign-scoped leads whose first sent event falls on that day. First contact uses full send history, not the selected window.';

REVOKE ALL ON FUNCTION public.account_daily_outreach_volume(uuid, date, date, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.account_daily_outreach_volume(uuid, date, date, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.account_daily_outreach_volume(uuid, date, date, uuid[]) TO service_role;
