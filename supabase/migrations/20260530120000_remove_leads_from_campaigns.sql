-- ============================================
-- Migration: remove leads from campaigns (workbench bulk)
-- Mirrors deleteLead semantics in app code: soft-delete lead, stop enrollment, cancel queued jobs.
-- ============================================

ALTER TABLE public.api_import_jobs
  ALTER COLUMN campaign_id DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- Review summaries
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.remove_from_campaign_review_summary(
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
  v_in_campaign integer;
  v_not_in_campaign integer;
  v_already_removed integer;
  v_smartlead_campaign boolean;
BEGIN
  PERFORM private_assert_account_member(p_account_id);

  SELECT COALESCE(array_agg(DISTINCT id), ARRAY[]::text[])
  INTO v_unique_ids
  FROM unnest(COALESCE(p_global_lead_ids, ARRAY[]::text[])) AS id
  WHERE id IS NOT NULL AND btrim(id) <> '';

  v_selected_people := COALESCE(array_length(v_unique_ids, 1), 0);

  SELECT EXISTS (
    SELECT 1
    FROM public.campaigns c
    WHERE c.id = p_campaign_id
      AND c.account_id = p_account_id
      AND c.deleted_at IS NULL
      AND c.source = 'smartlead'
  ) INTO v_smartlead_campaign;

  IF v_selected_people = 0 OR v_smartlead_campaign THEN
    RETURN jsonb_build_object(
      'selectedPeople', v_selected_people,
      'inCampaign', 0,
      'notInCampaign', v_selected_people,
      'alreadyRemoved', 0,
      'smartleadCampaign', v_smartlead_campaign
    );
  END IF;

  SELECT COUNT(*)::integer
  INTO v_in_campaign
  FROM public.leads l
  WHERE l.account_id = p_account_id
    AND l.campaign_id = p_campaign_id
    AND l.deleted_at IS NULL
    AND l.global_lead_id = ANY(v_unique_ids);

  SELECT COUNT(*)::integer
  INTO v_not_in_campaign
  FROM unnest(v_unique_ids) AS gid(id)
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.leads l
    WHERE l.account_id = p_account_id
      AND l.campaign_id = p_campaign_id
      AND l.global_lead_id = gid.id
  );

  SELECT COUNT(*)::integer
  INTO v_already_removed
  FROM unnest(v_unique_ids) AS gid(id)
  WHERE EXISTS (
    SELECT 1
    FROM public.leads l
    WHERE l.account_id = p_account_id
      AND l.campaign_id = p_campaign_id
      AND l.global_lead_id = gid.id
      AND l.deleted_at IS NOT NULL
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.leads l
    WHERE l.account_id = p_account_id
      AND l.campaign_id = p_campaign_id
      AND l.global_lead_id = gid.id
      AND l.deleted_at IS NULL
  );

  RETURN jsonb_build_object(
    'selectedPeople', v_selected_people,
    'inCampaign', v_in_campaign,
    'notInCampaign', v_not_in_campaign,
    'alreadyRemoved', v_already_removed,
    'smartleadCampaign', false
  );
END;
$$;

COMMENT ON FUNCTION public.remove_from_campaign_review_summary(uuid, uuid, text[]) IS
  'Review counts for removing selected global leads from one campaign.';

