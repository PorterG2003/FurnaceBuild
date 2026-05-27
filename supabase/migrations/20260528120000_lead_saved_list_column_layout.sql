-- Persist saved-list column layouts and support add-to-campaign jobs by list id.

ALTER TABLE public.lead_saved_lists
  ADD COLUMN IF NOT EXISTS column_layout JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.lead_saved_lists.column_layout IS
  'Array of column definition objects (sourceType, fieldKey, label, visible, etc.) for the list workbench.';

CREATE OR REPLACE FUNCTION public.start_add_to_campaign_job_for_list(
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
    SELECT 1
    FROM public.campaigns c
    WHERE c.id = p_campaign_id
      AND c.account_id = p_account_id
      AND c.deleted_at IS NULL
      AND COALESCE(c.source, '') <> 'smartlead'
  ) THEN
    RAISE EXCEPTION 'Campaign not found or not mutable for this account.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.lead_saved_lists l
    WHERE l.id = p_list_id
      AND l.account_id = p_account_id
  ) THEN
    RAISE EXCEPTION 'Saved list not found for this account.' USING ERRCODE = 'P0002';
  END IF;

  SELECT COUNT(*)::bigint
  INTO v_member_count
  FROM public.lead_saved_list_members m
  WHERE m.list_id = p_list_id
    AND m.account_id = p_account_id;

  IF COALESCE(v_member_count, 0) = 0 THEN
    RAISE EXCEPTION 'Saved list has no members.' USING ERRCODE = 'P0001';
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
      'saved_list_id', p_list_id,
      'total_count', v_member_count
    ),
    '{}'::jsonb,
    '[]'::jsonb
  )
  RETURNING id INTO v_job_id;

  RETURN v_job_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_add_to_campaign_job_for_list(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_add_to_campaign_job_for_list(uuid, uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.lead_saved_list_member_counts(
  p_account_id uuid,
  p_list_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  list_id uuid,
  lead_count bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    m.list_id,
    COUNT(*)::bigint AS lead_count
  FROM public.lead_saved_list_members m
  INNER JOIN public.lead_saved_lists l ON l.id = m.list_id
  WHERE l.account_id = p_account_id
    AND (
      p_list_ids IS NULL
      OR COALESCE(array_length(p_list_ids, 1), 0) = 0
      OR m.list_id = ANY(p_list_ids)
    )
  GROUP BY m.list_id;
$$;

GRANT EXECUTE ON FUNCTION public.lead_saved_list_member_counts(uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lead_saved_list_member_counts(uuid, uuid[]) TO service_role;
