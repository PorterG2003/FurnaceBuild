-- Allow blank custom (personalization) fields on lead import / add-to-campaign.
--
-- Previously both import_api_leads_to_campaign and add_global_leads_to_campaign
-- SILENTLY SKIPPED any lead missing one of the campaign's required custom field
-- keys (derived from the lead source node's customFieldKeys). That produced
-- "import succeeded, 0 leads" with no signal.
--
-- New behavior (universal): rows missing custom fields are still imported/added
-- with blanks, and the count of such rows is returned as `incomplete` so callers
-- (UI + API) can surface it. Empty-email / no-source rows are still skipped.
--
-- Also fixes a destructive update in import_api_leads_to_campaign: the UPDATE
-- branch now MERGES custom_lead_data (overlay provided keys) instead of replacing
-- the whole object, matching add_global_leads_to_campaign. Re-importing a partial
-- mapping no longer wipes previously-populated personalization fields.

-- ---------------------------------------------------------------------------
-- API email-based bulk import (Client API sync + async worker + builder CSV)
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
      -- Missing required custom fields no longer skips the row; we import it with
      -- blanks and count it as `incomplete` so the caller can surface it.
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
          -- Merge custom data: overlay provided keys, preserve existing ones.
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
    'incomplete', v_incomplete,
    'failed', v_failed,
    'errors', v_errors,
    'emit_row_webhooks', v_emit_row_webhooks
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.import_api_leads_to_campaign(uuid, uuid, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.import_api_leads_to_campaign(uuid, uuid, jsonb, jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- Add existing global leads to a campaign (Leads workbench + saved lists + API)
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
  v_incomplete integer := 0;
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
      'incomplete', 0,
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

      -- Missing required custom fields no longer skips; add the lead with blanks
      -- and count it as `incomplete`. (Not an error.)
      IF v_missing THEN
        v_incomplete := v_incomplete + 1;
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
    'incomplete', v_incomplete,
    'failed', v_failed,
    'errors', v_errors
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_global_leads_to_campaign(uuid, uuid, text[], jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_global_leads_to_campaign(uuid, uuid, text[], jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
