-- Apply tag/verification metadata on import; filter explorer by lead tags.

CREATE OR REPLACE FUNCTION public.import_api_leads_to_campaign(
  p_account_id uuid,
  p_campaign_id uuid,
  p_leads jsonb,
  p_options jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign public.campaigns%ROWTYPE;
  v_required_keys text[];
  v_lead jsonb;
  v_email text;
  v_global_lead_id text;
  v_custom jsonb;
  v_key text;
  v_missing boolean;
  v_existing public.leads%ROWTYPE;
  v_created integer := 0;
  v_updated integer := 0;
  v_enrolled integer := 0;
  v_skipped integer := 0;
  v_incomplete integer := 0;
  v_failed integer := 0;
  v_errors jsonb := '[]'::jsonb;
  v_lead_id uuid;
  v_now timestamptz := now();
  v_max_errors integer := 100;
  v_touched_global_ids text[] := ARRAY[]::text[];
  v_emit_row_webhooks boolean := COALESCE((p_options ->> 'emit_row_webhooks')::boolean, false);
BEGIN
  IF auth.uid() IS NOT NULL THEN
    PERFORM private_assert_account_member(p_account_id);
  END IF;

  SELECT * INTO v_campaign FROM public.campaigns c WHERE c.id = p_campaign_id;
  IF NOT FOUND OR v_campaign.account_id IS DISTINCT FROM p_account_id THEN
    RAISE EXCEPTION 'Campaign not found for this account.' USING ERRCODE = 'P0002';
  END IF;
  IF v_campaign.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Campaign has been deleted.' USING ERRCODE = 'P0002';
  END IF;
  IF v_campaign.source = 'smartlead' THEN
    RAISE EXCEPTION 'Smartlead campaigns are read-only.' USING ERRCODE = '42501';
  END IF;
  IF v_campaign.bucket_id IS NULL THEN
    RAISE EXCEPTION 'Campaign is missing a bucket.' USING ERRCODE = 'P0001';
  END IF;

  v_required_keys := private_campaign_custom_field_keys(v_campaign.flow_data);
  PERFORM set_config('app.skip_lead_rollup_refresh', 'true', true);

  FOR v_lead IN SELECT value FROM jsonb_array_elements(COALESCE(p_leads, '[]'::jsonb)) LOOP
    BEGIN
      v_email := lower(btrim(v_lead ->> 'email'));
      IF v_email IS NULL OR v_email = '' THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;

      v_global_lead_id := encode(extensions.digest(convert_to(v_email, 'utf8'), 'sha256'::text), 'hex');
      v_custom := COALESCE(v_lead -> 'custom_lead_data', '{}'::jsonb);
      v_missing := false;
      FOREACH v_key IN ARRAY v_required_keys LOOP
        IF NOT (v_custom ? v_key) OR v_custom ->> v_key IS NULL OR btrim(v_custom ->> v_key) = '' THEN
          v_missing := true;
          EXIT;
        END IF;
      END LOOP;
      IF v_missing THEN
        v_incomplete := v_incomplete + 1;
      END IF;

      SELECT l.* INTO v_existing
      FROM public.leads l
      WHERE l.campaign_id = p_campaign_id
        AND l.account_id = p_account_id
        AND l.email = v_email
        AND l.deleted_at IS NULL
      LIMIT 1;

      IF FOUND THEN
        UPDATE public.leads l
        SET
          name = COALESCE(NULLIF(btrim(v_lead ->> 'name'), ''), l.name),
          first_name = COALESCE(v_lead ->> 'first_name', l.first_name),
          last_name = COALESCE(v_lead ->> 'last_name', l.last_name),
          company_name = COALESCE(v_lead ->> 'company_name', l.company_name),
          website = COALESCE(v_lead ->> 'website', l.website),
          linkedin_url = COALESCE(v_lead ->> 'linkedin_url', l.linkedin_url),
          company_linkedin_url = COALESCE(v_lead ->> 'company_linkedin_url', l.company_linkedin_url),
          phone_number = COALESCE(v_lead ->> 'phone_number', l.phone_number),
          mobile_phone_number = COALESCE(v_lead ->> 'mobile_phone_number', l.mobile_phone_number),
          custom_lead_data = CASE
            WHEN v_custom = '{}'::jsonb THEN l.custom_lead_data
            ELSE COALESCE(l.custom_lead_data, '{}'::jsonb) || v_custom
          END,
          source = 'api',
          updated_at = v_now
        WHERE l.id = v_existing.id;
        v_lead_id := v_existing.id;
        v_updated := v_updated + 1;
      ELSE
        INSERT INTO public.leads (
          campaign_id, bucket_id, account_id, email, name, first_name, last_name,
          company_name, website, linkedin_url, company_linkedin_url, phone_number, mobile_phone_number,
          global_lead_id, source, custom_lead_data, created_at, updated_at
        )
        VALUES (
          p_campaign_id, v_campaign.bucket_id, p_account_id, v_email,
          NULLIF(btrim(v_lead ->> 'name'), ''),
          v_lead ->> 'first_name', v_lead ->> 'last_name',
          v_lead ->> 'company_name', v_lead ->> 'website', v_lead ->> 'linkedin_url',
          v_lead ->> 'company_linkedin_url',
          NULLIF(btrim(v_lead ->> 'phone_number'), ''),
          NULLIF(btrim(v_lead ->> 'mobile_phone_number'), ''),
          v_global_lead_id, 'api',
          CASE WHEN v_custom = '{}'::jsonb THEN NULL ELSE v_custom END,
          v_now, v_now
        )
        RETURNING id INTO v_lead_id;
        v_created := v_created + 1;
      END IF;

      INSERT INTO public.enrollments (
        campaign_id, account_id, lead_id, current_node_id, state,
        next_run_at, flow_position, deleted_at, created_at, updated_at
      )
      VALUES (
        p_campaign_id, p_account_id, v_lead_id, NULL, 'active',
        v_now, '{}'::jsonb, NULL, v_now, v_now
      )
      ON CONFLICT (campaign_id, lead_id) DO NOTHING;

      PERFORM public.private_apply_lead_import_metadata(
        p_account_id, v_global_lead_id, v_email, v_lead
      );

      v_enrolled := v_enrolled + 1;
      v_touched_global_ids := array_append(v_touched_global_ids, v_global_lead_id);
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      IF jsonb_array_length(v_errors) < v_max_errors THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object('message', SQLERRM));
      END IF;
    END;
  END LOOP;

  PERFORM set_config('app.skip_lead_rollup_refresh', 'false', true);

  IF COALESCE(array_length(v_touched_global_ids, 1), 0) > 0 THEN
    FOREACH v_global_lead_id IN ARRAY (
      SELECT COALESCE(array_agg(DISTINCT gid), ARRAY[]::text[]) FROM unnest(v_touched_global_ids) AS gid
    ) LOOP
      PERFORM private_refresh_account_lead_person(p_account_id, v_global_lead_id);
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'created', v_created,
    'updated', v_updated,
    'enrolled', v_enrolled,
    'skipped', v_skipped,
    'incomplete', v_incomplete,
    'failed', v_failed,
    'errors', v_errors,
    'emit_row_webhooks', v_emit_row_webhooks
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.import_api_leads_to_campaign(uuid, uuid, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.import_api_leads_to_campaign(uuid, uuid, jsonb, jsonb) TO service_role;

DROP FUNCTION IF EXISTS public.account_lead_people_page(
  uuid, text[], uuid[], text[], text[], text[], text, integer, integer, text, text
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

COMMENT ON FUNCTION public.account_lead_people_page(
  uuid, text[], uuid[], text[], text[], text[], text, integer, integer, text, text, uuid[]
) IS
  'Account people explorer page. p_tag_ids is OR-semantics over lead_tag_assignments.';

GRANT EXECUTE ON FUNCTION public.account_lead_people_page(
  uuid, text[], uuid[], text[], text[], text[], text, integer, integer, text, text, uuid[]
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.account_lead_people_page(
  uuid, text[], uuid[], text[], text[], text[], text, integer, integer, text, text, uuid[]
) TO service_role;
