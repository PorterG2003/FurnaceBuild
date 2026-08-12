-- Bulk-first MCP: logical jobs, cancel, claim slots, list membership, previews, uploads

-- ---------------------------------------------------------------------------
-- api_import_jobs: cancelled status + cancel request metadata
-- ---------------------------------------------------------------------------
ALTER TABLE public.api_import_jobs
  DROP CONSTRAINT IF EXISTS api_import_jobs_status_check;

ALTER TABLE public.api_import_jobs
  ADD CONSTRAINT api_import_jobs_status_check
  CHECK (status IN ('uploading', 'queued', 'running', 'completed', 'failed', 'cancelled'));

ALTER TABLE public.api_import_jobs
  ADD COLUMN IF NOT EXISTS cancel_requested_at timestamptz NULL;

COMMENT ON COLUMN public.api_import_jobs.cancel_requested_at IS
  'When set, workers should stop between chunks and mark the job cancelled.';

-- ---------------------------------------------------------------------------
-- Bulk operation previews (short-lived confirmation binding)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.api_bulk_operation_previews (
  id text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  operation text NOT NULL,
  operation_hash text NOT NULL,
  scope jsonb NOT NULL,
  exclusions jsonb NULL,
  target jsonb NULL,
  counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS api_bulk_operation_previews_account_idx
  ON public.api_bulk_operation_previews (account_id, expires_at DESC);

ALTER TABLE public.api_bulk_operation_previews ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Object uploads for optional presigned CSV ingress
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.api_bulk_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  created_by_api_key_id uuid NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'uploaded', 'finalized', 'failed', 'expired')),
  filename text NULL,
  content_type text NULL DEFAULT 'text/csv',
  byte_size bigint NULL,
  s3_bucket text NULL,
  s3_key text NULL,
  campaign_id uuid NULL REFERENCES public.campaigns(id) ON DELETE SET NULL,
  job_id uuid NULL REFERENCES public.api_import_jobs(id) ON DELETE SET NULL,
  error_message text NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS api_bulk_uploads_account_idx
  ON public.api_bulk_uploads (account_id, created_at DESC);

ALTER TABLE public.api_bulk_uploads ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Claim a queued job into a running slot (concurrency = running only)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_api_import_job(
  p_job_id uuid,
  p_max_running integer DEFAULT 3
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.api_import_jobs%ROWTYPE;
  v_running integer;
  v_now timestamptz := now();
BEGIN
  SELECT * INTO v_job
  FROM public.api_import_jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'not_found');
  END IF;

  IF v_job.cancel_requested_at IS NOT NULL THEN
    UPDATE public.api_import_jobs
    SET
      status = 'cancelled',
      completed_at = v_now,
      updated_at = v_now
    WHERE id = p_job_id;
    RETURN jsonb_build_object('claimed', false, 'reason', 'cancelled');
  END IF;

  IF v_job.status = 'running' THEN
    RETURN jsonb_build_object('claimed', true, 'reason', 'already_running');
  END IF;

  IF v_job.status <> 'queued' THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'not_queued', 'status', v_job.status);
  END IF;

  SELECT COUNT(*)::integer
  INTO v_running
  FROM public.api_import_jobs
  WHERE account_id = v_job.account_id
    AND status = 'running'
    AND id <> p_job_id;

  IF v_running >= GREATEST(COALESCE(p_max_running, 3), 1) THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'reason', 'no_slot',
      'running', v_running,
      'max_running', GREATEST(COALESCE(p_max_running, 3), 1)
    );
  END IF;

  UPDATE public.api_import_jobs
  SET
    status = 'running',
    started_at = COALESCE(started_at, v_now),
    updated_at = v_now
  WHERE id = p_job_id;

  RETURN jsonb_build_object('claimed', true, 'reason', 'claimed');
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_api_import_job(uuid, integer) TO service_role;

