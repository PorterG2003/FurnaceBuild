CREATE OR REPLACE FUNCTION public.update_campaign_flow_data_as_service(
  p_campaign_id uuid,
  p_account_id uuid,
  p_flow_data jsonb,
  p_change_source text DEFAULT 'client_api'
)
RETURNS public.campaigns
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign public.campaigns;
BEGIN
  PERFORM private_assert_account_member(p_account_id);

  IF p_campaign_id IS NULL THEN
    RAISE EXCEPTION 'p_campaign_id is required';
  END IF;
  IF p_account_id IS NULL THEN
    RAISE EXCEPTION 'p_account_id is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.campaigns c
    WHERE c.id = p_campaign_id
      AND c.account_id = p_account_id
      AND c.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Campaign not found or access denied';
  END IF;

  PERFORM set_config('app.change_source', COALESCE(NULLIF(p_change_source, ''), 'app'), true);

  UPDATE public.campaigns
  SET
    flow_data = p_flow_data,
    updated_at = now()
  WHERE id = p_campaign_id
    AND account_id = p_account_id
    AND deleted_at IS NULL
  RETURNING * INTO v_campaign;

  RETURN v_campaign;
END;
$$;

COMMENT ON FUNCTION public.update_campaign_flow_data_as_service(uuid, uuid, jsonb, text) IS
  'Account-scoped service-role flow write path for campaigns.flow_data, preserving flow version audit history and node sync triggers.';

REVOKE ALL ON FUNCTION public.update_campaign_flow_data_as_service(uuid, uuid, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_campaign_flow_data_as_service(uuid, uuid, jsonb, text) TO service_role;
