-- ============================================
-- Migration: enrollment-level pause/resume for leads workbench
-- Semantics: docs/implementation/scheduler/ENROLLMENT_PAUSE_RESUME_SEMANTICS.md
-- ============================================

CREATE OR REPLACE FUNCTION public.message_job_status_reason_is_valid(
  p_status TEXT,
  p_status_reason TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  CASE p_status
    WHEN 'queued' THEN
      RETURN p_status_reason IS NULL;
    WHEN 'reserved' THEN
      RETURN p_status_reason IS NULL;
    WHEN 'sending' THEN
      RETURN p_status_reason IS NULL;
    WHEN 'sent' THEN
      RETURN p_status_reason = 'sent_successfully';
    WHEN 'deferred' THEN
      RETURN p_status_reason IN (
        'daily_throttle_limit',
        'hourly_throttle_limit',
        'min_gap_not_met',
        'campaign_paused',
        'enrollment_paused',
        'transient_read_error'
      );
    WHEN 'failed' THEN
      RETURN p_status_reason IN (
        'provider_error',
        'template_render_error'
      );
    WHEN 'cancelled' THEN
      RETURN p_status_reason IN (
        'campaign_deleted',
        'mailbox_deleted',
        'lead_deleted',
        'enrollment_deleted',
        'node_deleted',
        'enrollment_not_active',
        'manually_cancelled'
      );
    WHEN 'blocked' THEN
      RETURN p_status_reason IN (
        'lead_blocked',
        'mailbox_blocked'
      );
    ELSE
      RETURN FALSE;
  END CASE;
END;
$$;

-- ---------------------------------------------------------------------------
-- Review summaries
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pause_enrollments_review_summary(
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
  v_active_in_campaign integer;
  v_already_paused_in_campaign integer;
  v_not_in_campaign integer;
  v_terminal_in_campaign integer;
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
      'activeInCampaign', 0,
      'alreadyPausedInCampaign', 0,
      'notInCampaign', v_selected_people,
      'terminalInCampaign', 0,
      'smartleadCampaign', v_smartlead_campaign
    );
  END IF;

  SELECT COUNT(*)::integer
  INTO v_active_in_campaign
  FROM public.leads l
  INNER JOIN public.enrollments e ON e.lead_id = l.id AND e.campaign_id = l.campaign_id
  WHERE l.account_id = p_account_id
    AND l.campaign_id = p_campaign_id
    AND l.deleted_at IS NULL
    AND e.deleted_at IS NULL
    AND l.global_lead_id = ANY(v_unique_ids)
    AND e.state = 'active';

  SELECT COUNT(*)::integer
  INTO v_already_paused_in_campaign
  FROM public.leads l
  INNER JOIN public.enrollments e ON e.lead_id = l.id AND e.campaign_id = l.campaign_id
  WHERE l.account_id = p_account_id
    AND l.campaign_id = p_campaign_id
    AND l.deleted_at IS NULL
    AND e.deleted_at IS NULL
    AND l.global_lead_id = ANY(v_unique_ids)
    AND e.state = 'paused';

  SELECT COUNT(*)::integer
  INTO v_terminal_in_campaign
  FROM public.leads l
  INNER JOIN public.enrollments e ON e.lead_id = l.id AND e.campaign_id = l.campaign_id
  WHERE l.account_id = p_account_id
    AND l.campaign_id = p_campaign_id
    AND l.deleted_at IS NULL
    AND e.deleted_at IS NULL
    AND l.global_lead_id = ANY(v_unique_ids)
    AND e.state IN ('stopped', 'completed');

  SELECT COUNT(*)::integer
  INTO v_not_in_campaign
  FROM unnest(v_unique_ids) AS gid(id)
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.leads l
    WHERE l.account_id = p_account_id
      AND l.campaign_id = p_campaign_id
      AND l.deleted_at IS NULL
      AND l.global_lead_id = gid.id
  );

  RETURN jsonb_build_object(
    'selectedPeople', v_selected_people,
    'activeInCampaign', v_active_in_campaign,
    'alreadyPausedInCampaign', v_already_paused_in_campaign,
    'notInCampaign', v_not_in_campaign,
    'terminalInCampaign', v_terminal_in_campaign,
    'smartleadCampaign', false
  );
