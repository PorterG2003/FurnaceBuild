-- Persist account_lead_people at campaign_count = 0 after remove-from-campaign.
-- Drive explorer and saved lists from rollup / static membership instead of active leads only.

-- ---------------------------------------------------------------------------
-- Rollup: retain person row when all memberships are soft-deleted
-- ---------------------------------------------------------------------------
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
    WITH identity_fallback AS (
      SELECT
        l.email,
        COALESCE(
          NULLIF(btrim(l.name), ''),
          NULLIF(btrim(concat_ws(' ', l.first_name, l.last_name)), '')
        ) AS display_name,
        l.first_name,
        l.last_name,
        l.company_name,
        l.created_at
      FROM public.leads l
      WHERE l.account_id = p_account_id
        AND l.global_lead_id = p_global_lead_id
      ORDER BY COALESCE(l.updated_at, l.created_at) DESC, l.id DESC
      LIMIT 1
    ),
    thread_activity AS (
      SELECT
        BOOL_OR(t.has_reply) AS has_reply,
        MAX(t.last_message_at) AS latest_thread_at
      FROM public.email_threads t
      INNER JOIN public.leads l ON l.id = t.lead_id
      WHERE t.account_id = p_account_id
        AND l.global_lead_id = p_global_lead_id
    ),
    zero_agg AS (
      SELECT
        id.email,
        id.display_name,
        id.first_name,
        id.last_name,
        id.company_name,
        id.created_at,
        COALESCE(ta.has_reply, false) AS has_reply,
        GREATEST(
          id.created_at,
          COALESCE(ta.latest_thread_at, id.created_at)
        ) AS latest_activity_at
      FROM identity_fallback id
      CROSS JOIN thread_activity ta
    )
    SELECT
      za.email,
      za.display_name,
      za.first_name,
      za.last_name,
      CASE
        WHEN za.company_name IS NOT NULL AND btrim(za.company_name) <> '' THEN za.company_name
        ELSE NULL
      END,
      za.has_reply,
      za.latest_activity_at,
      za.created_at
    INTO
      v_email,
      v_display_name,
      v_first_name,
      v_last_name,
      v_company_list,
      v_has_reply,
      v_latest_activity_at,
      v_newest_membership_created_at
    FROM zero_agg za;

    IF v_email IS NULL AND v_display_name IS NULL THEN
      DELETE FROM public.account_lead_people
      WHERE account_id = p_account_id
        AND global_lead_id = p_global_lead_id;
      RETURN;
    END IF;

    v_campaign_count := 0;
    v_native_campaign_count := 0;
    v_smartlead_campaign_count := 0;
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
    COALESCE(v_campaign_count, 0),
    COALESCE(v_native_campaign_count, 0),
    COALESCE(v_smartlead_campaign_count, 0),
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

-- ---------------------------------------------------------------------------
-- Explorer: drive from account_lead_people (includes campaign_count = 0)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.account_lead_people_page(
  uuid,
  text[],
  uuid[],
  text[],
  text[],
  text[],
  text,
  integer,
  integer,
  text,
  text
);

