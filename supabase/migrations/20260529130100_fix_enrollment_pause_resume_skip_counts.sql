-- Fix skipped counts: previously counted post-mutation rows (paused/resumed people
-- no longer matched active/paused), double-counting successful operations.

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

  v_skipped := GREATEST(COALESCE(array_length(v_unique_ids, 1), 0) - v_paused, 0);

  RETURN jsonb_build_object(
    'paused', v_paused,
    'skipped', v_skipped,
    'errors', v_errors
  );
END;
$$;

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

  v_skipped := GREATEST(COALESCE(array_length(v_unique_ids, 1), 0) - v_resumed, 0);

  RETURN jsonb_build_object(
    'resumed', v_resumed,
    'skipped', v_skipped,
    'errors', v_errors
  );
END;
$$;