END;
$$;

COMMENT ON FUNCTION public.pause_enrollments_review_summary(uuid, uuid, text[]) IS
  'Review counts for per-lead enrollment pause. See docs/implementation/scheduler/ENROLLMENT_PAUSE_RESUME_SEMANTICS.md';

GRANT EXECUTE ON FUNCTION public.pause_enrollments_review_summary(uuid, uuid, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pause_enrollments_review_summary(uuid, uuid, text[]) TO service_role;

CREATE OR REPLACE FUNCTION public.resume_enrollments_review_summary(
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
  v_paused_in_campaign integer;
  v_already_active_in_campaign integer;
  v_not_in_campaign integer;
  v_campaign_not_running boolean;
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

  SELECT NOT EXISTS (
    SELECT 1
    FROM public.campaigns c
    WHERE c.id = p_campaign_id
      AND c.account_id = p_account_id
      AND c.deleted_at IS NULL
      AND c.status = 'running'
      AND COALESCE(c.source, '') <> 'smartlead'
  ) INTO v_campaign_not_running;

  IF v_selected_people = 0 OR v_smartlead_campaign THEN
    RETURN jsonb_build_object(
      'selectedPeople', v_selected_people,
      'pausedInCampaign', 0,
      'alreadyActiveInCampaign', 0,
      'notInCampaign', v_selected_people,
      'campaignNotRunning', v_campaign_not_running,
      'smartleadCampaign', v_smartlead_campaign
    );
  END IF;

  SELECT COUNT(*)::integer
  INTO v_paused_in_campaign
  FROM public.leads l
  INNER JOIN public.enrollments e ON e.lead_id = l.id AND e.campaign_id = l.campaign_id
  WHERE l.account_id = p_account_id
    AND l.campaign_id = p_campaign_id
    AND l.deleted_at IS NULL
    AND e.deleted_at IS NULL
    AND l.global_lead_id = ANY(v_unique_ids)
    AND e.state = 'paused';

  SELECT COUNT(*)::integer
  INTO v_already_active_in_campaign
  FROM public.leads l
  INNER JOIN public.enrollments e ON e.lead_id = l.id AND e.campaign_id = l.campaign_id
  WHERE l.account_id = p_account_id
    AND l.campaign_id = p_campaign_id
    AND l.deleted_at IS NULL
    AND e.deleted_at IS NULL
    AND l.global_lead_id = ANY(v_unique_ids)
    AND e.state = 'active';

  SELECT COUNT(*)::integer
  INTO v_not_in_campaign
  FROM unnest(v_unique_ids) AS gid(id)
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.leads l
    WHERE l.account_id = p_account_id
      AND l.campaign_id = p_campaign_id
      AND l.deleted_at IS NULL
      AND l.global_lead_id = gid.id
  );

  RETURN jsonb_build_object(
    'selectedPeople', v_selected_people,
    'pausedInCampaign', v_paused_in_campaign,
    'alreadyActiveInCampaign', v_already_active_in_campaign,
    'notInCampaign', v_not_in_campaign,
    'campaignNotRunning', v_campaign_not_running,
    'smartleadCampaign', false
  );
END;
$$;

COMMENT ON FUNCTION public.resume_enrollments_review_summary(uuid, uuid, text[]) IS
  'Review counts for per-lead enrollment resume. See docs/implementation/scheduler/ENROLLMENT_PAUSE_RESUME_SEMANTICS.md';

GRANT EXECUTE ON FUNCTION public.resume_enrollments_review_summary(uuid, uuid, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resume_enrollments_review_summary(uuid, uuid, text[]) TO service_role;

-- ---------------------------------------------------------------------------
-- Mutations
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pause_enrollments_for_leads(
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
  v_paused integer := 0;
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
    RETURN jsonb_build_object('paused', 0, 'skipped', 0, 'errors', '[]'::jsonb);
  END IF;

  -- Defer queued/reserved jobs while enrollments are still active
  UPDATE public.message_jobs mj
  SET
    status = 'deferred',
    status_reason = 'enrollment_paused',
    reserved_at = NULL,
    send_wait_reason = NULL,
    error_message = NULL,
    updated_at = NOW()
  FROM public.enrollments e
  INNER JOIN public.leads l ON l.id = e.lead_id AND l.campaign_id = e.campaign_id
  WHERE mj.enrollment_id = e.id
    AND mj.campaign_id = p_campaign_id
    AND l.account_id = p_account_id
    AND l.deleted_at IS NULL
    AND e.deleted_at IS NULL
    AND e.state = 'active'
    AND l.global_lead_id = ANY(v_unique_ids)
    AND (mj.message_type = 'campaign' OR mj.message_type IS NULL)
    AND mj.status IN ('queued', 'reserved');

  -- Pause active enrollments in scope
  WITH scoped AS (
    SELECT e.id AS enrollment_id, l.global_lead_id
    FROM public.leads l
    INNER JOIN public.enrollments e ON e.lead_id = l.id AND e.campaign_id = l.campaign_id
    WHERE l.account_id = p_account_id
      AND l.campaign_id = p_campaign_id
      AND l.deleted_at IS NULL
      AND e.deleted_at IS NULL
      AND l.global_lead_id = ANY(v_unique_ids)
      AND e.state = 'active'
  ),
  paused_rows AS (
    UPDATE public.enrollments e
    SET
      state = 'paused',
      next_run_at = NULL,
      updated_at = NOW()
    FROM scoped s
    WHERE e.id = s.enrollment_id
    RETURNING s.global_lead_id
  )
  SELECT COUNT(*)::integer INTO v_paused FROM paused_rows;

  SELECT COUNT(*)::integer
  INTO v_skipped
  FROM unnest(v_unique_ids) AS gid(id)
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.leads l
    INNER JOIN public.enrollments e ON e.lead_id = l.id AND e.campaign_id = l.campaign_id
    WHERE l.account_id = p_account_id
      AND l.campaign_id = p_campaign_id
      AND l.deleted_at IS NULL
      AND e.deleted_at IS NULL
      AND l.global_lead_id = gid.id
      AND e.state = 'active'
  );

  RETURN jsonb_build_object(
    'paused', v_paused,
    'skipped', v_skipped,
    'errors', v_errors
  );
END;
$$;

COMMENT ON FUNCTION public.pause_enrollments_for_leads(uuid, uuid, text[]) IS
  'Manually pause enrollments for selected global leads in a native campaign. See ENROLLMENT_PAUSE_RESUME_SEMANTICS.md';

GRANT EXECUTE ON FUNCTION public.pause_enrollments_for_leads(uuid, uuid, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pause_enrollments_for_leads(uuid, uuid, text[]) TO service_role;

CREATE OR REPLACE FUNCTION public.resume_enrollments_for_leads(
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
  v_resumed integer := 0;
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
      AND c.status = 'running'
      AND COALESCE(c.source, '') <> 'smartlead'
  ) THEN
    RAISE EXCEPTION 'Campaign must be running to resume enrollments.' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT id), ARRAY[]::text[])
  INTO v_unique_ids
  FROM unnest(COALESCE(p_global_lead_ids, ARRAY[]::text[])) AS id
  WHERE id IS NOT NULL AND btrim(id) <> '';

  IF COALESCE(array_length(v_unique_ids, 1), 0) = 0 THEN
    RETURN jsonb_build_object('resumed', 0, 'skipped', 0, 'errors', '[]'::jsonb);
  END IF;

  WITH scoped AS (
    SELECT e.id AS enrollment_id, l.global_lead_id
    FROM public.leads l
    INNER JOIN public.enrollments e ON e.lead_id = l.id AND e.campaign_id = l.campaign_id
    WHERE l.account_id = p_account_id
      AND l.campaign_id = p_campaign_id
      AND l.deleted_at IS NULL
      AND e.deleted_at IS NULL
      AND l.global_lead_id = ANY(v_unique_ids)
      AND e.state = 'paused'
  ),
  reactivated AS (
    UPDATE public.enrollments e
    SET
      state = 'active',
      next_run_at = NOW(),
      updated_at = NOW()
    FROM scoped s
    WHERE e.id = s.enrollment_id
    RETURNING e.id, s.global_lead_id
  )
  SELECT COUNT(*)::integer INTO v_resumed FROM reactivated;

  UPDATE public.message_jobs mj
  SET
    status = 'queued',
    status_reason = NULL,
    scheduled_at = NOW() + INTERVAL '30 seconds',
    reserved_at = NULL,
    send_wait_reason = NULL,
    error_message = NULL,
    updated_at = NOW()
  FROM public.leads l
  INNER JOIN public.enrollments e ON e.lead_id = l.id AND e.campaign_id = l.campaign_id
  WHERE mj.enrollment_id = e.id
    AND mj.campaign_id = p_campaign_id
    AND l.account_id = p_account_id
    AND l.deleted_at IS NULL
    AND e.deleted_at IS NULL
    AND l.global_lead_id = ANY(v_unique_ids)
    AND (mj.message_type = 'campaign' OR mj.message_type IS NULL)
    AND mj.status = 'deferred'
    AND mj.status_reason = 'enrollment_paused';

  SELECT COUNT(*)::integer
  INTO v_skipped
  FROM unnest(v_unique_ids) AS gid(id)
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.leads l
    INNER JOIN public.enrollments e ON e.lead_id = l.id AND e.campaign_id = l.campaign_id
    WHERE l.account_id = p_account_id
      AND l.campaign_id = p_campaign_id
      AND l.deleted_at IS NULL
      AND e.deleted_at IS NULL
      AND l.global_lead_id = gid.id
      AND e.state = 'paused'
  );

  RETURN jsonb_build_object(
    'resumed', v_resumed,
    'skipped', v_skipped,
    'errors', v_errors
  );