CREATE OR REPLACE FUNCTION public.account_lead_people_page(
  p_account_id uuid,
  p_global_lead_ids text[] DEFAULT NULL,
  p_campaign_ids uuid[] DEFAULT NULL,
  p_reply_statuses text[] DEFAULT NULL,
  p_enrollment_states text[] DEFAULT NULL,
  p_reply_categories text[] DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 200,
  p_offset integer DEFAULT 0,
  p_sort_column text DEFAULT NULL,
  p_sort_direction text DEFAULT NULL
)
RETURNS TABLE (
  global_lead_id text,
  email text,
  display_name text,
  first_name text,
  last_name text,
  campaign_count bigint,
  company_list text,
  has_reply boolean,
  latest_activity timestamptz,
  newest_membership_created_at timestamptz,
  total_count bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH normalized_filters AS (
    SELECT
      COALESCE(p_global_lead_ids, ARRAY[]::text[]) AS global_lead_ids,
      COALESCE(p_campaign_ids, ARRAY[]::uuid[]) AS campaign_ids,
      COALESCE(p_reply_statuses, ARRAY[]::text[]) AS reply_statuses,
      COALESCE(p_enrollment_states, ARRAY[]::text[]) AS enrollment_states,
      COALESCE(p_reply_categories, ARRAY[]::text[]) AS reply_categories,
      ARRAY(
        SELECT category
        FROM unnest(COALESCE(p_reply_categories, ARRAY[]::text[])) AS category
        WHERE category <> 'not_categorized'
      ) AS categorized_reply_categories,
      NULLIF(btrim(p_search), '') AS search_query,
      CASE
        WHEN p_sort_column IN (
          'person-email',
          'person-name',
          'rollup-campaigns',
          'rollup-companies',
          'rollup-reply',
          'rollup-activity'
        ) THEN p_sort_column
        ELSE 'rollup-activity'
      END AS sort_column,
      CASE
        WHEN lower(COALESCE(p_sort_direction, '')) = 'asc' THEN 'asc'
        ELSE 'desc'
      END AS sort_direction
  ),
  latest_replied_threads AS (
    SELECT DISTINCT ON (t.campaign_id, t.lead_id)
      t.lead_id,
      t.campaign_id,
      CASE
        WHEN t.category IN ('Interested', 'Neutral', 'Not Interested') THEN t.category
        ELSE NULL::text
      END AS reply_category
    FROM public.email_threads t
    WHERE t.account_id = p_account_id
      AND t.lead_id IS NOT NULL
      AND (
        COALESCE(array_length(COALESCE(p_reply_categories, ARRAY[]::text[]), 1), 0) > 0
      )
    ORDER BY t.campaign_id, t.lead_id, t.last_message_at DESC
  ),
  filtered AS (
    SELECT alp.*
    FROM public.account_lead_people alp
    CROSS JOIN normalized_filters nf
    WHERE alp.account_id = p_account_id
      AND (
        COALESCE(array_length(nf.global_lead_ids, 1), 0) = 0
        OR alp.global_lead_id = ANY(nf.global_lead_ids)
      )
      AND (
        nf.search_query IS NULL
        OR alp.search_text ILIKE '%' || lower(nf.search_query) || '%'
      )
      AND (
        COALESCE(array_length(nf.reply_statuses, 1), 0) = 0
        OR ('has_reply' = ANY(nf.reply_statuses) AND alp.has_reply)
        OR ('no_reply' = ANY(nf.reply_statuses) AND NOT alp.has_reply)
      )
      AND (
        COALESCE(array_length(nf.campaign_ids, 1), 0) = 0
        OR EXISTS (
          SELECT 1
          FROM public.leads l
          WHERE l.account_id = p_account_id
            AND l.global_lead_id = alp.global_lead_id
            AND l.deleted_at IS NULL
            AND l.campaign_id = ANY(nf.campaign_ids)
        )
      )
      AND (
        COALESCE(array_length(nf.enrollment_states, 1), 0) = 0
        OR EXISTS (
          SELECT 1
          FROM public.leads l
          LEFT JOIN public.enrollments e
            ON e.lead_id = l.id
           AND e.campaign_id = l.campaign_id
           AND e.deleted_at IS NULL
          WHERE l.account_id = p_account_id
            AND l.global_lead_id = alp.global_lead_id
            AND l.deleted_at IS NULL
            AND COALESCE(e.state, 'not_started') = ANY(nf.enrollment_states)
        )
      )
      AND (
        COALESCE(array_length(nf.reply_categories, 1), 0) = 0
        OR EXISTS (
          SELECT 1
          FROM public.leads l
          LEFT JOIN latest_replied_threads rt
            ON rt.lead_id = l.id
           AND rt.campaign_id = l.campaign_id
          WHERE l.account_id = p_account_id
            AND l.global_lead_id = alp.global_lead_id
            AND l.deleted_at IS NULL
            AND (
              rt.reply_category = ANY(nf.categorized_reply_categories)
              OR ('not_categorized' = ANY(nf.reply_categories) AND rt.reply_category IS NULL)
            )
        )
      )
  )
  SELECT
    filtered.global_lead_id,
    filtered.email,
    filtered.display_name,
    filtered.first_name,
    filtered.last_name,
    filtered.campaign_count,
    filtered.company_list,
    filtered.has_reply,
    filtered.latest_activity_at AS latest_activity,
    filtered.newest_membership_created_at,
    COUNT(*) OVER()::bigint AS total_count
  FROM filtered
  CROSS JOIN normalized_filters nf
  ORDER BY
    CASE WHEN nf.sort_column = 'person-email' AND nf.sort_direction = 'asc' THEN filtered.email END ASC NULLS LAST,
    CASE WHEN nf.sort_column = 'person-email' AND nf.sort_direction = 'desc' THEN filtered.email END DESC NULLS LAST,
    CASE WHEN nf.sort_column = 'person-name' AND nf.sort_direction = 'asc' THEN filtered.display_name END ASC NULLS LAST,
    CASE WHEN nf.sort_column = 'person-name' AND nf.sort_direction = 'desc' THEN filtered.display_name END DESC NULLS LAST,
    CASE WHEN nf.sort_column = 'rollup-campaigns' AND nf.sort_direction = 'asc' THEN filtered.campaign_count END ASC NULLS LAST,
    CASE WHEN nf.sort_column = 'rollup-campaigns' AND nf.sort_direction = 'desc' THEN filtered.campaign_count END DESC NULLS LAST,
    CASE WHEN nf.sort_column = 'rollup-companies' AND nf.sort_direction = 'asc' THEN filtered.company_list END ASC NULLS LAST,
    CASE WHEN nf.sort_column = 'rollup-companies' AND nf.sort_direction = 'desc' THEN filtered.company_list END DESC NULLS LAST,
    CASE WHEN nf.sort_column = 'rollup-reply' AND nf.sort_direction = 'asc' THEN filtered.has_reply::int END ASC NULLS LAST,
    CASE WHEN nf.sort_column = 'rollup-reply' AND nf.sort_direction = 'desc' THEN filtered.has_reply::int END DESC NULLS LAST,
    CASE WHEN nf.sort_column = 'rollup-activity' AND nf.sort_direction = 'asc' THEN filtered.latest_activity_at END ASC NULLS LAST,
    CASE WHEN nf.sort_column = 'rollup-activity' AND nf.sort_direction = 'desc' THEN filtered.latest_activity_at END DESC NULLS LAST,
    filtered.newest_membership_created_at DESC NULLS LAST,
    filtered.email ASC NULLS LAST,
    filtered.global_lead_id ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 200), 1), 1000)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;

