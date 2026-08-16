-- Thread p_tag_ids (OR semantics) through saved-list paging and explorer/list-view bulk scopes.

DROP FUNCTION IF EXISTS public.private_account_lead_explorer_scope_ids(
  uuid, text[], uuid[], text[], text[], text[], text
);
DROP FUNCTION IF EXISTS public.private_saved_lead_list_view_scope_ids(
  uuid, uuid, uuid[], text[], text[], text[], text
);
DROP FUNCTION IF EXISTS public.saved_lead_list_people_page(
  uuid, uuid, uuid[], text[], text[], text[], text, integer, integer, text, text
);
DROP FUNCTION IF EXISTS public.saved_list_membership_review_summary_for_list_view(
  uuid, uuid, text, uuid[], text[], text[], text[], text
);
DROP FUNCTION IF EXISTS public.saved_list_membership_review_summary_for_explorer_view(
  uuid, uuid, text, text[], uuid[], text[], text[], text[], text
);
DROP FUNCTION IF EXISTS public.add_members_to_saved_lead_list_for_explorer_view(
  uuid, uuid, text, text[], uuid[], text[], text[], text[], text
);
DROP FUNCTION IF EXISTS public.remove_members_from_saved_lead_list_for_list_view(
  uuid, uuid, uuid[], text[], text[], text[], text
);
DROP FUNCTION IF EXISTS public.remove_explorer_view_from_saved_lead_list(
  uuid, uuid, text[], uuid[], text[], text[], text[], text
);