END;
$$;

COMMENT ON FUNCTION public.resume_enrollments_for_leads(uuid, uuid, text[]) IS
  'Manually resume paused enrollments for selected global leads. Requires campaign running. See ENROLLMENT_PAUSE_RESUME_SEMANTICS.md';

GRANT EXECUTE ON FUNCTION public.resume_enrollments_for_leads(uuid, uuid, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resume_enrollments_for_leads(uuid, uuid, text[]) TO service_role;

-- ---------------------------------------------------------------------------
-- Async bulk jobs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.start_pause_enrollments_job(
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
      'operation', 'pause_enrollments',
      'global_lead_ids', to_jsonb(v_unique_ids)
    ),
    '{}'::jsonb,
    '[]'::jsonb
  )
  RETURNING id INTO v_job_id;

  RETURN v_job_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_pause_enrollments_job(uuid, uuid, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_pause_enrollments_job(uuid, uuid, text[]) TO service_role;

CREATE OR REPLACE FUNCTION public.start_resume_enrollments_job(
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
      AND c.status = 'running'
      AND COALESCE(c.source, '') <> 'smartlead'
  ) THEN
    RAISE EXCEPTION 'Campaign must be running to resume enrollments.' USING ERRCODE = 'P0001';
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
      'operation', 'resume_enrollments',
      'global_lead_ids', to_jsonb(v_unique_ids)
    ),
    '{}'::jsonb,
    '[]'::jsonb
  )
  RETURNING id INTO v_job_id;

  RETURN v_job_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_resume_enrollments_job(uuid, uuid, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_resume_enrollments_job(uuid, uuid, text[]) TO service_role;

CREATE OR REPLACE FUNCTION public.start_pause_enrollments_job_for_list(
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
      'operation', 'pause_enrollments',
      'saved_list_id', p_list_id,
      'total_count', v_member_count
    ),
    '{}'::jsonb, '[]'::jsonb
  )
  RETURNING id INTO v_job_id;

  RETURN v_job_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_pause_enrollments_job_for_list(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_pause_enrollments_job_for_list(uuid, uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.start_resume_enrollments_job_for_list(
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
      AND c.deleted_at IS NULL AND c.status = 'running'
      AND COALESCE(c.source, '') <> 'smartlead'
  ) THEN
    RAISE EXCEPTION 'Campaign must be running to resume enrollments.' USING ERRCODE = 'P0001';
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
      'operation', 'resume_enrollments',
      'saved_list_id', p_list_id,
      'total_count', v_member_count
    ),
    '{}'::jsonb, '[]'::jsonb
  )
  RETURNING id INTO v_job_id;

  RETURN v_job_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_resume_enrollments_job_for_list(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_resume_enrollments_job_for_list(uuid, uuid, uuid) TO service_role;
