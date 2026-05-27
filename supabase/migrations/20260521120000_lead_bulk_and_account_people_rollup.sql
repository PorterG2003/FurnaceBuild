-- ============================================
-- Migration: account_lead_people rollup + bulk add-to-campaign RPCs
-- ============================================

-- ---------------------------------------------------------------------------
-- Rollup table: one row per (account_id, global_lead_id)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.account_lead_people (
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  global_lead_id text NOT NULL,
  email text,
  display_name text,
  first_name text,
  last_name text,
  campaign_count bigint NOT NULL DEFAULT 0,
  native_campaign_count bigint NOT NULL DEFAULT 0,
  smartlead_campaign_count bigint NOT NULL DEFAULT 0,
  company_list text,
  has_reply boolean NOT NULL DEFAULT false,
  latest_activity_at timestamptz,
  newest_membership_created_at timestamptz,
  search_text text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, global_lead_id)
);

CREATE INDEX IF NOT EXISTS account_lead_people_account_activity_idx
  ON public.account_lead_people (account_id, latest_activity_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS account_lead_people_account_email_idx
  ON public.account_lead_people (account_id, email);

CREATE INDEX IF NOT EXISTS account_lead_people_account_campaign_count_idx
  ON public.account_lead_people (account_id, campaign_count DESC);

COMMENT ON TABLE public.account_lead_people IS
  'Denormalized one-row-per-person rollup for account leads explorer and bulk review stats.';

ALTER TABLE public.account_lead_people ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS account_member_select ON public.account_lead_people;
CREATE POLICY account_member_select ON public.account_lead_people FOR SELECT
  USING (account_id IN (SELECT account_id FROM public.account_users WHERE user_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private_assert_account_member(p_account_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.account_users au
    WHERE au.account_id = p_account_id
      AND au.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Account membership required' USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION private_assert_account_member(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private_campaign_custom_field_keys(p_flow_data jsonb)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    array_agg(DISTINCT btrim(key)) FILTER (WHERE btrim(key) <> ''),
    ARRAY[]::text[]
  )
  FROM jsonb_array_elements(COALESCE(p_flow_data -> 'nodes', '[]'::jsonb)) AS node
  CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE
      WHEN jsonb_typeof(node -> 'data' -> 'customFieldKeys') = 'array'
        THEN node -> 'data' -> 'customFieldKeys'
      ELSE '[]'::jsonb
    END
  ) AS key
  WHERE node ->> 'type' = 'leadSource';
$$;

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

REVOKE ALL ON FUNCTION private_refresh_account_lead_person(uuid, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private_trigger_refresh_account_lead_person()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id uuid;
  v_global_lead_id text;
BEGIN
  IF COALESCE(current_setting('app.skip_lead_rollup_refresh', true), '') = 'true' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'leads' THEN
    IF TG_OP = 'DELETE' THEN
      v_account_id := OLD.account_id;
      v_global_lead_id := OLD.global_lead_id;
    ELSE
      v_account_id := NEW.account_id;
      v_global_lead_id := NEW.global_lead_id;
    END IF;
  ELSIF TG_TABLE_NAME = 'enrollments' THEN
    SELECT l.account_id, l.global_lead_id
    INTO v_account_id, v_global_lead_id
    FROM public.leads l
    WHERE l.id = COALESCE(NEW.lead_id, OLD.lead_id);
  ELSIF TG_TABLE_NAME = 'email_threads' THEN
    v_account_id := COALESCE(NEW.account_id, OLD.account_id);
    SELECT l.global_lead_id
    INTO v_global_lead_id
    FROM public.leads l
    WHERE l.id = COALESCE(NEW.lead_id, OLD.lead_id);
  END IF;

  IF v_account_id IS NOT NULL AND v_global_lead_id IS NOT NULL THEN
    PERFORM private_refresh_account_lead_person(v_account_id, v_global_lead_id);
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS refresh_account_lead_person_on_leads ON public.leads;
CREATE TRIGGER refresh_account_lead_person_on_leads
  AFTER INSERT OR UPDATE OF email, name, first_name, last_name, company_name, deleted_at, global_lead_id, account_id
  OR DELETE ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION private_trigger_refresh_account_lead_person();

DROP TRIGGER IF EXISTS refresh_account_lead_person_on_enrollments ON public.enrollments;
CREATE TRIGGER refresh_account_lead_person_on_enrollments
  AFTER INSERT OR UPDATE OR DELETE ON public.enrollments
  FOR EACH ROW
  EXECUTE FUNCTION private_trigger_refresh_account_lead_person();

DROP TRIGGER IF EXISTS refresh_account_lead_person_on_email_threads ON public.email_threads;
CREATE TRIGGER refresh_account_lead_person_on_email_threads
  AFTER INSERT OR UPDATE OF has_reply, last_message_at, category, lead_id OR DELETE ON public.email_threads
  FOR EACH ROW
  EXECUTE FUNCTION private_trigger_refresh_account_lead_person();

-- ---------------------------------------------------------------------------
-- Bulk add global leads to campaign
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.add_global_leads_to_campaign(
  p_account_id uuid,
  p_campaign_id uuid,
  p_global_lead_ids text[],
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
  v_global_lead_id text;
  v_source public.leads%ROWTYPE;
  v_existing public.leads%ROWTYPE;
  v_custom jsonb;
  v_key text;
  v_missing boolean;
  v_created integer := 0;
  v_updated integer := 0;
  v_enrolled integer := 0;
  v_skipped integer := 0;
  v_failed integer := 0;
  v_errors jsonb := '[]'::jsonb;
  v_lead_ids uuid[] := ARRAY[]::uuid[];
  v_lead_id uuid;
  v_now timestamptz := now();
  v_slice_size integer := 500;
  v_max_errors integer := 100;
  v_touched_global_ids text[] := ARRAY[]::text[];
  v_unique_ids text[];
BEGIN
  PERFORM private_assert_account_member(p_account_id);

  SELECT * INTO v_campaign
  FROM public.campaigns c
  WHERE c.id = p_campaign_id;

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

  SELECT COALESCE(array_agg(DISTINCT id ORDER BY id), ARRAY[]::text[])
  INTO v_unique_ids
  FROM unnest(COALESCE(p_global_lead_ids, ARRAY[]::text[])) AS id
  WHERE id IS NOT NULL AND btrim(id) <> '';

  IF COALESCE(array_length(v_unique_ids, 1), 0) = 0 THEN
    RETURN jsonb_build_object(
      'created', 0,
      'updated', 0,
      'enrolled', 0,
      'skipped', 0,
      'failed', 0,
      'errors', '[]'::jsonb
    );
  END IF;

  PERFORM set_config('app.skip_lead_rollup_refresh', 'true', true);

  FOREACH v_global_lead_id IN ARRAY v_unique_ids LOOP
    BEGIN
      SELECT l.*
      INTO v_source
      FROM public.leads l
      WHERE l.account_id = p_account_id
        AND l.global_lead_id = v_global_lead_id
        AND l.deleted_at IS NULL
        AND l.campaign_id IS DISTINCT FROM p_campaign_id
      ORDER BY l.created_at DESC, l.id DESC
      LIMIT 1;

      IF NOT FOUND THEN
        SELECT l.*
        INTO v_source
        FROM public.leads l
        WHERE l.account_id = p_account_id
          AND l.global_lead_id = v_global_lead_id
          AND l.deleted_at IS NULL
        ORDER BY l.created_at DESC, l.id DESC
        LIMIT 1;
      END IF;

      IF v_source.id IS NULL OR v_source.email IS NULL OR btrim(v_source.email) = '' THEN
        v_skipped := v_skipped + 1;
        IF jsonb_array_length(v_errors) < v_max_errors THEN
          v_errors := v_errors || jsonb_build_array(
            jsonb_build_object(
              'globalLeadId', v_global_lead_id,
              'message', 'No email found for this person in the account.'
            )
          );
        END IF;
        CONTINUE;
      END IF;

      v_custom := COALESCE(v_source.custom_lead_data, '{}'::jsonb);
      v_missing := false;
      FOREACH v_key IN ARRAY v_required_keys LOOP
        IF NOT (v_custom ? v_key)
          OR v_custom ->> v_key IS NULL
          OR btrim(v_custom ->> v_key) = '' THEN
          v_missing := true;
          EXIT;
        END IF;
      END LOOP;

      IF v_missing THEN
        v_skipped := v_skipped + 1;
        IF jsonb_array_length(v_errors) < v_max_errors THEN
          v_errors := v_errors || jsonb_build_array(
            jsonb_build_object(
              'globalLeadId', v_global_lead_id,
              'message', format('Missing required custom field "%s" for the target campaign.', v_key)
            )
          );
        END IF;
        CONTINUE;
      END IF;

      SELECT l.*
      INTO v_existing
      FROM public.leads l
      WHERE l.account_id = p_account_id
        AND l.campaign_id = p_campaign_id
        AND l.global_lead_id = v_global_lead_id
        AND l.deleted_at IS NULL
      LIMIT 1;

      IF FOUND THEN
        UPDATE public.leads l
        SET
          name = CASE WHEN l.name IS NULL OR btrim(l.name) = '' THEN COALESCE(NULLIF(btrim(v_source.name), ''), NULLIF(btrim(concat_ws(' ', v_source.first_name, v_source.last_name)), '')) ELSE l.name END,
          first_name = CASE WHEN l.first_name IS NULL OR btrim(l.first_name) = '' THEN v_source.first_name ELSE l.first_name END,
          last_name = CASE WHEN l.last_name IS NULL OR btrim(l.last_name) = '' THEN v_source.last_name ELSE l.last_name END,
          company_name = CASE WHEN l.company_name IS NULL OR btrim(l.company_name) = '' THEN v_source.company_name ELSE l.company_name END,
          website = CASE WHEN l.website IS NULL OR btrim(l.website) = '' THEN v_source.website ELSE l.website END,
          linkedin_url = CASE WHEN l.linkedin_url IS NULL OR btrim(l.linkedin_url) = '' THEN v_source.linkedin_url ELSE l.linkedin_url END,
          phone_number = CASE WHEN l.phone_number IS NULL OR btrim(l.phone_number) = '' THEN v_source.phone_number ELSE l.phone_number END,
          custom_lead_data = CASE
            WHEN v_custom = '{}'::jsonb THEN l.custom_lead_data
            ELSE COALESCE(l.custom_lead_data, '{}'::jsonb) || v_custom
          END,
          updated_at = v_now
        WHERE l.id = v_existing.id;

        v_lead_id := v_existing.id;
        v_updated := v_updated + 1;
      ELSE
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
          phone_number,
          global_lead_id,
          source,
          custom_lead_data,
          created_at,
          updated_at
        )
        VALUES (
          p_campaign_id,
          v_campaign.bucket_id,
          p_account_id,
          lower(btrim(v_source.email)),
          COALESCE(NULLIF(btrim(v_source.name), ''), NULLIF(btrim(concat_ws(' ', v_source.first_name, v_source.last_name)), '')),
          v_source.first_name,
          v_source.last_name,
          v_source.company_name,
          v_source.website,
          v_source.linkedin_url,
          v_source.phone_number,
          v_global_lead_id,
          COALESCE(p_options ->> 'source', 'Leads workbench'),
          CASE WHEN v_custom = '{}'::jsonb THEN NULL ELSE v_custom END,
          v_now,
          v_now
        )
        RETURNING id INTO v_lead_id;

        v_created := v_created + 1;
      END IF;

      v_lead_ids := array_append(v_lead_ids, v_lead_id);
      v_touched_global_ids := array_append(v_touched_global_ids, v_global_lead_id);
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      IF jsonb_array_length(v_errors) < v_max_errors THEN
        v_errors := v_errors || jsonb_build_array(
          jsonb_build_object(
            'globalLeadId', v_global_lead_id,
            'message', SQLERRM
          )
        );
      END IF;
    END;
  END LOOP;

  IF COALESCE(array_length(v_lead_ids, 1), 0) > 0 THEN
    INSERT INTO public.enrollments (
      campaign_id,
      account_id,
      lead_id,
      current_node_id,
      state,
      next_run_at,
      flow_position,
      deleted_at,
      created_at,
      updated_at
    )
    SELECT
      p_campaign_id,
      p_account_id,
      lid,
      NULL,
      'active',
      v_now,
      '{}'::jsonb,
      NULL,
      v_now,
      v_now
    FROM unnest(v_lead_ids) AS lid
    ON CONFLICT (campaign_id, lead_id) DO NOTHING;

    GET DIAGNOSTICS v_enrolled = ROW_COUNT;

    UPDATE public.enrollments e
    SET next_run_at = v_now, updated_at = v_now
    WHERE e.lead_id = ANY(v_lead_ids)
      AND e.deleted_at IS NULL
      AND e.state = 'active'
      AND e.next_run_at IS NULL;
  END IF;

  PERFORM set_config('app.skip_lead_rollup_refresh', 'false', true);

  IF COALESCE(array_length(v_touched_global_ids, 1), 0) > 0 THEN
    FOREACH v_global_lead_id IN ARRAY (
      SELECT COALESCE(array_agg(DISTINCT gid), ARRAY[]::text[])
      FROM unnest(v_touched_global_ids) AS gid
    ) LOOP
      PERFORM private_refresh_account_lead_person(p_account_id, v_global_lead_id);
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'created', v_created,
    'updated', v_updated,
    'enrolled', COALESCE(array_length(v_lead_ids, 1), 0),
    'skipped', v_skipped,
    'failed', v_failed,
    'errors', v_errors
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_global_leads_to_campaign(uuid, uuid, text[], jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_global_leads_to_campaign(uuid, uuid, text[], jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- Review summary for add-to-campaign modal
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.add_to_campaign_review_summary(
  p_account_id uuid,
  p_campaign_id uuid,
  p_global_lead_ids text[]
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_unique_ids text[];
  v_selected_people integer;
  v_already_in_campaign integer;
  v_memberships_in_scope integer;
  v_native_memberships integer;
  v_smartlead_memberships integer;
  v_people_with_replies integer;
  v_people_with_conflicting_companies integer;
BEGIN
  PERFORM private_assert_account_member(p_account_id);

  SELECT COALESCE(array_agg(DISTINCT id), ARRAY[]::text[])
  INTO v_unique_ids
  FROM unnest(COALESCE(p_global_lead_ids, ARRAY[]::text[])) AS id
  WHERE id IS NOT NULL AND btrim(id) <> '';

  v_selected_people := COALESCE(array_length(v_unique_ids, 1), 0);

  IF v_selected_people = 0 THEN
    RETURN jsonb_build_object(
      'selectedPeople', 0,
      'alreadyInCampaign', 0,
      'membershipsInScope', 0,
      'nativeMemberships', 0,
      'smartleadMemberships', 0,
      'peopleWithReplies', 0,
      'peopleWithConflictingCompanies', 0
    );
  END IF;

  SELECT COUNT(*)::integer
  INTO v_already_in_campaign
  FROM public.leads l
  WHERE l.account_id = p_account_id
    AND l.campaign_id = p_campaign_id
    AND l.deleted_at IS NULL
    AND l.global_lead_id = ANY(v_unique_ids);

  SELECT COUNT(*)::integer
  INTO v_memberships_in_scope
  FROM public.leads l
  WHERE l.account_id = p_account_id
    AND l.deleted_at IS NULL
    AND l.global_lead_id = ANY(v_unique_ids);

  SELECT COUNT(*)::integer
  INTO v_native_memberships
  FROM public.leads l
  LEFT JOIN public.campaigns c ON c.id = l.campaign_id
  WHERE l.account_id = p_account_id
    AND l.deleted_at IS NULL
    AND l.global_lead_id = ANY(v_unique_ids)
    AND COALESCE(c.source, '') <> 'smartlead';

  SELECT COUNT(*)::integer
  INTO v_smartlead_memberships
  FROM public.leads l
  INNER JOIN public.campaigns c ON c.id = l.campaign_id
  WHERE l.account_id = p_account_id
    AND l.deleted_at IS NULL
    AND l.global_lead_id = ANY(v_unique_ids)
    AND c.source = 'smartlead';

  SELECT COUNT(*)::integer
  INTO v_people_with_replies
  FROM public.account_lead_people alp
  WHERE alp.account_id = p_account_id
    AND alp.global_lead_id = ANY(v_unique_ids)
    AND alp.has_reply = true;

  SELECT COUNT(*)::integer
  INTO v_people_with_conflicting_companies
  FROM (
    SELECT l.global_lead_id
    FROM public.leads l
    WHERE l.account_id = p_account_id
      AND l.deleted_at IS NULL
      AND l.global_lead_id = ANY(v_unique_ids)
      AND l.company_name IS NOT NULL
      AND btrim(l.company_name) <> ''
    GROUP BY l.global_lead_id
    HAVING COUNT(DISTINCT l.company_name) > 1
  ) conflicts;

  RETURN jsonb_build_object(
    'selectedPeople', v_selected_people,
    'alreadyInCampaign', v_already_in_campaign,
    'membershipsInScope', v_memberships_in_scope,
    'nativeMemberships', v_native_memberships,
    'smartleadMemberships', v_smartlead_memberships,
    'peopleWithReplies', v_people_with_replies,
    'peopleWithConflictingCompanies', v_people_with_conflicting_companies
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_to_campaign_review_summary(uuid, uuid, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_to_campaign_review_summary(uuid, uuid, text[]) TO service_role;

-- ---------------------------------------------------------------------------
-- Backfill helper (call from script or one-time job)
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
    SELECT DISTINCT l.account_id, l.global_lead_id
    FROM public.leads l
    LEFT JOIN public.account_lead_people alp
      ON alp.account_id = l.account_id
     AND alp.global_lead_id = l.global_lead_id
    WHERE l.deleted_at IS NULL
      AND l.global_lead_id IS NOT NULL
      AND alp.global_lead_id IS NULL
      AND (p_account_id IS NULL OR l.account_id = p_account_id)
    LIMIT GREATEST(p_limit, 1)
  LOOP
    PERFORM private_refresh_account_lead_person(v_account_id, v_global_lead_id);
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.backfill_account_lead_people_batch(uuid, integer) TO service_role;

-- ---------------------------------------------------------------------------
-- API email-based bulk import (Client API sync + async worker)
-- ---------------------------------------------------------------------------
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
        v_skipped := v_skipped + 1;
        CONTINUE;
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
          custom_lead_data = CASE WHEN v_custom = '{}'::jsonb THEN l.custom_lead_data ELSE v_custom END,
          source = 'api',
          updated_at = v_now
        WHERE l.id = v_existing.id;
        v_lead_id := v_existing.id;
        v_updated := v_updated + 1;
      ELSE
        INSERT INTO public.leads (
          campaign_id, bucket_id, account_id, email, name, first_name, last_name,
          company_name, website, linkedin_url, company_linkedin_url,
          global_lead_id, source, custom_lead_data, created_at, updated_at
        )
        VALUES (
          p_campaign_id, v_campaign.bucket_id, p_account_id, v_email,
          NULLIF(btrim(v_lead ->> 'name'), ''),
          v_lead ->> 'first_name', v_lead ->> 'last_name',
          v_lead ->> 'company_name', v_lead ->> 'website', v_lead ->> 'linkedin_url',
          v_lead ->> 'company_linkedin_url',
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
    'failed', v_failed,
    'errors', v_errors,
    'emit_row_webhooks', v_emit_row_webhooks
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.import_api_leads_to_campaign(uuid, uuid, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.import_api_leads_to_campaign(uuid, uuid, jsonb, jsonb) TO service_role;
