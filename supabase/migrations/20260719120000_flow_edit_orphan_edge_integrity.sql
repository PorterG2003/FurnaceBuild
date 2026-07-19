-- Harden flow-edit integrity:
-- 1. Classify lifecycle on orphan-pruned graphs (orphan edge drops are not structural).
-- 2. Reactivate completed only on live-target non-leaves; exclude aiCategorizer.
-- 3. Document detect_flow_append as unused legacy (tip-only; write path uses non-leaf heal).

CREATE OR REPLACE FUNCTION public.internal_flow_data_without_orphan_edges(p_flow jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'nodes', COALESCE(p_flow->'nodes', '[]'::jsonb),
    'edges', COALESCE(
      (
        SELECT jsonb_agg(edge ORDER BY edge->>'id')
        FROM jsonb_array_elements(COALESCE(p_flow->'edges', '[]'::jsonb)) AS edge
        WHERE COALESCE(edge->>'source', '') <> ''
          AND COALESCE(edge->>'target', '') <> ''
          AND EXISTS (
            SELECT 1
            FROM jsonb_array_elements(COALESCE(p_flow->'nodes', '[]'::jsonb)) AS node
            WHERE node->>'id' = edge->>'source'
          )
          AND EXISTS (
            SELECT 1
            FROM jsonb_array_elements(COALESCE(p_flow->'nodes', '[]'::jsonb)) AS node
            WHERE node->>'id' = edge->>'target'
          )
      ),
      '[]'::jsonb
    )
  );
$$;

COMMENT ON FUNCTION public.internal_flow_data_without_orphan_edges(jsonb) IS
  'Drops edges whose source/target are missing from flow nodes. Used so lifecycle classify matches client normalize.';

CREATE OR REPLACE FUNCTION public.assert_flow_edit_allowed(
  p_status text,
  p_old_flow jsonb,
  p_new_flow jsonb
)
RETURNS void
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_change_kind text;
  v_old jsonb := public.internal_flow_data_without_orphan_edges(COALESCE(p_old_flow, '{}'::jsonb));
  v_new jsonb := public.internal_flow_data_without_orphan_edges(COALESCE(p_new_flow, '{}'::jsonb));
BEGIN
  IF p_status = 'stopped' AND v_old IS DISTINCT FROM v_new THEN
    RAISE EXCEPTION 'flow_locked: This campaign has stopped and can''t be edited.';
  END IF;

  v_change_kind := internal_classify_flow_change_kind(v_old, v_new);

  IF p_status = 'running' AND v_change_kind = 'structural' THEN
    RAISE EXCEPTION 'flow_locked: Pause the campaign to add or rearrange steps.';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.assert_flow_edit_allowed(text, jsonb, jsonb) IS
  'Enforces live flow edit policy on orphan-pruned graphs: stopped blocks all changes; running blocks structural changes.';

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
  v_flow jsonb := public.internal_flow_data_without_orphan_edges(COALESCE(p_flow_data, '{}'::jsonb));
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
    AND n.node_type IS DISTINCT FROM 'aiCategorizer'
    AND n.flow_node_id IN (
      SELECT DISTINCT edge->>'source'
      FROM jsonb_array_elements(COALESCE(v_flow->'edges', '[]'::jsonb)) AS edge
      WHERE COALESCE(edge->>'source', '') <> ''
        AND COALESCE(edge->>'target', '') <> ''
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(COALESCE(v_flow->'nodes', '[]'::jsonb)) AS node
          WHERE node->>'id' = edge->>'target'
        )
    );

  GET DIAGNOSTICS v_reactivated_count = ROW_COUNT;
  RETURN v_reactivated_count;
END;
$$;

COMMENT ON FUNCTION public.reactivate_completed_enrollments_on_non_leaves(uuid, jsonb) IS
  'Reactivates completed enrollments on non-categorizer nodes that have a live outgoing edge (target exists in flow nodes). Leaves current_node_id unchanged; does not touch stopped.';

COMMENT ON FUNCTION public.detect_flow_append(jsonb, jsonb) IS
  'LEGACY tip-only append detect (former leaf gaining first outgoing edge). Unused on the write path; enrollment heal uses reactivate_completed_enrollments_on_non_leaves.';

-- Persist client writes with orphan edges already pruned when possible; still prune before heal.
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
  v_flow jsonb := public.internal_flow_data_without_orphan_edges(COALESCE(p_flow_data, '{}'::jsonb));
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

  PERFORM public.assert_flow_edit_allowed(v_status, COALESCE(v_old_flow, '{}'::jsonb), v_flow);

  PERFORM set_config('app.change_source', COALESCE(NULLIF(p_change_source, ''), 'app'), true);

  UPDATE public.campaigns
  SET flow_data = v_flow,
      updated_at = NOW()
  WHERE id = p_campaign_id
    AND deleted_at IS NULL
  RETURNING * INTO v_campaign;

  v_reactivated_count := public.reactivate_completed_enrollments_on_non_leaves(
    p_campaign_id,
    v_flow
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
  v_flow jsonb := public.internal_flow_data_without_orphan_edges(COALESCE(p_flow_data, '{}'::jsonb));
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

  PERFORM public.assert_flow_edit_allowed(v_status, COALESCE(v_old_flow, '{}'::jsonb), v_flow);

  PERFORM set_config('app.change_source', COALESCE(NULLIF(p_change_source, ''), 'app'), true);

  UPDATE public.campaigns
  SET
    flow_data = v_flow,
    updated_at = now()
  WHERE id = p_campaign_id
    AND account_id = p_account_id
    AND deleted_at IS NULL
  RETURNING * INTO v_campaign;

  v_reactivated_count := public.reactivate_completed_enrollments_on_non_leaves(
    p_campaign_id,
    v_flow
  );

  RETURN jsonb_build_object(
    'campaign', to_jsonb(v_campaign),
    'reactivated_count', v_reactivated_count
  );
END;
$$;

COMMENT ON FUNCTION public.update_campaign_flow_data(uuid, jsonb, text) IS
  'Updates campaigns.flow_data (orphan edges pruned) with lifecycle enforcement and non-leaf reactivation. Returns { campaign, reactivated_count }.';
COMMENT ON FUNCTION public.update_campaign_flow_data_as_service(uuid, uuid, jsonb, text) IS
  'Service-role flow write (orphan edges pruned) with lifecycle enforcement and non-leaf reactivation. Returns { campaign, reactivated_count }.';

REVOKE ALL ON FUNCTION public.internal_flow_data_without_orphan_edges(jsonb) FROM PUBLIC;
