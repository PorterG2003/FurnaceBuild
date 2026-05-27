-- ============================================
-- Migration: extend api_import_jobs for chunked bulk + UI job RPCs
-- ============================================

ALTER TABLE public.api_import_jobs
  ADD COLUMN IF NOT EXISTS cursor integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.api_import_jobs.cursor IS
  'Resume index into input.leads or input.global_lead_ids for chunked worker processing.';

-- Member-readable job status for workbench async adds
CREATE OR REPLACE FUNCTION public.get_account_import_job(p_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.api_import_jobs%ROWTYPE;
BEGIN
  SELECT * INTO v_job
  FROM public.api_import_jobs j
  WHERE j.id = p_job_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF auth.uid() IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.account_users au
      WHERE au.account_id = v_job.account_id
        AND au.user_id = auth.uid()
    ) THEN
      RAISE EXCEPTION 'Account membership required' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'id', v_job.id,
    'account_id', v_job.account_id,
    'campaign_id', v_job.campaign_id,
    'status', v_job.status,
    'progress', v_job.progress,
    'cursor', v_job.cursor,
    'input', v_job.input,
    'result', v_job.result,
    'errors', v_job.errors,
    'started_at', v_job.started_at,
    'completed_at', v_job.completed_at,
    'created_at', v_job.created_at,
    'updated_at', v_job.updated_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_account_import_job(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_account_import_job(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.start_add_to_campaign_job(
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
    account_id,
    campaign_id,
    status,
    progress,
    cursor,
    input,
    result,
    errors
  )
  VALUES (
    p_account_id,
    p_campaign_id,
    'queued',
    0,
    0,
    jsonb_build_object(
      'operation', 'add_to_campaign',
      'global_lead_ids', to_jsonb(v_unique_ids)
    ),
    '{}'::jsonb,
    '[]'::jsonb
  )
  RETURNING id INTO v_job_id;

  RETURN v_job_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_add_to_campaign_job(uuid, uuid, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_add_to_campaign_job(uuid, uuid, text[]) TO service_role;