GRANT EXECUTE ON FUNCTION public.remove_from_campaign_review_summary(uuid, uuid, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_from_campaign_review_summary(uuid, uuid, text[]) TO service_role;

CREATE OR REPLACE FUNCTION public.remove_from_all_campaigns_review_summary(
  p_account_id uuid,
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
  v_native_memberships_to_remove integer;
  v_smartlead_memberships_skipped integer;
  v_people_with_replies integer;
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
      'nativeMembershipsToRemove', 0,
      'smartleadMembershipsSkipped', 0,
      'peopleWithReplies', 0
    );
  END IF;

  SELECT COUNT(*)::integer
  INTO v_native_memberships_to_remove
  FROM public.leads l
  INNER JOIN public.campaigns c ON c.id = l.campaign_id
  WHERE l.account_id = p_account_id
    AND l.deleted_at IS NULL
    AND l.global_lead_id = ANY(v_unique_ids)
    AND c.account_id = p_account_id
    AND c.deleted_at IS NULL
    AND COALESCE(c.source, '') <> 'smartlead';

  SELECT COUNT(*)::integer
  INTO v_smartlead_memberships_skipped
  FROM public.leads l
  INNER JOIN public.campaigns c ON c.id = l.campaign_id
  WHERE l.account_id = p_account_id
    AND l.deleted_at IS NULL
    AND l.global_lead_id = ANY(v_unique_ids)
    AND c.account_id = p_account_id
    AND c.deleted_at IS NULL
    AND c.source = 'smartlead';

  SELECT COUNT(DISTINCT l.global_lead_id)::integer
  INTO v_people_with_replies
  FROM public.leads l
  WHERE l.account_id = p_account_id
    AND l.deleted_at IS NULL
    AND l.global_lead_id = ANY(v_unique_ids)
    AND EXISTS (
      SELECT 1
      FROM public.email_threads t
      WHERE t.lead_id = l.id
        AND t.has_reply IS TRUE
    );

  RETURN jsonb_build_object(
    'selectedPeople', v_selected_people,
    'nativeMembershipsToRemove', v_native_memberships_to_remove,
    'smartleadMembershipsSkipped', v_smartlead_memberships_skipped,
    'peopleWithReplies', v_people_with_replies
  );
END;
$$;

COMMENT ON FUNCTION public.remove_from_all_campaigns_review_summary(uuid, text[]) IS
  'Review counts for removing selected global leads from all native campaigns.';

GRANT EXECUTE ON FUNCTION public.remove_from_all_campaigns_review_summary(uuid, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_from_all_campaigns_review_summary(uuid, text[]) TO service_role;

-- ---------------------------------------------------------------------------
-- Mutations
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.remove_global_leads_from_campaign(
  p_account_id uuid,
  p_campaign_id uuid,
  p_global_lead_ids text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_unique_ids text[];
  v_removed integer := 0;
  v_skipped integer := 0;
  v_errors jsonb := '[]'::jsonb;
BEGIN
  PERFORM private_assert_account_member(p_account_id);

  IF NOT EXISTS (
    SELECT 1
    FROM public.campaigns c
    WHERE c.id = p_campaign_id
      AND c.account_id = p_account_id
      AND c.deleted_at IS NULL
      AND COALESCE(c.source, '') <> 'smartlead'
  ) THEN
    RAISE EXCEPTION 'Campaign not found or not mutable for this account.' USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT id), ARRAY[]::text[])
  INTO v_unique_ids
  FROM unnest(COALESCE(p_global_lead_ids, ARRAY[]::text[])) AS id
  WHERE id IS NOT NULL AND btrim(id) <> '';

  IF COALESCE(array_length(v_unique_ids, 1), 0) = 0 THEN
    RETURN jsonb_build_object('removed', 0, 'skipped', 0, 'errors', '[]'::jsonb);
  END IF;

  WITH scoped AS (
    SELECT l.id AS lead_id
    FROM public.leads l
    WHERE l.account_id = p_account_id
      AND l.campaign_id = p_campaign_id
      AND l.deleted_at IS NULL
      AND l.global_lead_id = ANY(v_unique_ids)
  ),
  cancelled_jobs AS (
    UPDATE public.message_jobs mj
    SET
      status = 'cancelled',
      status_reason = 'lead_deleted',
      error_message = 'Lead deleted',
      updated_at = NOW()
    FROM scoped s
    WHERE mj.lead_id = s.lead_id
      AND mj.campaign_id = p_campaign_id
      AND (mj.message_type = 'campaign' OR mj.message_type IS NULL)
      AND mj.status IN ('queued', 'reserved')
  ),
  stopped_enrollments AS (
    UPDATE public.enrollments e
    SET
      deleted_at = NOW(),
      state = 'stopped',
      next_run_at = NULL,
      updated_at = NOW()
    FROM scoped s
    WHERE e.lead_id = s.lead_id
      AND e.campaign_id = p_campaign_id
      AND e.deleted_at IS NULL
  ),
  removed_leads AS (
    UPDATE public.leads l
    SET
      deleted_at = NOW(),
      updated_at = NOW()
    FROM scoped s
    WHERE l.id = s.lead_id
    RETURNING l.global_lead_id
  )
  SELECT COUNT(*)::integer INTO v_removed FROM removed_leads;

  SELECT COUNT(*)::integer
  INTO v_skipped
  FROM unnest(v_unique_ids) AS gid(id)
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.leads l
    WHERE l.account_id = p_account_id
      AND l.campaign_id = p_campaign_id
      AND l.global_lead_id = gid.id
      AND l.deleted_at IS NULL
  );

  RETURN jsonb_build_object(
    'removed', v_removed,
    'skipped', v_skipped,
    'errors', v_errors
  );
END;
$$;

COMMENT ON FUNCTION public.remove_global_leads_from_campaign(uuid, uuid, text[]) IS
  'Soft-delete campaign leads for selected global_lead_ids in one native campaign.';

