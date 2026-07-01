-- Enrollment progress state: not_started = unenrolled or active with no sent campaign email.
-- Aligns campaign dial, campaign leads filters, account explorer, and saved lists.

CREATE OR REPLACE FUNCTION public.enrollment_progress_state(
  p_enrollment_state text,
  p_enrollment_id uuid
) RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_enrollment_state IS NULL THEN 'not_started'
    WHEN p_enrollment_state IN ('paused', 'completed', 'stopped') THEN p_enrollment_state
    WHEN p_enrollment_state = 'active' AND EXISTS (
      SELECT 1
      FROM public.message_jobs mj
      INNER JOIN public.enrollments e
        ON e.id = mj.enrollment_id
       AND e.deleted_at IS NULL
      WHERE mj.enrollment_id = p_enrollment_id
        AND mj.status = 'sent'
        AND (mj.message_type = 'campaign' OR mj.message_type IS NULL)
    ) THEN 'active'
    WHEN p_enrollment_state = 'active' THEN 'not_started'
    ELSE 'not_started'
  END;
$$;

COMMENT ON FUNCTION public.enrollment_progress_state(text, uuid) IS
  'User-facing enrollment progress bucket: active without sent campaign email is not_started.';

CREATE OR REPLACE FUNCTION public.get_campaign_lead_progress_buckets(p_campaign_id uuid)
RETURNS TABLE (
  total_leads int,
  not_started int,
  in_progress int,
  paused int,
  completed int,
  stopped int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH campaign_leads AS (
    SELECT l.id AS lead_id
    FROM public.leads l
    INNER JOIN public.campaigns c ON c.id = l.campaign_id
    WHERE l.campaign_id = p_campaign_id
      AND l.deleted_at IS NULL
      AND c.deleted_at IS NULL
      AND (
        auth.uid() IS NULL
        OR c.account_id IN (SELECT account_id FROM public.account_users WHERE user_id = auth.uid())
      )
  ),
  lead_buckets AS (
    SELECT
      CASE
        WHEN e.id IS NULL THEN 'not_started'
        WHEN e.state IN ('paused', 'completed', 'stopped') THEN e.state
        ELSE public.enrollment_progress_state(e.state, e.id)
      END AS bucket
    FROM campaign_leads cl
    LEFT JOIN public.enrollments e
      ON e.lead_id = cl.lead_id
     AND e.campaign_id = p_campaign_id
     AND e.deleted_at IS NULL
  )
  SELECT
    COUNT(*)::int AS total_leads,
    COUNT(*) FILTER (WHERE bucket = 'not_started')::int AS not_started,
    COUNT(*) FILTER (WHERE bucket = 'active')::int AS in_progress,
    COUNT(*) FILTER (WHERE bucket = 'paused')::int AS paused,
    COUNT(*) FILTER (WHERE bucket = 'completed')::int AS completed,
    COUNT(*) FILTER (WHERE bucket = 'stopped')::int AS stopped
  FROM lead_buckets;
$$;

COMMENT ON FUNCTION public.get_campaign_lead_progress_buckets(uuid) IS
  'Campaign detail lead progress dial buckets; active-uncontacted enrollments count as not_started.';

REVOKE ALL ON FUNCTION public.get_campaign_lead_progress_buckets(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_campaign_lead_progress_buckets(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_campaign_lead_progress_buckets(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.get_campaign_contacted_lead_ids(p_campaign_id uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(DISTINCT e.lead_id), ARRAY[]::uuid[])
  FROM public.enrollments e
  INNER JOIN public.campaigns c ON c.id = e.campaign_id
  INNER JOIN public.message_jobs mj
    ON mj.enrollment_id = e.id
   AND mj.status = 'sent'
   AND (mj.message_type = 'campaign' OR mj.message_type IS NULL)
  WHERE e.campaign_id = p_campaign_id
    AND e.deleted_at IS NULL
    AND e.lead_id IS NOT NULL
    AND c.deleted_at IS NULL
    AND (
      auth.uid() IS NULL
      OR c.account_id IN (SELECT account_id FROM public.account_users WHERE user_id = auth.uid())
    );
$$;

COMMENT ON FUNCTION public.get_campaign_contacted_lead_ids(uuid) IS
  'Lead ids with at least one sent campaign email for filter scoping on campaign detail.';

REVOKE ALL ON FUNCTION public.get_campaign_contacted_lead_ids(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_campaign_contacted_lead_ids(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_campaign_contacted_lead_ids(uuid) TO service_role;

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
            AND public.enrollment_progress_state(e.state, e.id) = ANY(nf.enrollment_states)
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
            AND public.enrollment_progress_state(e.state, e.id) = ANY(nf.enrollment_states)
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

CREATE OR REPLACE FUNCTION public.private_account_lead_explorer_scope_ids(
  p_account_id uuid,
  p_global_lead_ids text[] DEFAULT NULL,
  p_campaign_ids uuid[] DEFAULT NULL,
  p_reply_statuses text[] DEFAULT NULL,
  p_enrollment_states text[] DEFAULT NULL,
  p_reply_categories text[] DEFAULT NULL,
  p_search text DEFAULT NULL
)
RETURNS SETOF text
LANGUAGE sql
STABLE
SECURITY DEFINER
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
      NULLIF(btrim(p_search), '') AS search_query
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
      AND COALESCE(array_length(COALESCE(p_reply_categories, ARRAY[]::text[]), 1), 0) > 0
    ORDER BY t.campaign_id, t.lead_id, t.last_message_at DESC
  )
  SELECT alp.global_lead_id
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
          AND public.enrollment_progress_state(e.state, e.id) = ANY(nf.enrollment_states)
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
    );
$$;

CREATE OR REPLACE FUNCTION public.private_saved_lead_list_view_scope_ids(
  p_account_id uuid,
  p_list_id uuid,
  p_campaign_ids uuid[] DEFAULT NULL,
  p_reply_statuses text[] DEFAULT NULL,
  p_enrollment_states text[] DEFAULT NULL,
  p_reply_categories text[] DEFAULT NULL,
  p_search text DEFAULT NULL
)
RETURNS SETOF text
LANGUAGE sql
STABLE
SECURITY DEFINER
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
      NULLIF(btrim(p_search), '') AS search_query
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
      AND COALESCE(array_length(COALESCE(p_reply_categories, ARRAY[]::text[]), 1), 0) > 0
    ORDER BY t.campaign_id, t.lead_id, t.last_message_at DESC
  ),
  people AS (
    SELECT
      m.global_lead_id,
      COALESCE(alp.has_reply, false) AS has_reply,
      alp.search_text
    FROM members m
    LEFT JOIN public.account_lead_people alp
      ON alp.account_id = p_account_id
     AND alp.global_lead_id = m.global_lead_id
  )
  SELECT p.global_lead_id
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
          AND public.enrollment_progress_state(e.state, e.id) = ANY(nf.enrollment_states)
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
    );
$$;

