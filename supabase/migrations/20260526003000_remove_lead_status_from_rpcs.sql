-- Replace legacy leads.status filters with enrollment-based filters in RPCs.

DROP FUNCTION IF EXISTS public.campaign_leads_table_page(uuid, uuid[], text[], text, text, boolean, int, int);

CREATE OR REPLACE FUNCTION public.campaign_leads_table_page(
  p_campaign_id uuid,
  p_scoped_ids uuid[],
  p_search text,
  p_sort text,
  p_asc boolean,
  p_limit int,
  p_offset int
)
RETURNS TABLE (
  id uuid,
  email text,
  name text,
  first_name text,
  last_name text,
  company_name text,
  website text,
  linkedin_url text,
  company_linkedin_url text,
  phone_number text,
  source text,
  custom_lead_data jsonb,
  created_at timestamptz,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_sort text;
  v_order text;
  v_search text;
  v_pat text;
BEGIN
  IF p_campaign_id IS NULL THEN
    RAISE EXCEPTION 'p_campaign_id required';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 5000 THEN
    RAISE EXCEPTION 'p_limit out of range';
  END IF;
  IF p_offset IS NULL OR p_offset < 0 THEN
    RAISE EXCEPTION 'p_offset invalid';
  END IF;
  IF p_scoped_ids IS NULL OR COALESCE(array_length(p_scoped_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'p_scoped_ids required';
  END IF;

  v_sort := lower(trim(coalesce(p_sort, 'created_at')));
  IF v_sort NOT IN (
    'email', 'name', 'first_name', 'last_name', 'company_name', 'website',
    'linkedin_url', 'company_linkedin_url', 'phone_number', 'source', 'created_at'
  ) THEN
    v_sort := 'created_at';
  END IF;

  v_order := CASE WHEN coalesce(p_asc, false) THEN 'ASC NULLS LAST' ELSE 'DESC NULLS FIRST' END;
  v_search := NULLIF(trim(coalesce(p_search, '')), '');
  IF v_search IS NULL THEN
    v_pat := NULL;
  ELSE
    v_pat := '%' || v_search || '%';
  END IF;

  RETURN QUERY EXECUTE format(
    'SELECT
       l.id,
       l.email,
       l.name,
       l.first_name,
       l.last_name,
       l.company_name,
       l.website,
       l.linkedin_url,
       l.company_linkedin_url,
       l.phone_number,
       l.source,
       l.custom_lead_data,
       l.created_at,
       COUNT(*) OVER()::bigint AS total_count
     FROM public.leads l
     WHERE l.campaign_id = $1
       AND l.deleted_at IS NULL
       AND l.id = ANY($2::uuid[])
       AND (
         $3::text IS NULL
         OR l.email ILIKE $3
         OR l.name ILIKE $3
         OR l.first_name ILIKE $3
         OR l.last_name ILIKE $3
         OR l.company_name ILIKE $3
         OR l.phone_number ILIKE $3
         OR l.website ILIKE $3
         OR l.linkedin_url ILIKE $3
       )
     ORDER BY l.%I %s
     LIMIT $4 OFFSET $5',
    v_sort,
    v_order
  )
    USING p_campaign_id, p_scoped_ids, v_pat, p_limit, p_offset;
END;
$$;

COMMENT ON FUNCTION public.campaign_leads_table_page(uuid, uuid[], text, text, boolean, int, int) IS
  'Paginated campaign leads with scoped uuid[] in RPC body. Enrollment/reply filters are applied in app layer before calling this RPC.';

GRANT EXECUTE ON FUNCTION public.campaign_leads_table_page(uuid, uuid[], text, text, boolean, int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.campaign_leads_table_page(uuid, uuid[], text, text, boolean, int, int) TO service_role;

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
      AND (
        COALESCE(array_length(nf.global_lead_ids, 1), 0) = 0
        OR l.global_lead_id = ANY(nf.global_lead_ids)
      )
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
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 200), 1), 1000)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;

COMMENT ON FUNCTION public.account_lead_people_page(uuid, text[], uuid[], text[], text[], text[], text, integer, integer, text, text) IS
  'Account-wide one-row-per-person leads explorer with enrollment-based filters and static global_lead_id scoping.';

GRANT EXECUTE ON FUNCTION public.account_lead_people_page(uuid, text[], uuid[], text[], text[], text[], text, integer, integer, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.account_lead_people_page(uuid, text[], uuid[], text[], text[], text[], text, integer, integer, text, text) TO service_role;

-- Replace-lead flow: stop copying or setting legacy leads.status.
CREATE OR REPLACE FUNCTION public.replace_lead_with_new_contact(
  p_old_lead_id uuid,
  p_new_email text,
  p_new_name text DEFAULT NULL,
  p_new_first_name text DEFAULT NULL,
  p_new_last_name text DEFAULT NULL,
  p_new_phone_number text DEFAULT NULL,
  p_reason public.replacement_reason_enum DEFAULT 'manual_referral',
  p_reason_note text DEFAULT NULL,
  p_source_message_id uuid DEFAULT NULL
)
RETURNS TABLE (
  replacement_id uuid,
  new_lead_id uuid,
  enrollment_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_lead public.leads%ROWTYPE;
  v_new_lead_id uuid;
  v_replacement_id uuid;
  v_moved_enrollment_id uuid;
  v_now timestamptz := now();
  v_new_email text := NULLIF(lower(trim(p_new_email)), '');
  v_new_name text := NULLIF(trim(p_new_name), '');
  v_new_first_name text := NULLIF(trim(p_new_first_name), '');
  v_new_last_name text := NULLIF(trim(p_new_last_name), '');
  v_new_phone text := NULLIF(trim(p_new_phone_number), '');
BEGIN
  IF p_old_lead_id IS NULL THEN
    RAISE EXCEPTION 'old_lead_id is required';
  END IF;

  IF v_new_email IS NULL THEN
    RAISE EXCEPTION 'new_email is required';
  END IF;

  SELECT *
  INTO v_old_lead
  FROM public.leads
  WHERE id = p_old_lead_id
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lead not found or already removed';
  END IF;

  IF auth.uid() IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.account_users au
      WHERE au.account_id = v_old_lead.account_id
        AND au.user_id = auth.uid()
    ) THEN
      RAISE EXCEPTION 'Forbidden';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.lead_replacements lr
    WHERE lr.old_lead_id = v_old_lead.id
      AND lr.status <> 'cancelled'
  ) THEN
    RAISE EXCEPTION 'Lead already has a replacement';
  END IF;

  IF v_old_lead.email IS NOT NULL AND lower(trim(v_old_lead.email)) = v_new_email THEN
    RAISE EXCEPTION 'Replacement email must differ from the original lead email';
  END IF;

  IF p_source_message_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.email_messages em
      JOIN public.email_threads et ON et.id = em.thread_id
      WHERE em.id = p_source_message_id
        AND et.account_id = v_old_lead.account_id
    ) THEN
      RAISE EXCEPTION 'source_message_id does not belong to this account';
    END IF;
  END IF;

  INSERT INTO public.leads (
    campaign_id,
    bucket_id,
    account_id,
    email,
    name,
    first_name,
    last_name,
    company_name,
    website,
    linkedin_url,
    company_linkedin_url,
    phone_number,
    source,
    custom_lead_data,
    global_lead_id,
    smartlead_lead_id,
    mailbox_id,
    deleted_at,
    created_at,
    updated_at
  ) VALUES (
    v_old_lead.campaign_id,
    v_old_lead.bucket_id,
    v_old_lead.account_id,
    v_new_email,
    v_new_name,
    v_new_first_name,
    v_new_last_name,
    v_old_lead.company_name,
    v_old_lead.website,
    v_old_lead.linkedin_url,
    v_old_lead.company_linkedin_url,
    COALESCE(v_new_phone, v_old_lead.phone_number),
    v_old_lead.source,
    v_old_lead.custom_lead_data,
    public.generate_global_lead_id(v_new_email),
    NULL,
    v_old_lead.mailbox_id,
    NULL,
    v_now,
    v_now
  )
  RETURNING id INTO v_new_lead_id;

  UPDATE public.enrollments
  SET
    lead_id = v_new_lead_id,
    updated_at = v_now
  WHERE campaign_id = v_old_lead.campaign_id
    AND lead_id = v_old_lead.id
    AND deleted_at IS NULL
  RETURNING id INTO v_moved_enrollment_id;

  UPDATE public.message_jobs
  SET
    lead_id = v_new_lead_id,
    updated_at = v_now
  WHERE lead_id = v_old_lead.id
    AND status IN ('queued', 'reserved');

  UPDATE public.email_threads
  SET
    lead_id = v_new_lead_id,
    participants = CASE
      WHEN v_new_email IS NULL THEN participants
      WHEN participants @> ARRAY[v_new_email]::text[] THEN participants
      ELSE array_append(COALESCE(participants, ARRAY[]::text[]), v_new_email)
    END,
    updated_at = v_now
  WHERE lead_id = v_old_lead.id;

  UPDATE public.leads
  SET
    deleted_at = v_now,
    updated_at = v_now
  WHERE id = v_old_lead.id;

  INSERT INTO public.lead_replacements (
    account_id,
    campaign_id,
    old_lead_id,
    new_lead_id,
    status,
    reason,
    reason_note,
    source_message_id,
    created_by,
    created_at,
    completed_at
  ) VALUES (
    v_old_lead.account_id,
    v_old_lead.campaign_id,
    v_old_lead.id,
    v_new_lead_id,
    'completed',
    p_reason,
    NULLIF(trim(p_reason_note), ''),
    p_source_message_id,
    auth.uid(),
    v_now,
    v_now
  )
  RETURNING id INTO v_replacement_id;

  RETURN QUERY
  SELECT v_replacement_id, v_new_lead_id, v_moved_enrollment_id;
END;
$$;
