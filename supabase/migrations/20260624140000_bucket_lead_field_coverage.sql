-- Field fill coverage for a campaign lead bucket (builder Lead Source modal).

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