-- ---------------------------------------------------------------------------
-- Request cancellation (idempotent)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_cancel_api_import_job(
  p_account_id uuid,
  p_job_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.api_import_jobs%ROWTYPE;
  v_now timestamptz := now();
BEGIN
  SELECT * INTO v_job
  FROM public.api_import_jobs
  WHERE id = p_job_id
    AND account_id = p_account_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Import job not found.' USING ERRCODE = 'P0002';
  END IF;

  IF v_job.status IN ('completed', 'failed', 'cancelled') THEN
    RETURN jsonb_build_object(
      'id', v_job.id,
      'status', v_job.status,
      'cancel_requested', v_job.cancel_requested_at IS NOT NULL,
      'changed', false
    );
  END IF;

  UPDATE public.api_import_jobs
  SET
    cancel_requested_at = COALESCE(cancel_requested_at, v_now),
    status = CASE
      WHEN status = 'queued' THEN 'cancelled'
      WHEN status = 'uploading' THEN 'cancelled'
      ELSE status
    END,
    completed_at = CASE
      WHEN status IN ('queued', 'uploading') THEN v_now
      ELSE completed_at
    END,
    updated_at = v_now
  WHERE id = p_job_id
  RETURNING * INTO v_job;

  RETURN jsonb_build_object(
    'id', v_job.id,
    'status', v_job.status,
    'cancel_requested', true,
    'changed', true
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_cancel_api_import_job(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_cancel_api_import_job(uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- Async saved-list membership jobs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.start_add_to_lead_list_job(
  p_account_id uuid,
  p_list_id uuid,
  p_global_lead_ids text[] DEFAULT NULL,
  p_source_list_id uuid DEFAULT NULL,
  p_source_campaign_id uuid DEFAULT NULL,
  p_exclude_list_id uuid DEFAULT NULL,
  p_exclude_global_lead_ids text[] DEFAULT NULL,
  p_exclude_emails text[] DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job_id uuid;
  v_unique_ids text[];
  v_total integer := 0;
BEGIN
  PERFORM private_assert_account_member(p_account_id);

  IF NOT EXISTS (
    SELECT 1 FROM public.lead_saved_lists l
    WHERE l.id = p_list_id AND l.account_id = p_account_id
  ) THEN
    RAISE EXCEPTION 'Saved list not found for this account.' USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT id ORDER BY id), ARRAY[]::text[])
  INTO v_unique_ids
  FROM unnest(COALESCE(p_global_lead_ids, ARRAY[]::text[])) AS id
  WHERE id IS NOT NULL AND btrim(id) <> '';

  IF p_source_list_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.lead_saved_lists l
      WHERE l.id = p_source_list_id AND l.account_id = p_account_id
    ) THEN
      RAISE EXCEPTION 'Source saved list not found.' USING ERRCODE = 'P0002';
    END IF;
    SELECT COUNT(*)::integer INTO v_total
    FROM public.lead_saved_list_members m
    WHERE m.list_id = p_source_list_id AND m.account_id = p_account_id;
  ELSIF p_source_campaign_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.campaigns c
      WHERE c.id = p_source_campaign_id
        AND c.account_id = p_account_id
        AND c.deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Source campaign not found.' USING ERRCODE = 'P0002';
    END IF;
    SELECT COUNT(*)::integer INTO v_total
    FROM public.leads l
    WHERE l.campaign_id = p_source_campaign_id
      AND l.account_id = p_account_id
      AND l.deleted_at IS NULL
      AND l.global_lead_id IS NOT NULL;
  ELSE
    v_total := COALESCE(array_length(v_unique_ids, 1), 0);
  END IF;

  IF COALESCE(v_total, 0) <= 0 AND COALESCE(array_length(v_unique_ids, 1), 0) <= 0 THEN
    RAISE EXCEPTION 'No people to add to the lead list.' USING ERRCODE = 'P0001';
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
      'operation', 'add_to_lead_list',
      'target_list_id', p_list_id,
      'global_lead_ids', to_jsonb(COALESCE(v_unique_ids, ARRAY[]::text[])),
      'saved_list_id', p_source_list_id,
      'source_campaign_id', p_source_campaign_id,
      'total_count', GREATEST(COALESCE(v_total, 0), COALESCE(array_length(v_unique_ids, 1), 0)),
      'exclusions', jsonb_strip_nulls(jsonb_build_object(
        'list_id', p_exclude_list_id,
        'global_lead_ids', to_jsonb(COALESCE(p_exclude_global_lead_ids, ARRAY[]::text[])),
        'emails', to_jsonb(COALESCE(p_exclude_emails, ARRAY[]::text[]))
      ))
    ),
    '{}'::jsonb,
    '[]'::jsonb
  )
  RETURNING id INTO v_job_id;

  RETURN v_job_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.start_remove_from_lead_list_job(
  p_account_id uuid,
  p_list_id uuid,
  p_global_lead_ids text[] DEFAULT NULL,
  p_source_list_id uuid DEFAULT NULL,
  p_source_campaign_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job_id uuid;
  v_unique_ids text[];
  v_total integer := 0;
BEGIN
  PERFORM private_assert_account_member(p_account_id);

  IF NOT EXISTS (
    SELECT 1 FROM public.lead_saved_lists l
    WHERE l.id = p_list_id AND l.account_id = p_account_id
  ) THEN
    RAISE EXCEPTION 'Saved list not found for this account.' USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT id ORDER BY id), ARRAY[]::text[])
  INTO v_unique_ids
  FROM unnest(COALESCE(p_global_lead_ids, ARRAY[]::text[])) AS id
  WHERE id IS NOT NULL AND btrim(id) <> '';

  IF p_source_list_id IS NOT NULL THEN
    SELECT COUNT(*)::integer INTO v_total
    FROM public.lead_saved_list_members m
    WHERE m.list_id = p_source_list_id AND m.account_id = p_account_id;
  ELSIF p_source_campaign_id IS NOT NULL THEN
    SELECT COUNT(*)::integer INTO v_total
    FROM public.leads l
    WHERE l.campaign_id = p_source_campaign_id
      AND l.account_id = p_account_id
      AND l.deleted_at IS NULL
      AND l.global_lead_id IS NOT NULL;
  ELSE
    v_total := COALESCE(array_length(v_unique_ids, 1), 0);
  END IF;

  IF COALESCE(v_total, 0) <= 0 AND COALESCE(array_length(v_unique_ids, 1), 0) <= 0 THEN
    RAISE EXCEPTION 'No people to remove from the lead list.' USING ERRCODE = 'P0001';
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
      'operation', 'remove_from_lead_list',
      'target_list_id', p_list_id,
      'global_lead_ids', to_jsonb(COALESCE(v_unique_ids, ARRAY[]::text[])),
      'saved_list_id', p_source_list_id,
      'source_campaign_id', p_source_campaign_id,
      'total_count', GREATEST(COALESCE(v_total, 0), COALESCE(array_length(v_unique_ids, 1), 0))
    ),
    '{}'::jsonb,
    '[]'::jsonb
  )
  RETURNING id INTO v_job_id;

  RETURN v_job_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_add_to_lead_list_job(uuid, uuid, text[], uuid, uuid, uuid, text[], text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_add_to_lead_list_job(uuid, uuid, text[], uuid, uuid, uuid, text[], text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.start_remove_from_lead_list_job(uuid, uuid, text[], uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_remove_from_lead_list_job(uuid, uuid, text[], uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- Scoped add-to-campaign with exclusions (campaign or list source)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.start_add_to_campaign_job_scoped(
  p_account_id uuid,
  p_campaign_id uuid,
  p_source_list_id uuid DEFAULT NULL,
  p_source_campaign_id uuid DEFAULT NULL,
  p_global_lead_ids text[] DEFAULT NULL,
  p_exclude_list_id uuid DEFAULT NULL,
  p_exclude_campaign_id uuid DEFAULT NULL,
  p_exclude_global_lead_ids text[] DEFAULT NULL,
  p_exclude_emails text[] DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job_id uuid;
  v_unique_ids text[];
  v_total integer := 0;
BEGIN
  PERFORM private_assert_account_member(p_account_id);

  IF NOT EXISTS (
    SELECT 1 FROM public.campaigns c
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

  IF p_source_list_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.lead_saved_lists l
      WHERE l.id = p_source_list_id AND l.account_id = p_account_id
    ) THEN
      RAISE EXCEPTION 'Source saved list not found.' USING ERRCODE = 'P0002';
    END IF;
    SELECT COUNT(*)::integer INTO v_total
    FROM public.lead_saved_list_members m
    WHERE m.list_id = p_source_list_id AND m.account_id = p_account_id;
  ELSIF p_source_campaign_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.campaigns c
      WHERE c.id = p_source_campaign_id
        AND c.account_id = p_account_id
        AND c.deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Source campaign not found.' USING ERRCODE = 'P0002';
    END IF;
    SELECT COUNT(*)::integer INTO v_total
    FROM public.leads l
    WHERE l.campaign_id = p_source_campaign_id
      AND l.account_id = p_account_id
      AND l.deleted_at IS NULL
      AND l.global_lead_id IS NOT NULL;
  ELSE
    v_total := COALESCE(array_length(v_unique_ids, 1), 0);
  END IF;

  IF COALESCE(v_total, 0) <= 0 AND COALESCE(array_length(v_unique_ids, 1), 0) <= 0 THEN
    RAISE EXCEPTION 'No people to enroll.' USING ERRCODE = 'P0001';
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
      'operation', 'add_to_campaign',
      'saved_list_id', p_source_list_id,
      'source_campaign_id', p_source_campaign_id,
      'global_lead_ids', to_jsonb(COALESCE(v_unique_ids, ARRAY[]::text[])),
      'total_count', GREATEST(COALESCE(v_total, 0), COALESCE(array_length(v_unique_ids, 1), 0)),
      'exclusions', jsonb_strip_nulls(jsonb_build_object(
        'list_id', p_exclude_list_id,
        'campaign_id', p_exclude_campaign_id,
        'global_lead_ids', to_jsonb(COALESCE(p_exclude_global_lead_ids, ARRAY[]::text[])),
        'emails', to_jsonb(COALESCE(p_exclude_emails, ARRAY[]::text[]))
      ))
    ),
    '{}'::jsonb,
    '[]'::jsonb
  )
  RETURNING id INTO v_job_id;

  RETURN v_job_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_add_to_campaign_job_scoped(
  uuid, uuid, uuid, uuid, text[], uuid, uuid, text[], text[]
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_add_to_campaign_job_scoped(
  uuid, uuid, uuid, uuid, text[], uuid, uuid, text[], text[]
) TO service_role;
