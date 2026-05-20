-- Resolve content_assets for prospect page rendering (public live pages + owner draft preview on /p/{slug}).
CREATE OR REPLACE FUNCTION public.flux_resolve_page_content_assets(p_slug TEXT)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign_id uuid;
  v_page_config jsonb;
  v_status text;
  v_account_id uuid;
  v_content_assets jsonb;
  v_asset_ids text[];
  v_result jsonb := '[]'::jsonb;
BEGIN
  SELECT campaign_id, page_config, status, account_id
  INTO v_campaign_id, v_page_config, v_status, v_account_id
  FROM flux_prospect_pages
  WHERE slug = trim(p_slug)
  LIMIT 1;

  IF v_campaign_id IS NULL THEN
    RETURN v_result;
  END IF;

  IF v_status IS DISTINCT FROM 'live' THEN
    IF auth.uid() IS NULL THEN
      RETURN v_result;
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM account_users au
      WHERE au.account_id = v_account_id AND au.user_id = auth.uid()
    ) THEN
      RETURN v_result;
    END IF;
  END IF;

  SELECT coalesce(array_agg(DISTINCT trim(b->'props'->>'assetId')), ARRAY[]::text[])
  INTO v_asset_ids
  FROM jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(v_page_config->'blocks') = 'array' THEN v_page_config->'blocks'
      ELSE '[]'::jsonb
    END
  ) AS b
  WHERE b->>'type' IN ('case_study', 'testimonial')
    AND coalesce(trim(b->'props'->>'assetId'), '') <> '';

  IF v_asset_ids IS NULL OR cardinality(v_asset_ids) = 0 THEN
    RETURN v_result;
  END IF;

  SELECT t.content_assets
  INTO v_content_assets
  FROM flux_campaign_templates t
  WHERE t.campaign_id = v_campaign_id;

  IF v_content_assets IS NULL OR jsonb_typeof(v_content_assets) <> 'array' THEN
    RETURN v_result;
  END IF;

  SELECT coalesce(jsonb_agg(asset ORDER BY asset->>'id'), '[]'::jsonb)
  INTO v_result
  FROM jsonb_array_elements(v_content_assets) AS asset
  WHERE asset->>'id' = ANY (v_asset_ids);

  RETURN coalesce(v_result, '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.flux_resolve_page_content_assets(TEXT) TO anon, authenticated;

COMMENT ON FUNCTION public.flux_resolve_page_content_assets(TEXT) IS
  'Returns campaign content_assets referenced by case_study/testimonial blocks on a prospect page. Live pages: anon OK. Draft/archived: account members only.';