GRANT EXECUTE ON FUNCTION public.remove_global_leads_from_campaign(uuid, uuid, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_global_leads_from_campaign(uuid, uuid, text[]) TO service_role;

CREATE OR REPLACE FUNCTION public.remove_global_leads_from_all_campaigns(
  p_account_id uuid,
  p_global_lead_ids text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_unique_ids text[];
  v_removed integer := 0;
  v_skipped integer := 0;
  v_errors jsonb := '[]'::jsonb;
BEGIN
  PERFORM private_assert_account_member(p_account_id);

  SELECT COALESCE(array_agg(DISTINCT id), ARRAY[]::text[])
  INTO v_unique_ids
  FROM unnest(COALESCE(p_global_lead_ids, ARRAY[]::text[])) AS id
  WHERE id IS NOT NULL AND btrim(id) <> '';

  IF COALESCE(array_length(v_unique_ids, 1), 0) = 0 THEN
    RETURN jsonb_build_object('removed', 0, 'skipped', 0, 'errors', '[]'::jsonb);
  END IF;

  WITH scoped AS (
    SELECT l.id AS lead_id, l.campaign_id
    FROM public.leads l
    INNER JOIN public.campaigns c ON c.id = l.campaign_id
    WHERE l.account_id = p_account_id
      AND l.deleted_at IS NULL
      AND l.global_lead_id = ANY(v_unique_ids)
      AND c.account_id = p_account_id
      AND c.deleted_at IS NULL
      AND COALESCE(c.source, '') <> 'smartlead'
  ),
  cancelled_jobs AS (
    UPDATE public.message_jobs mj
    SET
      status = 'cancelled',
      status_reason = 'lead_deleted',
      error_message = 'Lead deleted',
      updated_at = NOW()
    FROM scoped s
    WHERE mj.lead_id = s.lead_id
      AND mj.campaign_id = s.campaign_id
      AND (mj.message_type = 'campaign' OR mj.message_type IS NULL)
      AND mj.status IN ('queued', 'reserved')
  ),
  stopped_enrollments AS (
    UPDATE public.enrollments e
    SET
      deleted_at = NOW(),
      state = 'stopped',
      next_run_at = NULL,
      updated_at = NOW()
    FROM scoped s
    WHERE e.lead_id = s.lead_id
      AND e.campaign_id = s.campaign_id
      AND e.deleted_at IS NULL
  ),
  removed_leads AS (
    UPDATE public.leads l
    SET
      deleted_at = NOW(),
      updated_at = NOW()
    FROM scoped s
    WHERE l.id = s.lead_id
    RETURNING l.id
  )
  SELECT COUNT(*)::integer INTO v_removed FROM removed_leads;

  SELECT COUNT(*)::integer
  INTO v_skipped
  FROM unnest(v_unique_ids) AS gid(id)
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.leads l
    INNER JOIN public.campaigns c ON c.id = l.campaign_id
    WHERE l.account_id = p_account_id
      AND l.global_lead_id = gid.id
      AND l.deleted_at IS NULL
      AND c.account_id = p_account_id
      AND c.deleted_at IS NULL
      AND COALESCE(c.source, '') <> 'smartlead'
  );

  RETURN jsonb_build_object(
    'removed', v_removed,
    'skipped', v_skipped,
    'errors', v_errors
  );
END;
$$;

COMMENT ON FUNCTION public.remove_global_leads_from_all_campaigns(uuid, text[]) IS
  'Soft-delete all native campaign lead rows for selected global_lead_ids.';

GRANT EXECUTE ON FUNCTION public.remove_global_leads_from_all_campaigns(uuid, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_global_leads_from_all_campaigns(uuid, text[]) TO service_role;

-- ---------------------------------------------------------------------------
-- Async bulk jobs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.start_remove_from_campaign_job(
  p_account_id uuid,
  p_campaign_id uuid,
  p_global_lead_ids text[]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job_id uuid;
  v_unique_ids text[];
BEGIN
  PERFORM private_assert_account_member(p_account_id);

  IF NOT EXISTS (
    SELECT 1
    FROM public.campaigns c
    WHERE c.id = p_campaign_id
      AND c.account_id = p_account_id
      AND c.deleted_at IS NULL
      AND COALESCE(c.source, '') <> 'smartlead'
  ) THEN
    RAISE EXCEPTION 'Campaign not found or not mutable for this account.' USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT id ORDER BY id), ARRAY[]::text[])
  INTO v_unique_ids
  FROM unnest(COALESCE(p_global_lead_ids, ARRAY[]::text[])) AS id
  WHERE id IS NOT NULL AND btrim(id) <> '';

  IF COALESCE(array_length(v_unique_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'At least one global_lead_id is required.' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.api_import_jobs (
    account_id, campaign_id, status, progress, cursor, input, result, errors
  )
  VALUES (
    p_account_id,
    p_campaign_id,
    'queued',
    0,
    0,
    jsonb_build_object(
      'operation', 'remove_from_campaign',
      'global_lead_ids', to_jsonb(v_unique_ids)
    ),
    '{}'::jsonb,
    '[]'::jsonb
  )
  RETURNING id INTO v_job_id;

  RETURN v_job_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_remove_from_campaign_job(uuid, uuid, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_remove_from_campaign_job(uuid, uuid, text[]) TO service_role;

CREATE OR REPLACE FUNCTION public.start_remove_from_all_campaigns_job(
  p_account_id uuid,
  p_global_lead_ids text[]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job_id uuid;
  v_unique_ids text[];
BEGIN
  PERFORM private_assert_account_member(p_account_id);

  SELECT COALESCE(array_agg(DISTINCT id ORDER BY id), ARRAY[]::text[])
  INTO v_unique_ids
  FROM unnest(COALESCE(p_global_lead_ids, ARRAY[]::text[])) AS id
  WHERE id IS NOT NULL AND btrim(id) <> '';

  IF COALESCE(array_length(v_unique_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'At least one global_lead_id is required.' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.api_import_jobs (
    account_id, campaign_id, status, progress, cursor, input, result, errors
  )
  VALUES (
    p_account_id,
    NULL,
    'queued',
    0,
    0,
    jsonb_build_object(
      'operation', 'remove_from_all_campaigns',
      'global_lead_ids', to_jsonb(v_unique_ids)
    ),
    '{}'::jsonb,
    '[]'::jsonb
  )
  RETURNING id INTO v_job_id;

  RETURN v_job_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_remove_from_all_campaigns_job(uuid, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_remove_from_all_campaigns_job(uuid, text[]) TO service_role;

CREATE OR REPLACE FUNCTION public.start_remove_from_campaign_job_for_list(
  p_account_id uuid,
  p_campaign_id uuid,
  p_list_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job_id uuid;
  v_member_count bigint;
BEGIN
  PERFORM private_assert_account_member(p_account_id);

  IF NOT EXISTS (
    SELECT 1 FROM public.campaigns c
    WHERE c.id = p_campaign_id AND c.account_id = p_account_id
      AND c.deleted_at IS NULL AND COALESCE(c.source, '') <> 'smartlead'
  ) THEN
    RAISE EXCEPTION 'Campaign not found or not mutable for this account.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.lead_saved_lists l
    WHERE l.id = p_list_id AND l.account_id = p_account_id
  ) THEN
    RAISE EXCEPTION 'Saved list not found for this account.' USING ERRCODE = 'P0002';
  END IF;

  SELECT COUNT(*)::bigint INTO v_member_count
  FROM public.lead_saved_list_members m
  WHERE m.list_id = p_list_id AND m.account_id = p_account_id;

  IF COALESCE(v_member_count, 0) = 0 THEN
    RAISE EXCEPTION 'Saved list has no members.' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.api_import_jobs (
    account_id, campaign_id, status, progress, cursor, input, result, errors
  )
  VALUES (
    p_account_id, p_campaign_id, 'queued', 0, 0,
    jsonb_build_object(
      'operation', 'remove_from_campaign',
      'saved_list_id', p_list_id,
      'total_count', v_member_count
    ),
    '{}'::jsonb, '[]'::jsonb
  )
  RETURNING id INTO v_job_id;

  RETURN v_job_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_remove_from_campaign_job_for_list(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_remove_from_campaign_job_for_list(uuid, uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.start_remove_from_all_campaigns_job_for_list(
  p_account_id uuid,
  p_list_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job_id uuid;
  v_member_count bigint;
BEGIN
  PERFORM private_assert_account_member(p_account_id);

  IF NOT EXISTS (
    SELECT 1 FROM public.lead_saved_lists l
    WHERE l.id = p_list_id AND l.account_id = p_account_id
  ) THEN
    RAISE EXCEPTION 'Saved list not found for this account.' USING ERRCODE = 'P0002';
  END IF;

  SELECT COUNT(*)::bigint INTO v_member_count
  FROM public.lead_saved_list_members m
  WHERE m.list_id = p_list_id AND m.account_id = p_account_id;

  IF COALESCE(v_member_count, 0) = 0 THEN
    RAISE EXCEPTION 'Saved list has no members.' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.api_import_jobs (
    account_id, campaign_id, status, progress, cursor, input, result, errors
  )
  VALUES (
    p_account_id, NULL, 'queued', 0, 0,
    jsonb_build_object(
      'operation', 'remove_from_all_campaigns',
      'saved_list_id', p_list_id,
      'total_count', v_member_count
    ),
    '{}'::jsonb, '[]'::jsonb
  )
  RETURNING id INTO v_job_id;

  RETURN v_job_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_remove_from_all_campaigns_job_for_list(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_remove_from_all_campaigns_job_for_list(uuid, uuid) TO service_role;
