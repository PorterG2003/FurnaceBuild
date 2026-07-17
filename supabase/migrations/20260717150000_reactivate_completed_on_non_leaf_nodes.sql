-- Broaden flow-save reactivation: wake completed enrollments parked on any
-- non-leaf node (has outgoing edges in the new flow), not only tip leaves that
-- just gained their first outgoing edge. Fixes multi-generation append stranding.

CREATE OR REPLACE FUNCTION public.reactivate_completed_enrollments_on_non_leaves(
  p_campaign_id uuid,
  p_flow_data jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reactivated_count integer := 0;
BEGIN
  UPDATE public.enrollments e
  SET
    state = 'active',
    next_run_at = NOW(),
    updated_at = NOW()
  FROM public.nodes n
  WHERE e.campaign_id = p_campaign_id
    AND e.state = 'completed'
    AND e.deleted_at IS NULL
    AND n.id = e.current_node_id
    AND n.campaign_id = p_campaign_id
    AND n.deleted_at IS NULL
    AND n.flow_node_id IN (
      SELECT DISTINCT edge->>'source'
      FROM jsonb_array_elements(COALESCE(p_flow_data->'edges', '[]'::jsonb)) AS edge
      WHERE COALESCE(edge->>'source', '') <> ''
    );

  GET DIAGNOSTICS v_reactivated_count = ROW_COUNT;
  RETURN v_reactivated_count;
END;
$$;

COMMENT ON FUNCTION public.reactivate_completed_enrollments_on_non_leaves(uuid, jsonb) IS
  'Reactivates completed enrollments whose current node has an outgoing edge in p_flow_data. Leaves current_node_id unchanged; does not touch stopped.';

REVOKE ALL ON FUNCTION public.reactivate_completed_enrollments_on_non_leaves(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reactivate_completed_enrollments_on_non_leaves(uuid, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.update_campaign_flow_data(
  p_campaign_id uuid,
  p_flow_data jsonb,
  p_change_source text DEFAULT 'builder'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_campaign public.campaigns;
  v_old_flow jsonb;
  v_status text;
  v_reactivated_count integer := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT c.flow_data, c.status
  INTO v_old_flow, v_status
  FROM public.campaigns c
  INNER JOIN public.account_users au ON au.account_id = c.account_id
  WHERE c.id = p_campaign_id
    AND c.deleted_at IS NULL
    AND au.user_id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Campaign not found or access denied';
  END IF;

  PERFORM public.assert_flow_edit_allowed(v_status, COALESCE(v_old_flow, '{}'::jsonb), p_flow_data);

  PERFORM set_config('app.change_source', COALESCE(NULLIF(p_change_source, ''), 'app'), true);

  UPDATE public.campaigns
  SET flow_data = p_flow_data,
      updated_at = NOW()
  WHERE id = p_campaign_id
    AND deleted_at IS NULL
  RETURNING * INTO v_campaign;

  v_reactivated_count := public.reactivate_completed_enrollments_on_non_leaves(
    p_campaign_id,
    p_flow_data
  );

  RETURN jsonb_build_object(
    'campaign', to_jsonb(v_campaign),
    'reactivated_count', v_reactivated_count
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.update_campaign_flow_data_as_service(
  p_campaign_id uuid,
  p_account_id uuid,
  p_flow_data jsonb,
  p_change_source text DEFAULT 'client_api'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign public.campaigns;
  v_old_flow jsonb;
  v_status text;
  v_reactivated_count integer := 0;
BEGIN
  PERFORM private_assert_account_member(p_account_id);

  IF p_campaign_id IS NULL THEN
    RAISE EXCEPTION 'p_campaign_id is required';
  END IF;
  IF p_account_id IS NULL THEN
    RAISE EXCEPTION 'p_account_id is required';
  END IF;

  SELECT c.flow_data, c.status
  INTO v_old_flow, v_status
  FROM public.campaigns c
  WHERE c.id = p_campaign_id
    AND c.account_id = p_account_id
    AND c.deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Campaign not found or access denied';
  END IF;

  PERFORM public.assert_flow_edit_allowed(v_status, COALESCE(v_old_flow, '{}'::jsonb), p_flow_data);

  PERFORM set_config('app.change_source', COALESCE(NULLIF(p_change_source, ''), 'app'), true);

  UPDATE public.campaigns
  SET
    flow_data = p_flow_data,
    updated_at = now()
  WHERE id = p_campaign_id
    AND account_id = p_account_id
    AND deleted_at IS NULL
  RETURNING * INTO v_campaign;

  v_reactivated_count := public.reactivate_completed_enrollments_on_non_leaves(
    p_campaign_id,
    p_flow_data
  );

  RETURN jsonb_build_object(
    'campaign', to_jsonb(v_campaign),
    'reactivated_count', v_reactivated_count
  );
END;
$$;

COMMENT ON FUNCTION public.update_campaign_flow_data(uuid, jsonb, text) IS
  'Updates campaigns.flow_data with lifecycle enforcement and reactivates completed enrollments on non-leaf nodes. Returns { campaign, reactivated_count }.';
COMMENT ON FUNCTION public.update_campaign_flow_data_as_service(uuid, uuid, jsonb, text) IS
  'Service-role flow write with lifecycle enforcement and non-leaf completed reactivation. Returns { campaign, reactivated_count }.';
