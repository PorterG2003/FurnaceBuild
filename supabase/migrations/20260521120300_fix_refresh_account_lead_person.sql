-- Fix private_refresh_account_lead_person SELECT INTO column mapping.

CREATE OR REPLACE FUNCTION private_refresh_account_lead_person(
  p_account_id uuid,
  p_global_lead_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign_count bigint;
  v_native_campaign_count bigint;
  v_smartlead_campaign_count bigint;
  v_email text;
  v_display_name text;
  v_first_name text;
  v_last_name text;
  v_company_list text;
  v_has_reply boolean;
  v_latest_activity_at timestamptz;
  v_newest_membership_created_at timestamptz;
BEGIN
  IF p_account_id IS NULL OR p_global_lead_id IS NULL OR btrim(p_global_lead_id) = '' THEN
    RETURN;
  END IF;

  WITH latest_replied_threads AS (
    SELECT DISTINCT ON (t.campaign_id, t.lead_id)
      t.lead_id,
      t.campaign_id,
      t.has_reply,
      t.last_message_at
    FROM public.email_threads t
    INNER JOIN public.leads l ON l.id = t.lead_id
    WHERE t.account_id = p_account_id
      AND l.global_lead_id = p_global_lead_id
      AND l.deleted_at IS NULL
      AND t.lead_id IS NOT NULL
    ORDER BY t.campaign_id, t.lead_id, t.last_message_at DESC
  ),
  membership_enriched AS (
    SELECT
      l.email,
      COALESCE(
        NULLIF(btrim(l.name), ''),
        NULLIF(btrim(concat_ws(' ', l.first_name, l.last_name)), '')
      ) AS display_name,
      l.first_name,
      l.last_name,
      l.company_name,
      l.created_at,
      COALESCE(rt.has_reply, false) AS has_reply,
      GREATEST(l.created_at, COALESCE(rt.last_message_at, l.created_at)) AS last_activity_at,
      CASE WHEN c.source = 'smartlead' THEN 1 ELSE 0 END AS is_smartlead
    FROM public.leads l
    LEFT JOIN public.campaigns c ON c.id = l.campaign_id
    LEFT JOIN latest_replied_threads rt
      ON rt.lead_id = l.id
     AND rt.campaign_id = l.campaign_id
    WHERE l.account_id = p_account_id
      AND l.global_lead_id = p_global_lead_id
      AND l.deleted_at IS NULL
  ),
  agg AS (
    SELECT
      COUNT(*)::bigint AS campaign_count,
      SUM(CASE WHEN is_smartlead = 0 THEN 1 ELSE 0 END)::bigint AS native_campaign_count,
      SUM(CASE WHEN is_smartlead = 1 THEN 1 ELSE 0 END)::bigint AS smartlead_campaign_count,
      (ARRAY_REMOVE(ARRAY_AGG(email ORDER BY created_at DESC), NULL))[1] AS email,
      (ARRAY_REMOVE(ARRAY_AGG(display_name ORDER BY created_at DESC), NULL))[1] AS display_name,
      (ARRAY_REMOVE(ARRAY_AGG(first_name ORDER BY created_at DESC), NULL))[1] AS first_name,
      (ARRAY_REMOVE(ARRAY_AGG(last_name ORDER BY created_at DESC), NULL))[1] AS last_name,
      STRING_AGG(DISTINCT company_name, ', ' ORDER BY company_name)
        FILTER (WHERE company_name IS NOT NULL AND btrim(company_name) <> '') AS company_list,
      BOOL_OR(has_reply) AS has_reply,
      MAX(last_activity_at) AS latest_activity_at,
      MAX(created_at) AS newest_membership_created_at
    FROM membership_enriched
  )
  SELECT
    agg.campaign_count,
    agg.native_campaign_count,
    agg.smartlead_campaign_count,
    agg.email,
    agg.display_name,
    agg.first_name,
    agg.last_name,
    agg.company_list,
    agg.has_reply,
    agg.latest_activity_at,
    agg.newest_membership_created_at
  INTO
    v_campaign_count,
    v_native_campaign_count,
    v_smartlead_campaign_count,
    v_email,
    v_display_name,
    v_first_name,
    v_last_name,
    v_company_list,
    v_has_reply,
    v_latest_activity_at,
    v_newest_membership_created_at
  FROM agg;

  IF v_campaign_count IS NULL OR v_campaign_count = 0 THEN
    DELETE FROM public.account_lead_people
    WHERE account_id = p_account_id
      AND global_lead_id = p_global_lead_id;
    RETURN;
  END IF;

  INSERT INTO public.account_lead_people (
    account_id,
    global_lead_id,
    email,
    display_name,
    first_name,
    last_name,
    campaign_count,
    native_campaign_count,
    smartlead_campaign_count,
    company_list,
    has_reply,
    latest_activity_at,
    newest_membership_created_at,
    search_text,
    updated_at
  )
  VALUES (
    p_account_id,
    p_global_lead_id,
    v_email,
    v_display_name,
    v_first_name,
    v_last_name,
    v_campaign_count,
    v_native_campaign_count,
    v_smartlead_campaign_count,
    v_company_list,
    COALESCE(v_has_reply, false),
    v_latest_activity_at,
    v_newest_membership_created_at,
    lower(
      concat_ws(
        ' ',
        COALESCE(v_email, ''),
        COALESCE(v_display_name, ''),
        COALESCE(v_company_list, '')
      )
    ),
    now()
  )
  ON CONFLICT (account_id, global_lead_id) DO UPDATE SET
    email = EXCLUDED.email,
    display_name = EXCLUDED.display_name,
    first_name = EXCLUDED.first_name,
    last_name = EXCLUDED.last_name,
    campaign_count = EXCLUDED.campaign_count,
    native_campaign_count = EXCLUDED.native_campaign_count,
    smartlead_campaign_count = EXCLUDED.smartlead_campaign_count,
    company_list = EXCLUDED.company_list,
    has_reply = EXCLUDED.has_reply,
    latest_activity_at = EXCLUDED.latest_activity_at,
    newest_membership_created_at = EXCLUDED.newest_membership_created_at,
    search_text = EXCLUDED.search_text,
    updated_at = now();
END;
$$;
