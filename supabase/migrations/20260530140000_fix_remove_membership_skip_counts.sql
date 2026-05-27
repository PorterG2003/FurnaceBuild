-- Fix skipped counts: post-mutation NOT EXISTS(deleted_at IS NULL) treated successful
-- removals as skipped. Mirror pause/resume fix in 20260529130100.

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
  v_removed_people integer := 0;
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
  SELECT
    COUNT(*)::integer,
    COUNT(DISTINCT global_lead_id)::integer
  INTO v_removed, v_removed_people
  FROM removed_leads;

  v_skipped := GREATEST(COALESCE(array_length(v_unique_ids, 1), 0) - v_removed_people, 0);

  RETURN jsonb_build_object(
    'removed', v_removed,
    'skipped', v_skipped,
    'errors', v_errors
  );
END;
$$;

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
  v_removed_people integer := 0;
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
    SELECT l.id AS lead_id, l.campaign_id, l.global_lead_id
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
    RETURNING l.global_lead_id
  )
  SELECT
    COUNT(*)::integer,
    COUNT(DISTINCT global_lead_id)::integer
  INTO v_removed, v_removed_people
  FROM removed_leads;

  v_skipped := GREATEST(COALESCE(array_length(v_unique_ids, 1), 0) - v_removed_people, 0);

  RETURN jsonb_build_object(
    'removed', v_removed,
    'skipped', v_skipped,
    'errors', v_errors
  );
END;
$$;
