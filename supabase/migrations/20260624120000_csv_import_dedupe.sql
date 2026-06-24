-- CSV import dedupe preview + staged async upload for builder CSV wizard

ALTER TABLE public.api_import_jobs
  DROP CONSTRAINT IF EXISTS api_import_jobs_status_check;

ALTER TABLE public.api_import_jobs
  ADD CONSTRAINT api_import_jobs_status_check
  CHECK (status IN ('uploading', 'queued', 'running', 'completed', 'failed'));

CREATE TABLE IF NOT EXISTS public.csv_import_staging (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.api_import_jobs(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  row_index integer NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT csv_import_staging_row_index_unique UNIQUE (job_id, row_index)
);

CREATE INDEX IF NOT EXISTS idx_csv_import_staging_job_row
  ON public.csv_import_staging (job_id, row_index);

ALTER TABLE public.csv_import_staging ENABLE ROW LEVEL SECURITY;

CREATE POLICY csv_import_staging_select ON public.csv_import_staging
  FOR SELECT
  USING (
    account_id IN (
      SELECT au.account_id FROM public.account_users au WHERE au.user_id = auth.uid()
    )
  );

CREATE POLICY csv_import_staging_insert ON public.csv_import_staging
  FOR INSERT
  WITH CHECK (
    account_id IN (
      SELECT au.account_id FROM public.account_users au WHERE au.user_id = auth.uid()
    )
  );

CREATE POLICY csv_import_staging_delete ON public.csv_import_staging
  FOR DELETE
  USING (
    account_id IN (
      SELECT au.account_id FROM public.account_users au WHERE au.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- preview_emails_in_campaigns: inverted lookup (CSV emails → existing in campaigns)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.preview_emails_in_campaigns(
  p_account_id uuid,
  p_campaign_ids uuid[],
  p_emails text[]
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_normalized text[];
  v_matching text[];
  v_count_by_campaign jsonb := '{}'::jsonb;
  v_row record;
BEGIN
  PERFORM private_assert_account_member(p_account_id);

  SELECT COALESCE(array_agg(DISTINCT lower(btrim(e)) ORDER BY lower(btrim(e))), ARRAY[]::text[])
  INTO v_normalized
  FROM unnest(COALESCE(p_emails, ARRAY[]::text[])) AS e
  WHERE e IS NOT NULL AND btrim(e) <> '';

  IF COALESCE(array_length(v_normalized, 1), 0) = 0 THEN
    RETURN jsonb_build_object(
      'matchingEmails', '[]'::jsonb,
      'countByCampaign', '{}'::jsonb
    );
  END IF;

  SELECT COALESCE(array_agg(DISTINCT lower(btrim(l.email)) ORDER BY lower(btrim(l.email))), ARRAY[]::text[])
  INTO v_matching
  FROM public.leads l
  WHERE l.account_id = p_account_id
    AND l.campaign_id = ANY(COALESCE(p_campaign_ids, ARRAY[]::uuid[]))
    AND l.deleted_at IS NULL
    AND l.email IS NOT NULL
    AND btrim(l.email) <> ''
    AND lower(btrim(l.email)) = ANY(v_normalized);

  FOR v_row IN
    SELECT l.campaign_id::text AS campaign_id, COUNT(DISTINCT lower(btrim(l.email)))::integer AS cnt
    FROM public.leads l
    WHERE l.account_id = p_account_id
      AND l.campaign_id = ANY(COALESCE(p_campaign_ids, ARRAY[]::uuid[]))
      AND l.deleted_at IS NULL
      AND l.email IS NOT NULL
      AND btrim(l.email) <> ''
      AND lower(btrim(l.email)) = ANY(v_normalized)
    GROUP BY l.campaign_id
  LOOP
    v_count_by_campaign := v_count_by_campaign || jsonb_build_object(v_row.campaign_id, v_row.cnt);
  END LOOP;

  RETURN jsonb_build_object(
    'matchingEmails', COALESCE(to_jsonb(v_matching), '[]'::jsonb),
    'countByCampaign', v_count_by_campaign
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.preview_emails_in_campaigns(uuid, uuid[], text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.preview_emails_in_campaigns(uuid, uuid[], text[]) TO service_role;

-- ---------------------------------------------------------------------------
-- Staged CSV import job RPCs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_csv_lead_import_job(
  p_account_id uuid,
  p_campaign_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job_id uuid;
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
    'uploading',
    0,
    0,
    jsonb_build_object(
      'operation', 'csv_lead_import_staged',
      'source', 'csv_import'
    ),
    '{}'::jsonb,
    '[]'::jsonb
  )
  RETURNING id INTO v_job_id;

  RETURN v_job_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_csv_lead_import_job(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_csv_lead_import_job(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.append_csv_import_staging_rows(
  p_job_id uuid,
  p_rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.api_import_jobs%ROWTYPE;
  v_row jsonb;
  v_next_index integer;
  v_inserted integer := 0;
  v_total integer;
BEGIN
  SELECT * INTO v_job FROM public.api_import_jobs j WHERE j.id = p_job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Import job not found.' USING ERRCODE = 'P0002';
  END IF;

  IF auth.uid() IS NOT NULL THEN
    PERFORM private_assert_account_member(v_job.account_id);
  END IF;

  IF v_job.status <> 'uploading' THEN
    RAISE EXCEPTION 'Import job is not accepting uploads.' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(MAX(s.row_index), -1) + 1
  INTO v_next_index
  FROM public.csv_import_staging s
  WHERE s.job_id = p_job_id;

  FOR v_row IN SELECT value FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) LOOP
    INSERT INTO public.csv_import_staging (
      job_id,
      account_id,
      row_index,
      payload
    )
    VALUES (
      p_job_id,
      v_job.account_id,
      v_next_index,
      v_row
    );
    v_next_index := v_next_index + 1;
    v_inserted := v_inserted + 1;
  END LOOP;

  SELECT COUNT(*)::integer INTO v_total
  FROM public.csv_import_staging s
  WHERE s.job_id = p_job_id;

  UPDATE public.api_import_jobs j
  SET updated_at = now()
  WHERE j.id = p_job_id;

  RETURN jsonb_build_object(
    'uploadedCount', v_inserted,
    'totalCount', v_total
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.append_csv_import_staging_rows(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.append_csv_import_staging_rows(uuid, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.finalize_csv_lead_import_job(
  p_job_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.api_import_jobs%ROWTYPE;
  v_total integer;
BEGIN
  SELECT * INTO v_job FROM public.api_import_jobs j WHERE j.id = p_job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Import job not found.' USING ERRCODE = 'P0002';
  END IF;

  IF auth.uid() IS NOT NULL THEN
    PERFORM private_assert_account_member(v_job.account_id);
  END IF;

  IF v_job.status <> 'uploading' THEN
    RAISE EXCEPTION 'Import job is not in uploading state.' USING ERRCODE = 'P0001';
  END IF;

  SELECT COUNT(*)::integer INTO v_total
  FROM public.csv_import_staging s
  WHERE s.job_id = p_job_id;

  IF v_total <= 0 THEN
    RAISE EXCEPTION 'No staged rows to import.' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.api_import_jobs j
  SET
    status = 'queued',
    progress = 0,
    cursor = 0,
    input = COALESCE(j.input, '{}'::jsonb) || jsonb_build_object('total_count', v_total),
    updated_at = now()
  WHERE j.id = p_job_id;

  RETURN p_job_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.finalize_csv_lead_import_job(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_csv_lead_import_job(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.delete_csv_import_staging_for_job(
  p_job_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.api_import_jobs%ROWTYPE;
BEGIN
  SELECT * INTO v_job FROM public.api_import_jobs j WHERE j.id = p_job_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF auth.uid() IS NOT NULL THEN
    PERFORM private_assert_account_member(v_job.account_id);
  END IF;

  DELETE FROM public.csv_import_staging s WHERE s.job_id = p_job_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_csv_import_staging_for_job(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_csv_import_staging_for_job(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
