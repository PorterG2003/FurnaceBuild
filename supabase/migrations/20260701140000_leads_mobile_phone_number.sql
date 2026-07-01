-- Add first-class mobile phone support alongside existing phone_number.

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS mobile_phone_number text;

COMMENT ON COLUMN public.leads.mobile_phone_number IS
  'Personal/mobile phone for the lead (for example Apollo async mobile reveal).';

CREATE OR REPLACE FUNCTION public.update_account_person_profile(
  p_account_id uuid,
  p_global_lead_id text,
  p_updates jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated integer;
  v_lead_id uuid;
BEGIN
  PERFORM private_assert_account_member(p_account_id);

  IF p_global_lead_id IS NULL OR btrim(p_global_lead_id) = '' THEN
    RAISE EXCEPTION 'p_global_lead_id is required';
  END IF;

  IF p_updates IS NULL OR p_updates = '{}'::jsonb THEN
    RETURN;
  END IF;

  UPDATE public.leads l
  SET
    name = CASE WHEN p_updates ? 'name' THEN NULLIF(btrim(p_updates->>'name'), '') ELSE l.name END,
    first_name = CASE WHEN p_updates ? 'first_name' THEN NULLIF(btrim(p_updates->>'first_name'), '') ELSE l.first_name END,
    last_name = CASE WHEN p_updates ? 'last_name' THEN NULLIF(btrim(p_updates->>'last_name'), '') ELSE l.last_name END,
    company_name = CASE WHEN p_updates ? 'company_name' THEN NULLIF(btrim(p_updates->>'company_name'), '') ELSE l.company_name END,
    website = CASE WHEN p_updates ? 'website' THEN NULLIF(btrim(p_updates->>'website'), '') ELSE l.website END,
    linkedin_url = CASE WHEN p_updates ? 'linkedin_url' THEN NULLIF(btrim(p_updates->>'linkedin_url'), '') ELSE l.linkedin_url END,
    company_linkedin_url = CASE WHEN p_updates ? 'company_linkedin_url' THEN NULLIF(btrim(p_updates->>'company_linkedin_url'), '') ELSE l.company_linkedin_url END,
    phone_number = CASE WHEN p_updates ? 'phone_number' THEN NULLIF(btrim(p_updates->>'phone_number'), '') ELSE l.phone_number END,
    mobile_phone_number = CASE
      WHEN p_updates ? 'mobile_phone_number' THEN NULLIF(btrim(p_updates->>'mobile_phone_number'), '')
      ELSE l.mobile_phone_number
    END,
    custom_lead_data = CASE
      WHEN p_updates ? 'custom_lead_data' THEN p_updates->'custom_lead_data'
      ELSE l.custom_lead_data
    END,
    updated_at = now()
  WHERE l.account_id = p_account_id
    AND l.global_lead_id = p_global_lead_id
    AND l.deleted_at IS NULL;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    SELECT l.id
    INTO v_lead_id
    FROM public.leads l
    WHERE l.account_id = p_account_id
      AND l.global_lead_id = p_global_lead_id
    ORDER BY l.created_at DESC
    LIMIT 1;

    IF v_lead_id IS NOT NULL THEN
      UPDATE public.leads l
      SET
        name = CASE WHEN p_updates ? 'name' THEN NULLIF(btrim(p_updates->>'name'), '') ELSE l.name END,
        first_name = CASE WHEN p_updates ? 'first_name' THEN NULLIF(btrim(p_updates->>'first_name'), '') ELSE l.first_name END,
        last_name = CASE WHEN p_updates ? 'last_name' THEN NULLIF(btrim(p_updates->>'last_name'), '') ELSE l.last_name END,
        company_name = CASE WHEN p_updates ? 'company_name' THEN NULLIF(btrim(p_updates->>'company_name'), '') ELSE l.company_name END,
        website = CASE WHEN p_updates ? 'website' THEN NULLIF(btrim(p_updates->>'website'), '') ELSE l.website END,
        linkedin_url = CASE WHEN p_updates ? 'linkedin_url' THEN NULLIF(btrim(p_updates->>'linkedin_url'), '') ELSE l.linkedin_url END,
        company_linkedin_url = CASE WHEN p_updates ? 'company_linkedin_url' THEN NULLIF(btrim(p_updates->>'company_linkedin_url'), '') ELSE l.company_linkedin_url END,
        phone_number = CASE WHEN p_updates ? 'phone_number' THEN NULLIF(btrim(p_updates->>'phone_number'), '') ELSE l.phone_number END,
        mobile_phone_number = CASE
          WHEN p_updates ? 'mobile_phone_number' THEN NULLIF(btrim(p_updates->>'mobile_phone_number'), '')
          ELSE l.mobile_phone_number
        END,
        custom_lead_data = CASE
          WHEN p_updates ? 'custom_lead_data' THEN p_updates->'custom_lead_data'
          ELSE l.custom_lead_data
        END,
        updated_at = now()
      WHERE l.id = v_lead_id;
    END IF;
  END IF;

  PERFORM private_refresh_account_lead_person(p_account_id, p_global_lead_id);
END;
$$;

COMMENT ON FUNCTION public.update_account_person_profile(uuid, text, jsonb) IS
  'Apply profile-field updates to all active lead rows for a person (or the newest row when none are active), then refresh account_lead_people.';

REVOKE ALL ON FUNCTION public.update_account_person_profile(uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_account_person_profile(uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_account_person_profile(uuid, text, jsonb) TO service_role;

DROP TRIGGER IF EXISTS refresh_account_lead_person_on_leads ON public.leads;
CREATE TRIGGER refresh_account_lead_person_on_leads
  AFTER INSERT OR UPDATE OF
    email,
    name,
    first_name,
    last_name,
    company_name,
    website,
    linkedin_url,
    company_linkedin_url,
    phone_number,
    mobile_phone_number,
    custom_lead_data,
    deleted_at,
    global_lead_id,
    account_id
  OR DELETE ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION private_trigger_refresh_account_lead_person();

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
          mobile_phone_number = CASE WHEN l.mobile_phone_number IS NULL OR btrim(l.mobile_phone_number) = '' THEN v_source.mobile_phone_number ELSE l.mobile_phone_number END,
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
          mobile_phone_number,
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
          v_source.mobile_phone_number,
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

DROP FUNCTION IF EXISTS public.replace_lead_with_new_contact(
  uuid,
  text,
  text,
  text,
  text,
  text,
  public.replacement_reason_enum,
  text,
  uuid
);

CREATE OR REPLACE FUNCTION public.replace_lead_with_new_contact(
  p_old_lead_id uuid,
  p_new_email text,
  p_new_name text DEFAULT NULL,
  p_new_first_name text DEFAULT NULL,
  p_new_last_name text DEFAULT NULL,
  p_new_phone_number text DEFAULT NULL,
  p_new_mobile_phone_number text DEFAULT NULL,
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
  v_new_mobile_phone text := NULLIF(trim(p_new_mobile_phone_number), '');
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
    mobile_phone_number,
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
    COALESCE(v_new_mobile_phone, v_old_lead.mobile_phone_number),
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

COMMENT ON FUNCTION public.replace_lead_with_new_contact(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  public.replacement_reason_enum,
  text,
  uuid
) IS
  'Creates a replacement lead, moves the active enrollment to that lead, reassigns pending jobs and thread ownership, and archives the original lead.';

GRANT EXECUTE ON FUNCTION public.replace_lead_with_new_contact(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  public.replacement_reason_enum,
  text,
  uuid
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.replace_lead_with_new_contact(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  public.replacement_reason_enum,
  text,
  uuid
) TO service_role;

CREATE OR REPLACE FUNCTION public.bucket_lead_field_coverage(
  p_campaign_id uuid,
  p_bucket_id uuid
)
RETURNS TABLE (
  field_key text,
  filled_count bigint,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_total bigint;
BEGIN
  IF p_campaign_id IS NULL OR p_bucket_id IS NULL THEN
    RAISE EXCEPTION 'p_campaign_id and p_bucket_id required';
  END IF;

  SELECT COUNT(*)::bigint
  INTO v_total
  FROM public.leads l
  WHERE l.campaign_id = p_campaign_id
    AND l.bucket_id = p_bucket_id
    AND l.deleted_at IS NULL;

  RETURN QUERY
  SELECT
    'email'::text,
    COUNT(*) FILTER (WHERE btrim(coalesce(l.email, '')) <> '')::bigint,
    v_total
  FROM public.leads l
  WHERE l.campaign_id = p_campaign_id
    AND l.bucket_id = p_bucket_id
    AND l.deleted_at IS NULL
  UNION ALL
  SELECT
    'name',
    COUNT(*) FILTER (WHERE btrim(coalesce(l.name, '')) <> '')::bigint,
    v_total
  FROM public.leads l
  WHERE l.campaign_id = p_campaign_id
    AND l.bucket_id = p_bucket_id
    AND l.deleted_at IS NULL
  UNION ALL
  SELECT
    'first_name',
    COUNT(*) FILTER (WHERE btrim(coalesce(l.first_name, '')) <> '')::bigint,
    v_total
  FROM public.leads l
  WHERE l.campaign_id = p_campaign_id
    AND l.bucket_id = p_bucket_id
    AND l.deleted_at IS NULL
  UNION ALL
  SELECT
    'last_name',
    COUNT(*) FILTER (WHERE btrim(coalesce(l.last_name, '')) <> '')::bigint,
    v_total
  FROM public.leads l
  WHERE l.campaign_id = p_campaign_id
    AND l.bucket_id = p_bucket_id
    AND l.deleted_at IS NULL
  UNION ALL
  SELECT
    'company_name',
    COUNT(*) FILTER (WHERE btrim(coalesce(l.company_name, '')) <> '')::bigint,
    v_total
  FROM public.leads l
  WHERE l.campaign_id = p_campaign_id
    AND l.bucket_id = p_bucket_id
    AND l.deleted_at IS NULL
  UNION ALL
  SELECT
    'website',
    COUNT(*) FILTER (WHERE btrim(coalesce(l.website, '')) <> '')::bigint,
    v_total
  FROM public.leads l
  WHERE l.campaign_id = p_campaign_id
    AND l.bucket_id = p_bucket_id
    AND l.deleted_at IS NULL
  UNION ALL
  SELECT
    'linkedin_url',
    COUNT(*) FILTER (WHERE btrim(coalesce(l.linkedin_url, '')) <> '')::bigint,
    v_total
  FROM public.leads l
  WHERE l.campaign_id = p_campaign_id
    AND l.bucket_id = p_bucket_id
    AND l.deleted_at IS NULL
  UNION ALL
  SELECT
    'company_linkedin_url',
    COUNT(*) FILTER (WHERE btrim(coalesce(l.company_linkedin_url, '')) <> '')::bigint,
    v_total
  FROM public.leads l
  WHERE l.campaign_id = p_campaign_id
    AND l.bucket_id = p_bucket_id
    AND l.deleted_at IS NULL
  UNION ALL
  SELECT
    'phone_number',
    COUNT(*) FILTER (WHERE btrim(coalesce(l.phone_number, '')) <> '')::bigint,
    v_total
  FROM public.leads l
  WHERE l.campaign_id = p_campaign_id
    AND l.bucket_id = p_bucket_id
    AND l.deleted_at IS NULL
  UNION ALL
  SELECT
    'mobile_phone_number',
    COUNT(*) FILTER (WHERE btrim(coalesce(l.mobile_phone_number, '')) <> '')::bigint,
    v_total
  FROM public.leads l
  WHERE l.campaign_id = p_campaign_id
    AND l.bucket_id = p_bucket_id
    AND l.deleted_at IS NULL
  UNION ALL
  SELECT
    'source',
    COUNT(*) FILTER (WHERE btrim(coalesce(l.source, '')) <> '')::bigint,
    v_total
  FROM public.leads l
  WHERE l.campaign_id = p_campaign_id
    AND l.bucket_id = p_bucket_id
    AND l.deleted_at IS NULL
  UNION ALL
  SELECT
    j.key::text,
    COUNT(*) FILTER (WHERE btrim(coalesce(j.value, '')) <> '')::bigint,
    v_total
  FROM public.leads l
  CROSS JOIN LATERAL jsonb_each_text(coalesce(l.custom_lead_data, '{}'::jsonb)) AS j(key, value)
  WHERE l.campaign_id = p_campaign_id
    AND l.bucket_id = p_bucket_id
    AND l.deleted_at IS NULL
  GROUP BY j.key;
END;
$$;

COMMENT ON FUNCTION public.bucket_lead_field_coverage(uuid, uuid) IS
  'Per-field fill counts for live leads in a campaign bucket (builder Lead Source insights).';

GRANT EXECUTE ON FUNCTION public.bucket_lead_field_coverage(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bucket_lead_field_coverage(uuid, uuid) TO service_role;

DROP FUNCTION IF EXISTS public.campaign_leads_table_page(uuid, uuid[], text, text, boolean, int, int);

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
  mobile_phone_number text,
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
    'linkedin_url', 'company_linkedin_url', 'phone_number', 'mobile_phone_number', 'source', 'created_at'
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
       l.mobile_phone_number,
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
         OR l.mobile_phone_number ILIKE $3
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

NOTIFY pgrst, 'reload schema';