COMMENT ON FUNCTION public.account_lead_people_page(uuid, text[], uuid[], text[], text[], text[], text, integer, integer, text, text) IS
  'Account-wide leads explorer backed by account_lead_people; includes people with zero active campaigns.';

GRANT EXECUTE ON FUNCTION public.account_lead_people_page(uuid, text[], uuid[], text[], text[], text[], text, integer, integer, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.account_lead_people_page(uuid, text[], uuid[], text[], text[], text[], text, integer, integer, text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- Saved lists: static members first, rollup for display fields
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.saved_lead_list_people_page(uuid, uuid, uuid[], text[], text[], text[], text, integer, integer, text, text);

CREATE OR REPLACE FUNCTION public.saved_lead_list_people_page(
  p_account_id uuid,
  p_list_id uuid,
  p_campaign_ids uuid[] DEFAULT NULL,
  p_reply_statuses text[] DEFAULT NULL,
  p_enrollment_states text[] DEFAULT NULL,
  p_reply_categories text[] DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_sort_column text DEFAULT NULL,
  p_sort_direction text DEFAULT NULL
)
RETURNS TABLE (
  global_lead_id text,
  email text,
  display_name text,
  first_name text,
  last_name text,
  campaign_count bigint,
  company_list text,
  has_reply boolean,
  latest_activity timestamptz,
  newest_membership_created_at timestamptz,
  total_count bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH members AS (
    SELECT m.global_lead_id
    FROM public.lead_saved_list_members m
    INNER JOIN public.lead_saved_lists l ON l.id = m.list_id
    WHERE l.account_id = p_account_id
      AND l.id = p_list_id
  ),
  normalized_filters AS (
    SELECT
      COALESCE(p_campaign_ids, ARRAY[]::uuid[]) AS campaign_ids,
      COALESCE(p_reply_statuses, ARRAY[]::text[]) AS reply_statuses,
      COALESCE(p_enrollment_states, ARRAY[]::text[]) AS enrollment_states,
      COALESCE(p_reply_categories, ARRAY[]::text[]) AS reply_categories,
      ARRAY(
        SELECT category
        FROM unnest(COALESCE(p_reply_categories, ARRAY[]::text[])) AS category
        WHERE category <> 'not_categorized'
      ) AS categorized_reply_categories,
      NULLIF(btrim(p_search), '') AS search_query,
      CASE
        WHEN p_sort_column IN (
          'person-email',
          'person-name',
          'rollup-campaigns',
          'rollup-companies',
          'rollup-reply',
          'rollup-activity'
        ) THEN p_sort_column
        ELSE 'rollup-activity'
      END AS sort_column,
      CASE
        WHEN lower(COALESCE(p_sort_direction, '')) = 'asc' THEN 'asc'
        ELSE 'desc'
      END AS sort_direction
  ),
  latest_replied_threads AS (
    SELECT DISTINCT ON (t.campaign_id, t.lead_id)
      t.lead_id,
      t.campaign_id,
      CASE
        WHEN t.category IN ('Interested', 'Neutral', 'Not Interested') THEN t.category
        ELSE NULL::text
      END AS reply_category
    FROM public.email_threads t
    WHERE t.account_id = p_account_id
      AND t.lead_id IS NOT NULL
      AND (
        COALESCE(array_length(COALESCE(p_reply_categories, ARRAY[]::text[]), 1), 0) > 0
      )
    ORDER BY t.campaign_id, t.lead_id, t.last_message_at DESC
  ),
  people AS (
    SELECT
      m.global_lead_id,
      alp.email,
      alp.display_name,
      alp.first_name,
      alp.last_name,
      COALESCE(alp.campaign_count, 0)::bigint AS campaign_count,
      alp.company_list,
      COALESCE(alp.has_reply, false) AS has_reply,
      alp.latest_activity_at AS latest_activity,
      alp.newest_membership_created_at,
      alp.search_text
    FROM members m
    LEFT JOIN public.account_lead_people alp
      ON alp.account_id = p_account_id
     AND alp.global_lead_id = m.global_lead_id
  ),
  filtered AS (
    SELECT p.*
    FROM people p
    CROSS JOIN normalized_filters nf
    WHERE (
      nf.search_query IS NULL
      OR p.search_text ILIKE '%' || lower(nf.search_query) || '%'
    )
      AND (
        COALESCE(array_length(nf.reply_statuses, 1), 0) = 0
        OR ('has_reply' = ANY(nf.reply_statuses) AND p.has_reply)
        OR ('no_reply' = ANY(nf.reply_statuses) AND NOT p.has_reply)
      )
      AND (
        COALESCE(array_length(nf.campaign_ids, 1), 0) = 0
        OR EXISTS (
          SELECT 1
          FROM public.leads l
          WHERE l.account_id = p_account_id
            AND l.global_lead_id = p.global_lead_id
            AND l.deleted_at IS NULL
            AND l.campaign_id = ANY(nf.campaign_ids)
        )
      )
      AND (
        COALESCE(array_length(nf.enrollment_states, 1), 0) = 0
        OR EXISTS (
          SELECT 1
          FROM public.leads l
          LEFT JOIN public.enrollments e
            ON e.lead_id = l.id
           AND e.campaign_id = l.campaign_id
           AND e.deleted_at IS NULL
          WHERE l.account_id = p_account_id
            AND l.global_lead_id = p.global_lead_id
            AND l.deleted_at IS NULL
            AND COALESCE(e.state, 'not_started') = ANY(nf.enrollment_states)
        )
      )
      AND (
        COALESCE(array_length(nf.reply_categories, 1), 0) = 0
        OR EXISTS (
          SELECT 1
          FROM public.leads l
          LEFT JOIN latest_replied_threads rt
            ON rt.lead_id = l.id
           AND rt.campaign_id = l.campaign_id
          WHERE l.account_id = p_account_id
            AND l.global_lead_id = p.global_lead_id
            AND l.deleted_at IS NULL
            AND (
              rt.reply_category = ANY(nf.categorized_reply_categories)
              OR ('not_categorized' = ANY(nf.reply_categories) AND rt.reply_category IS NULL)
            )
        )
      )
  )
  SELECT
    filtered.global_lead_id,
    filtered.email,
    filtered.display_name,
    filtered.first_name,
    filtered.last_name,
    filtered.campaign_count,
    filtered.company_list,
    filtered.has_reply,
    filtered.latest_activity,
    filtered.newest_membership_created_at,
    COUNT(*) OVER()::bigint AS total_count
  FROM filtered
  CROSS JOIN normalized_filters nf
  ORDER BY
    CASE WHEN nf.sort_column = 'person-email' AND nf.sort_direction = 'asc' THEN filtered.email END ASC NULLS LAST,
    CASE WHEN nf.sort_column = 'person-email' AND nf.sort_direction = 'desc' THEN filtered.email END DESC NULLS LAST,
    CASE WHEN nf.sort_column = 'person-name' AND nf.sort_direction = 'asc' THEN filtered.display_name END ASC NULLS LAST,
    CASE WHEN nf.sort_column = 'person-name' AND nf.sort_direction = 'desc' THEN filtered.display_name END DESC NULLS LAST,
    CASE WHEN nf.sort_column = 'rollup-campaigns' AND nf.sort_direction = 'asc' THEN filtered.campaign_count END ASC NULLS LAST,
    CASE WHEN nf.sort_column = 'rollup-campaigns' AND nf.sort_direction = 'desc' THEN filtered.campaign_count END DESC NULLS LAST,
    CASE WHEN nf.sort_column = 'rollup-companies' AND nf.sort_direction = 'asc' THEN filtered.company_list END ASC NULLS LAST,
    CASE WHEN nf.sort_column = 'rollup-companies' AND nf.sort_direction = 'desc' THEN filtered.company_list END DESC NULLS LAST,
    CASE WHEN nf.sort_column = 'rollup-reply' AND nf.sort_direction = 'asc' THEN filtered.has_reply::int END ASC NULLS LAST,
    CASE WHEN nf.sort_column = 'rollup-reply' AND nf.sort_direction = 'desc' THEN filtered.has_reply::int END DESC NULLS LAST,
    CASE WHEN nf.sort_column = 'rollup-activity' AND nf.sort_direction = 'asc' THEN filtered.latest_activity END ASC NULLS LAST,
    CASE WHEN nf.sort_column = 'rollup-activity' AND nf.sort_direction = 'desc' THEN filtered.latest_activity END DESC NULLS LAST,
    filtered.newest_membership_created_at DESC NULLS LAST,
    filtered.email ASC NULLS LAST,
    filtered.global_lead_id ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 500)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;

COMMENT ON FUNCTION public.saved_lead_list_people_page(uuid, uuid, uuid[], text[], text[], text[], text, integer, integer, text, text) IS
  'Paginated saved list members (static membership) with rollup display fields; includes zero-campaign members.';

GRANT EXECUTE ON FUNCTION public.saved_lead_list_people_page(uuid, uuid, uuid[], text[], text[], text[], text, integer, integer, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.saved_lead_list_people_page(uuid, uuid, uuid[], text[], text[], text[], text, integer, integer, text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- Backfill: include soft-deleted leads and saved list members missing rollup
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.backfill_account_lead_people_batch(
  p_account_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 500
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_global_lead_id text;
  v_account_id uuid;
  v_count integer := 0;
BEGIN
  FOR v_account_id, v_global_lead_id IN
    SELECT DISTINCT pairs.account_id, pairs.global_lead_id
    FROM (
      SELECT l.account_id, l.global_lead_id
      FROM public.leads l
      WHERE l.global_lead_id IS NOT NULL
        AND (p_account_id IS NULL OR l.account_id = p_account_id)

      UNION

      SELECT m.account_id, m.global_lead_id
      FROM public.lead_saved_list_members m
      WHERE m.global_lead_id IS NOT NULL
        AND (p_account_id IS NULL OR m.account_id = p_account_id)
    ) pairs
    LEFT JOIN public.account_lead_people alp
      ON alp.account_id = pairs.account_id
     AND alp.global_lead_id = pairs.global_lead_id
    WHERE alp.global_lead_id IS NULL
    LIMIT GREATEST(p_limit, 1)
  LOOP
    PERFORM private_refresh_account_lead_person(v_account_id, v_global_lead_id);
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.backfill_account_lead_people_batch(uuid, integer) TO service_role;

-- One-time refresh for people missing rollup after prior remove behavior
DO $$
DECLARE
  v_pair record;
BEGIN
  FOR v_pair IN
    SELECT DISTINCT pairs.account_id, pairs.global_lead_id
    FROM (
      SELECT l.account_id, l.global_lead_id
      FROM public.leads l
      WHERE l.global_lead_id IS NOT NULL

      UNION

      SELECT m.account_id, m.global_lead_id
      FROM public.lead_saved_list_members m
      WHERE m.global_lead_id IS NOT NULL
    ) pairs
    LEFT JOIN public.account_lead_people alp
      ON alp.account_id = pairs.account_id
     AND alp.global_lead_id = pairs.global_lead_id
    WHERE alp.global_lead_id IS NULL
    LIMIT 10000
  LOOP
    PERFORM private_refresh_account_lead_person(v_pair.account_id, v_pair.global_lead_id);
  END LOOP;
END;
$$;
