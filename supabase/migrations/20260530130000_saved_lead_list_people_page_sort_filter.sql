-- Extend saved_lead_list_people_page with explorer-aligned filters and sort,
-- scoped to static list membership.

DROP FUNCTION IF EXISTS public.saved_lead_list_people_page(uuid, uuid, integer, integer);

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
      t.campaign_id,
      t.lead_id,
      CASE
        WHEN t.category IN ('Interested', 'Neutral', 'Not Interested') THEN t.category
        ELSE NULL::text
      END AS reply_category,
      t.has_reply,
      t.last_message_at
    FROM public.email_threads t
    WHERE t.account_id = p_account_id
      AND t.lead_id IS NOT NULL
    ORDER BY t.campaign_id, t.lead_id, t.last_message_at DESC
  ),
  membership_enriched AS (
    SELECT
      l.global_lead_id,
      l.email,
      COALESCE(
        NULLIF(btrim(l.name), ''),
        NULLIF(btrim(concat_ws(' ', l.first_name, l.last_name)), '')
      ) AS display_name,
      l.first_name,
      l.last_name,
      l.campaign_id,
      l.company_name,
      l.created_at,
      COALESCE(e.state, 'not_started') AS enrollment_state,
      COALESCE(rt.reply_category, NULL::text) AS reply_category,
      COALESCE(rt.has_reply, false) AS has_reply,
      GREATEST(l.created_at, COALESCE(rt.last_message_at, l.created_at)) AS last_activity_at
    FROM public.leads l
    INNER JOIN members m ON m.global_lead_id = l.global_lead_id
    CROSS JOIN normalized_filters nf
    LEFT JOIN public.enrollments e
      ON e.lead_id = l.id
     AND e.campaign_id = l.campaign_id
     AND e.deleted_at IS NULL
    LEFT JOIN latest_replied_threads rt
      ON rt.lead_id = l.id
     AND rt.campaign_id = l.campaign_id
    WHERE l.account_id = p_account_id
      AND l.deleted_at IS NULL
      AND l.global_lead_id IS NOT NULL
  ),
  person_rollups AS (
    SELECT
      me.global_lead_id,
      (ARRAY_REMOVE(ARRAY_AGG(me.email ORDER BY me.created_at DESC), NULL))[1] AS email,
      (ARRAY_REMOVE(ARRAY_AGG(me.display_name ORDER BY me.created_at DESC), NULL))[1] AS display_name,
      (ARRAY_REMOVE(ARRAY_AGG(me.first_name ORDER BY me.created_at DESC), NULL))[1] AS first_name,
      (ARRAY_REMOVE(ARRAY_AGG(me.last_name ORDER BY me.created_at DESC), NULL))[1] AS last_name,
      COUNT(*)::bigint AS campaign_count,
      STRING_AGG(DISTINCT me.company_name, ', ' ORDER BY me.company_name)
        FILTER (WHERE me.company_name IS NOT NULL AND btrim(me.company_name) <> '') AS company_list,
      BOOL_OR(me.has_reply) AS has_reply,
      MAX(me.last_activity_at) AS latest_activity,
      MAX(me.created_at) AS newest_membership_created_at,
      BOOL_OR(COALESCE(array_position((SELECT campaign_ids FROM normalized_filters), me.campaign_id) IS NOT NULL, false)) AS matches_campaign_ids,
      BOOL_OR(COALESCE(array_position((SELECT enrollment_states FROM normalized_filters), me.enrollment_state) IS NOT NULL, false)) AS matches_enrollment_states,
      BOOL_OR(COALESCE(array_position((SELECT categorized_reply_categories FROM normalized_filters), me.reply_category) IS NOT NULL, false)) AS matches_reply_categories,
      BOOL_OR(me.reply_category IS NULL) AS has_not_categorized,
      lower(
        concat_ws(
          ' ',
          COALESCE((ARRAY_REMOVE(ARRAY_AGG(me.email ORDER BY me.created_at DESC), NULL))[1], ''),
          COALESCE((ARRAY_REMOVE(ARRAY_AGG(me.display_name ORDER BY me.created_at DESC), NULL))[1], ''),
          COALESCE(
            STRING_AGG(DISTINCT me.company_name, ' ' ORDER BY me.company_name)
              FILTER (WHERE me.company_name IS NOT NULL AND btrim(me.company_name) <> ''),
            ''
          )
        )
      ) AS search_text
    FROM membership_enriched me
    GROUP BY me.global_lead_id
  ),
  filtered AS (
    SELECT pr.*
    FROM person_rollups pr
    CROSS JOIN normalized_filters nf
    WHERE (
      COALESCE(array_length(nf.campaign_ids, 1), 0) = 0
      OR pr.matches_campaign_ids
    )
      AND (
        COALESCE(array_length(nf.enrollment_states, 1), 0) = 0
        OR pr.matches_enrollment_states
      )
      AND (
        COALESCE(array_length(nf.reply_categories, 1), 0) = 0
        OR pr.matches_reply_categories
        OR ('not_categorized' = ANY(nf.reply_categories) AND pr.has_not_categorized)
      )
      AND (
        COALESCE(array_length(nf.reply_statuses, 1), 0) = 0
        OR ('has_reply' = ANY(nf.reply_statuses) AND pr.has_reply)
        OR ('no_reply' = ANY(nf.reply_statuses) AND NOT pr.has_reply)
      )
      AND (
        nf.search_query IS NULL
        OR pr.search_text ILIKE '%' || lower(nf.search_query) || '%'
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
  'Paginated saved list members with explorer-aligned filters and sort, scoped to list membership.';

GRANT EXECUTE ON FUNCTION public.saved_lead_list_people_page(uuid, uuid, uuid[], text[], text[], text[], text, integer, integer, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.saved_lead_list_people_page(uuid, uuid, uuid[], text[], text[], text[], text, integer, integer, text, text) TO service_role;