CREATE OR REPLACE FUNCTION public.private_account_lead_explorer_scope_ids(
  p_account_id uuid,
  p_global_lead_ids text[] DEFAULT NULL,
  p_campaign_ids uuid[] DEFAULT NULL,
  p_reply_statuses text[] DEFAULT NULL,
  p_enrollment_states text[] DEFAULT NULL,
  p_reply_categories text[] DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_tag_ids uuid[] DEFAULT NULL
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
      COALESCE(p_tag_ids, ARRAY[]::uuid[]) AS tag_ids,
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
      COALESCE(array_length(nf.tag_ids, 1), 0) = 0
      OR EXISTS (
        SELECT 1
        FROM public.lead_tag_assignments a
        WHERE a.account_id = p_account_id
          AND a.global_lead_id = alp.global_lead_id
          AND a.tag_id = ANY(nf.tag_ids)
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
  p_search text DEFAULT NULL,
  p_tag_ids uuid[] DEFAULT NULL
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
      COALESCE(p_tag_ids, ARRAY[]::uuid[]) AS tag_ids,
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
      COALESCE(array_length(nf.tag_ids, 1), 0) = 0
      OR EXISTS (
        SELECT 1
        FROM public.lead_tag_assignments a
        WHERE a.account_id = p_account_id
          AND a.global_lead_id = p.global_lead_id
          AND a.tag_id = ANY(nf.tag_ids)
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

REVOKE ALL ON FUNCTION public.private_account_lead_explorer_scope_ids(
  uuid, text[], uuid[], text[], text[], text[], text, uuid[]
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.private_saved_lead_list_view_scope_ids(
  uuid, uuid, uuid[], text[], text[], text[], text, uuid[]
) FROM PUBLIC;

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
  p_sort_direction text DEFAULT NULL,
  p_tag_ids uuid[] DEFAULT NULL
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
      COALESCE(p_tag_ids, ARRAY[]::uuid[]) AS tag_ids,
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
        COALESCE(array_length(nf.tag_ids, 1), 0) = 0
        OR EXISTS (
          SELECT 1
          FROM public.lead_tag_assignments a
          WHERE a.account_id = p_account_id
            AND a.global_lead_id = p.global_lead_id
            AND a.tag_id = ANY(nf.tag_ids)
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

GRANT EXECUTE ON FUNCTION public.saved_lead_list_people_page(
  uuid, uuid, uuid[], text[], text[], text[], text, integer, integer, text, text, uuid[]
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.saved_lead_list_people_page(
  uuid, uuid, uuid[], text[], text[], text[], text, integer, integer, text, text, uuid[]
) TO service_role;

CREATE OR REPLACE FUNCTION public.saved_list_membership_review_summary_for_list_view(
  p_account_id uuid,
  p_list_id uuid,
  p_mode text,
  p_campaign_ids uuid[] DEFAULT NULL,
  p_reply_statuses text[] DEFAULT NULL,
  p_enrollment_states text[] DEFAULT NULL,
  p_reply_categories text[] DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_tag_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_requested integer;
  v_in_list integer;
  v_to_add integer;
  v_already_member integer;
  v_not_in_account integer;
BEGIN
  PERFORM private_assert_account_member(p_account_id);

  IF NOT EXISTS (
    SELECT 1 FROM public.lead_saved_lists l
    WHERE l.id = p_list_id AND l.account_id = p_account_id
  ) THEN
    RAISE EXCEPTION 'Saved list not found for account';
  END IF;

  SELECT COUNT(*)::integer
  INTO v_requested
  FROM public.private_saved_lead_list_view_scope_ids(
    p_account_id, p_list_id, p_campaign_ids, p_reply_statuses,
    p_enrollment_states, p_reply_categories, p_search, p_tag_ids
  ) scope_id;

  IF lower(COALESCE(p_mode, '')) = 'remove' THEN
    v_in_list := v_requested;
    RETURN jsonb_build_object(
      'requested', v_requested,
      'inList', v_in_list,
      'toRemove', v_in_list,
      'notInList', 0
    );
  END IF;

  SELECT COUNT(*)::integer
  INTO v_already_member
  FROM public.private_saved_lead_list_view_scope_ids(
    p_account_id, p_list_id, p_campaign_ids, p_reply_statuses,
    p_enrollment_states, p_reply_categories, p_search, p_tag_ids
  ) scope_id
  WHERE EXISTS (
    SELECT 1
    FROM public.lead_saved_list_members m
    WHERE m.account_id = p_account_id
      AND m.list_id = p_list_id
      AND m.global_lead_id = scope_id
  );

  v_to_add := v_requested - v_already_member;
  v_not_in_account := 0;

  RETURN jsonb_build_object(
    'requested', v_requested,
    'alreadyMember', v_already_member,
    'toAdd', v_to_add,
    'notInAccount', v_not_in_account
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.saved_list_membership_review_summary_for_explorer_view(
  p_account_id uuid,
  p_list_id uuid,
  p_mode text,
  p_global_lead_ids text[] DEFAULT NULL,
  p_campaign_ids uuid[] DEFAULT NULL,
  p_reply_statuses text[] DEFAULT NULL,
  p_enrollment_states text[] DEFAULT NULL,
  p_reply_categories text[] DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_tag_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_requested integer;
  v_in_list integer;
  v_to_add integer;
  v_already_member integer;
  v_not_in_account integer;
BEGIN
  PERFORM private_assert_account_member(p_account_id);

  IF NOT EXISTS (
    SELECT 1 FROM public.lead_saved_lists l
    WHERE l.id = p_list_id AND l.account_id = p_account_id
  ) THEN
    RAISE EXCEPTION 'Saved list not found for account';
  END IF;

  SELECT COUNT(*)::integer
  INTO v_requested
  FROM public.private_account_lead_explorer_scope_ids(
    p_account_id, p_global_lead_ids, p_campaign_ids, p_reply_statuses,
    p_enrollment_states, p_reply_categories, p_search, p_tag_ids
  ) scope_id;

  IF lower(COALESCE(p_mode, '')) = 'remove' THEN
    SELECT COUNT(*)::integer
    INTO v_in_list
    FROM public.private_account_lead_explorer_scope_ids(
      p_account_id, p_global_lead_ids, p_campaign_ids, p_reply_statuses,
      p_enrollment_states, p_reply_categories, p_search, p_tag_ids
    ) scope_id
    WHERE EXISTS (
      SELECT 1
      FROM public.lead_saved_list_members m
      WHERE m.account_id = p_account_id
        AND m.list_id = p_list_id
        AND m.global_lead_id = scope_id
    );

    RETURN jsonb_build_object(
      'requested', v_requested,
      'inList', v_in_list,
      'toRemove', v_in_list,
      'notInList', v_requested - v_in_list
    );
  END IF;

  SELECT COUNT(*)::integer
  INTO v_already_member
  FROM public.private_account_lead_explorer_scope_ids(
    p_account_id, p_global_lead_ids, p_campaign_ids, p_reply_statuses,
    p_enrollment_states, p_reply_categories, p_search, p_tag_ids
  ) scope_id
  WHERE EXISTS (
    SELECT 1
    FROM public.lead_saved_list_members m
    WHERE m.account_id = p_account_id
      AND m.list_id = p_list_id
      AND m.global_lead_id = scope_id
  );

  SELECT COUNT(*)::integer
  INTO v_to_add
  FROM public.private_account_lead_explorer_scope_ids(
    p_account_id, p_global_lead_ids, p_campaign_ids, p_reply_statuses,
    p_enrollment_states, p_reply_categories, p_search, p_tag_ids
  ) scope_id
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.lead_saved_list_members m
    WHERE m.account_id = p_account_id
      AND m.list_id = p_list_id
      AND m.global_lead_id = scope_id
  );

  v_not_in_account := v_requested - v_already_member - v_to_add;

  RETURN jsonb_build_object(
    'requested', v_requested,
    'alreadyMember', v_already_member,
    'toAdd', v_to_add,
    'notInAccount', GREATEST(v_not_in_account, 0)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.add_members_to_saved_lead_list_for_explorer_view(
  p_account_id uuid,
  p_list_id uuid,
  p_source text DEFAULT 'selection',
  p_global_lead_ids text[] DEFAULT NULL,
  p_campaign_ids uuid[] DEFAULT NULL,
  p_reply_statuses text[] DEFAULT NULL,
  p_enrollment_states text[] DEFAULT NULL,
  p_reply_categories text[] DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_tag_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_requested integer;
  v_added integer;
  v_already_member integer;
  v_skipped_invalid integer;
  v_source text;
BEGIN
  PERFORM private_assert_account_member(p_account_id);

  IF NOT EXISTS (
    SELECT 1 FROM public.lead_saved_lists l
    WHERE l.id = p_list_id AND l.account_id = p_account_id
  ) THEN
    RAISE EXCEPTION 'Saved list not found for account';
  END IF;

  v_source := CASE
    WHEN lower(COALESCE(p_source, '')) IN ('selection', 'manual', 'csv') THEN lower(p_source)
    ELSE 'selection'
  END;

  SELECT COUNT(*)::integer
  INTO v_requested
  FROM public.private_account_lead_explorer_scope_ids(
    p_account_id, p_global_lead_ids, p_campaign_ids, p_reply_statuses,
    p_enrollment_states, p_reply_categories, p_search, p_tag_ids
  ) scope_id;

  IF v_requested = 0 THEN
    RETURN jsonb_build_object(
      'added', 0,
      'skippedAlreadyMember', 0,
      'skippedInvalid', 0
    );
  END IF;

  WITH scope AS (
    SELECT scope_id AS global_lead_id
    FROM public.private_account_lead_explorer_scope_ids(
      p_account_id, p_global_lead_ids, p_campaign_ids, p_reply_statuses,
      p_enrollment_states, p_reply_categories, p_search, p_tag_ids
    ) scope_id
  ),
  to_insert AS (
    SELECT s.global_lead_id
    FROM scope s
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.lead_saved_list_members m
      WHERE m.account_id = p_account_id
        AND m.list_id = p_list_id
        AND m.global_lead_id = s.global_lead_id
    )
  ),
  inserted AS (
    INSERT INTO public.lead_saved_list_members (list_id, account_id, global_lead_id, source)
    SELECT p_list_id, p_account_id, t.global_lead_id, v_source
    FROM to_insert t
    ON CONFLICT (list_id, global_lead_id) DO NOTHING
    RETURNING global_lead_id
  )
  SELECT COUNT(*)::integer INTO v_added FROM inserted;

  SELECT COUNT(*)::integer
  INTO v_already_member
  FROM public.private_account_lead_explorer_scope_ids(
    p_account_id, p_global_lead_ids, p_campaign_ids, p_reply_statuses,
    p_enrollment_states, p_reply_categories, p_search, p_tag_ids
  ) scope_id
  WHERE EXISTS (
    SELECT 1
    FROM public.lead_saved_list_members m
    WHERE m.account_id = p_account_id
      AND m.list_id = p_list_id
      AND m.global_lead_id = scope_id
  );

  v_skipped_invalid := GREATEST(v_requested - v_added - v_already_member, 0);

  RETURN jsonb_build_object(
    'added', v_added,
    'skippedAlreadyMember', v_already_member,
    'skippedInvalid', v_skipped_invalid
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_members_from_saved_lead_list_for_list_view(
  p_account_id uuid,
  p_list_id uuid,
  p_campaign_ids uuid[] DEFAULT NULL,
  p_reply_statuses text[] DEFAULT NULL,
  p_enrollment_states text[] DEFAULT NULL,
  p_reply_categories text[] DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_tag_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_requested integer;
  v_removed integer;
BEGIN
  PERFORM private_assert_account_member(p_account_id);

  IF NOT EXISTS (
    SELECT 1 FROM public.lead_saved_lists l
    WHERE l.id = p_list_id AND l.account_id = p_account_id
  ) THEN
    RAISE EXCEPTION 'Saved list not found for account';
  END IF;

  SELECT COUNT(*)::integer
  INTO v_requested
  FROM public.private_saved_lead_list_view_scope_ids(
    p_account_id, p_list_id, p_campaign_ids, p_reply_statuses,
    p_enrollment_states, p_reply_categories, p_search, p_tag_ids
  ) scope_id;

  IF v_requested = 0 THEN
    RETURN jsonb_build_object(
      'removed', 0,
      'skippedNotMember', 0
    );
  END IF;

  WITH scope AS (
    SELECT scope_id AS global_lead_id
    FROM public.private_saved_lead_list_view_scope_ids(
      p_account_id, p_list_id, p_campaign_ids, p_reply_statuses,
      p_enrollment_states, p_reply_categories, p_search, p_tag_ids
    ) scope_id
  ),
  deleted AS (
    DELETE FROM public.lead_saved_list_members m
    USING scope s
    WHERE m.account_id = p_account_id
      AND m.list_id = p_list_id
      AND m.global_lead_id = s.global_lead_id
    RETURNING m.global_lead_id
  )
  SELECT COUNT(*)::integer INTO v_removed FROM deleted;

  RETURN jsonb_build_object(
    'removed', v_removed,
    'skippedNotMember', GREATEST(v_requested - v_removed, 0)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_explorer_view_from_saved_lead_list(
  p_account_id uuid,
  p_list_id uuid,
  p_global_lead_ids text[] DEFAULT NULL,
  p_campaign_ids uuid[] DEFAULT NULL,
  p_reply_statuses text[] DEFAULT NULL,
  p_enrollment_states text[] DEFAULT NULL,
  p_reply_categories text[] DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_tag_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_requested integer;
  v_removed integer;
BEGIN
  PERFORM private_assert_account_member(p_account_id);

  IF NOT EXISTS (
    SELECT 1 FROM public.lead_saved_lists l
    WHERE l.id = p_list_id AND l.account_id = p_account_id
  ) THEN
    RAISE EXCEPTION 'Saved list not found for account';
  END IF;

  SELECT COUNT(*)::integer
  INTO v_requested
  FROM public.private_account_lead_explorer_scope_ids(
    p_account_id, p_global_lead_ids, p_campaign_ids, p_reply_statuses,
    p_enrollment_states, p_reply_categories, p_search, p_tag_ids
  ) scope_id;

  IF v_requested = 0 THEN
    RETURN jsonb_build_object(
      'removed', 0,
      'skippedNotMember', 0
    );
  END IF;

  WITH scope AS (
    SELECT scope_id AS global_lead_id
    FROM public.private_account_lead_explorer_scope_ids(
      p_account_id, p_global_lead_ids, p_campaign_ids, p_reply_statuses,
      p_enrollment_states, p_reply_categories, p_search, p_tag_ids
    ) scope_id
  ),
  deleted AS (
    DELETE FROM public.lead_saved_list_members m
    USING scope s
    WHERE m.account_id = p_account_id
      AND m.list_id = p_list_id
      AND m.global_lead_id = s.global_lead_id
    RETURNING m.global_lead_id
  )
  SELECT COUNT(*)::integer INTO v_removed FROM deleted;

  RETURN jsonb_build_object(
    'removed', v_removed,
    'skippedNotMember', GREATEST(v_requested - v_removed, 0)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.saved_list_membership_review_summary_for_list_view(
  uuid, uuid, text, uuid[], text[], text[], text[], text, uuid[]
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.saved_list_membership_review_summary_for_list_view(
  uuid, uuid, text, uuid[], text[], text[], text[], text, uuid[]
) TO service_role;
GRANT EXECUTE ON FUNCTION public.saved_list_membership_review_summary_for_explorer_view(
  uuid, uuid, text, text[], uuid[], text[], text[], text[], text, uuid[]
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.saved_list_membership_review_summary_for_explorer_view(
  uuid, uuid, text, text[], uuid[], text[], text[], text[], text, uuid[]
) TO service_role;
GRANT EXECUTE ON FUNCTION public.add_members_to_saved_lead_list_for_explorer_view(
  uuid, uuid, text, text[], uuid[], text[], text[], text[], text, uuid[]
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_members_to_saved_lead_list_for_explorer_view(
  uuid, uuid, text, text[], uuid[], text[], text[], text[], text, uuid[]
) TO service_role;
GRANT EXECUTE ON FUNCTION public.remove_members_from_saved_lead_list_for_list_view(
  uuid, uuid, uuid[], text[], text[], text[], text, uuid[]
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_members_from_saved_lead_list_for_list_view(
  uuid, uuid, uuid[], text[], text[], text[], text, uuid[]
) TO service_role;
GRANT EXECUTE ON FUNCTION public.remove_explorer_view_from_saved_lead_list(
  uuid, uuid, text[], uuid[], text[], text[], text[], text, uuid[]
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_explorer_view_from_saved_lead_list(
  uuid, uuid, text[], uuid[], text[], text[], text[], text, uuid[]
) TO service_role;
