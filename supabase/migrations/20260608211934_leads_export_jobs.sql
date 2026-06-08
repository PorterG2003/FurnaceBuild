CREATE OR REPLACE FUNCTION public.start_leads_export_job(
  p_account_id uuid,
  p_source text,
  p_global_lead_ids text[] DEFAULT NULL,
  p_list_id uuid DEFAULT NULL,
  p_query jsonb DEFAULT '{}'::jsonb,
  p_column_layout jsonb DEFAULT '[]'::jsonb,
  p_total_count integer DEFAULT NULL,
  p_filename_base text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job_id uuid;
  v_unique_ids text[];
  v_total_count integer;
BEGIN
  PERFORM private_assert_account_member(p_account_id);

  IF p_source NOT IN ('explorer', 'saved_list') THEN
    RAISE EXCEPTION 'Invalid export source.' USING ERRCODE = 'P0001';
  END IF;

  IF p_source = 'saved_list' THEN
    IF p_list_id IS NULL THEN
      RAISE EXCEPTION 'Saved list export requires list_id.' USING ERRCODE = 'P0001';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.lead_saved_lists l
      WHERE l.id = p_list_id
        AND l.account_id = p_account_id
    ) THEN
      RAISE EXCEPTION 'Saved list not found.' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  SELECT COALESCE(array_agg(DISTINCT id ORDER BY id), ARRAY[]::text[])
  INTO v_unique_ids
  FROM unnest(COALESCE(p_global_lead_ids, ARRAY[]::text[])) AS id
  WHERE id IS NOT NULL AND btrim(id) <> '';

  v_total_count := GREATEST(COALESCE(p_total_count, COALESCE(array_length(v_unique_ids, 1), 0)), 0);

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
    NULL,
    'queued',
    0,
    0,
    jsonb_build_object(
      'operation', 'export_leads',
      'source', p_source,
      'list_id', p_list_id,
      'global_lead_ids', to_jsonb(v_unique_ids),
      'query', COALESCE(p_query, '{}'::jsonb),
      'column_layout', COALESCE(p_column_layout, '[]'::jsonb),
      'total_count', v_total_count,
      'filename_base', NULLIF(btrim(COALESCE(p_filename_base, '')), '')
    ),
    jsonb_build_object(
      'current_step', 'queued',
      'rows_processed', 0,
      'total_rows', v_total_count
    ),
    '[]'::jsonb
  )
  RETURNING id INTO v_job_id;

  RETURN v_job_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_leads_export_job(uuid, text, text[], uuid, jsonb, jsonb, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_leads_export_job(uuid, text, text[], uuid, jsonb, jsonb, integer, text) TO service_role;
