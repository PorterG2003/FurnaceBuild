-- Live flow edit lifecycle: server-side policy enforcement, append detection, completed reactivation.

CREATE OR REPLACE FUNCTION internal_flow_edge_signature(edge jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT concat(
    COALESCE(edge->>'source', ''), '::',
    COALESCE(edge->>'sourceHandle', ''), '::',
    COALESCE(edge->>'target', ''), '::',
    COALESCE(edge->>'targetHandle', '')
  );
$$;

CREATE OR REPLACE FUNCTION internal_flow_email_variant_ids(flow_data jsonb, node_id text)
RETURNS text[]
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    ARRAY(
      SELECT variant->>'id'
      FROM jsonb_array_elements(flow_data->'nodes') AS node,
           LATERAL jsonb_array_elements(
             CASE
               WHEN jsonb_typeof(node->'data'->'variants') = 'array' THEN node->'data'->'variants'
               ELSE '[]'::jsonb
             END
           ) AS variant
      WHERE node->>'id' = node_id
        AND node->>'type' = 'email'
        AND COALESCE(variant->>'id', '') <> ''
    ),
    ARRAY[]::text[]
  );
$$;

CREATE OR REPLACE FUNCTION internal_classify_flow_change_kind(
  p_old_flow jsonb,
  p_new_flow jsonb
)
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_reasons text[] := ARRAY[]::text[];
  v_old_node record;
  v_new_node record;
  v_old_sig text;
  v_new_sig text;
  v_old_ids text[];
  v_new_ids text[];
  v_id text;
  v_old_variant_ids text[];
  v_new_variant_ids text[];
  v_variant_id text;
BEGIN
  v_old_ids := ARRAY(
    SELECT node->>'id'
    FROM jsonb_array_elements(COALESCE(p_old_flow->'nodes', '[]'::jsonb)) AS node
    WHERE COALESCE(node->>'id', '') <> ''
  );
  v_new_ids := ARRAY(
    SELECT node->>'id'
    FROM jsonb_array_elements(COALESCE(p_new_flow->'nodes', '[]'::jsonb)) AS node
    WHERE COALESCE(node->>'id', '') <> ''
  );

  FOREACH v_id IN ARRAY v_old_ids LOOP
    IF NOT v_id = ANY (v_new_ids) THEN
      v_reasons := array_append(v_reasons, 'node_removed');
    END IF;
  END LOOP;

  FOREACH v_id IN ARRAY v_new_ids LOOP
    IF NOT v_id = ANY (v_old_ids) THEN
      v_reasons := array_append(v_reasons, 'node_added');
    END IF;
  END LOOP;

  FOR v_old_node IN
    SELECT node->>'id' AS id, node->>'type' AS node_type
    FROM jsonb_array_elements(COALESCE(p_old_flow->'nodes', '[]'::jsonb)) AS node
  LOOP
    SELECT node->>'type'
    INTO v_new_sig
    FROM jsonb_array_elements(COALESCE(p_new_flow->'nodes', '[]'::jsonb)) AS node
    WHERE node->>'id' = v_old_node.id;

    IF FOUND AND v_new_sig IS DISTINCT FROM v_old_node.node_type THEN
      v_reasons := array_append(v_reasons, 'node_type_changed');
    END IF;
  END LOOP;

  v_old_sig := NULL;
  FOR v_old_sig IN
    SELECT internal_flow_edge_signature(edge)
    FROM jsonb_array_elements(COALESCE(p_old_flow->'edges', '[]'::jsonb)) AS edge
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(p_new_flow->'edges', '[]'::jsonb)) AS edge
      WHERE internal_flow_edge_signature(edge) = v_old_sig
    ) THEN
      v_reasons := array_append(v_reasons, 'edge_removed_or_rewired');
    END IF;
  END LOOP;

  FOR v_new_sig IN
    SELECT internal_flow_edge_signature(edge)
    FROM jsonb_array_elements(COALESCE(p_new_flow->'edges', '[]'::jsonb)) AS edge
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(p_old_flow->'edges', '[]'::jsonb)) AS edge
      WHERE internal_flow_edge_signature(edge) = v_new_sig
    ) THEN
      v_reasons := array_append(v_reasons, 'edge_added_or_rewired');
    END IF;
  END LOOP;

  FOR v_id IN
    SELECT DISTINCT node->>'id'
    FROM jsonb_array_elements(COALESCE(p_old_flow->'nodes', '[]'::jsonb)) AS node
    WHERE node->>'type' = 'email'
  LOOP
    v_old_variant_ids := internal_flow_email_variant_ids(p_old_flow, v_id);
    v_new_variant_ids := internal_flow_email_variant_ids(p_new_flow, v_id);
    FOREACH v_variant_id IN ARRAY v_old_variant_ids LOOP
      IF NOT v_variant_id = ANY (v_new_variant_ids) THEN
        v_reasons := array_append(v_reasons, 'variant_removed_or_replaced');
        EXIT;
      END IF;
    END LOOP;
  END LOOP;

  IF cardinality(v_reasons) > 0 THEN
    IF v_reasons && ARRAY[
      'node_removed',
      'node_added',
      'node_type_changed',
      'edge_removed_or_rewired',
      'edge_added_or_rewired',
      'variant_removed_or_replaced'
    ] THEN
      RETURN 'structural';
    END IF;
    RETURN 'content';
  END IF;

  IF p_old_flow IS DISTINCT FROM p_new_flow THEN
    RETURN 'content';
  END IF;

  RETURN 'none';
END;
$$;

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
BEGIN
  IF p_status = 'stopped' AND p_old_flow IS DISTINCT FROM p_new_flow THEN
    RAISE EXCEPTION 'flow_locked: This campaign has stopped and can''t be edited.';
  END IF;

  v_change_kind := internal_classify_flow_change_kind(p_old_flow, p_new_flow);

  IF p_status = 'running' AND v_change_kind = 'structural' THEN
    RAISE EXCEPTION 'flow_locked: Pause the campaign to add or rearrange steps.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.detect_flow_append(
  p_old_flow jsonb,
  p_new_flow jsonb
)
RETURNS text[]
LANGUAGE sql
STABLE
AS $$
  WITH old_node_ids AS (
    SELECT node->>'id' AS node_id
    FROM jsonb_array_elements(COALESCE(p_old_flow->'nodes', '[]'::jsonb)) AS node
    WHERE COALESCE(node->>'id', '') <> ''
  ),
  old_outgoing AS (
    SELECT edge->>'source' AS source_id, COUNT(*)::int AS edge_count
    FROM jsonb_array_elements(COALESCE(p_old_flow->'edges', '[]'::jsonb)) AS edge
    WHERE COALESCE(edge->>'source', '') <> ''
    GROUP BY edge->>'source'
  ),
  new_outgoing AS (
    SELECT edge->>'source' AS source_id, COUNT(*)::int AS edge_count
    FROM jsonb_array_elements(COALESCE(p_new_flow->'edges', '[]'::jsonb)) AS edge
    WHERE COALESCE(edge->>'source', '') <> ''
    GROUP BY edge->>'source'
  )
  SELECT COALESCE(
    ARRAY(
      SELECT n.source_id
      FROM new_outgoing n
      INNER JOIN old_node_ids old_nodes ON old_nodes.node_id = n.source_id
      LEFT JOIN old_outgoing o ON o.source_id = n.source_id
      WHERE COALESCE(o.edge_count, 0) = 0
        AND n.edge_count > 0
      ORDER BY n.source_id
    ),
    ARRAY[]::text[]
  );
$$;

DROP FUNCTION IF EXISTS public.update_campaign_flow_data(uuid, jsonb, text);

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
  v_append_ids text[];
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

  v_append_ids := public.detect_flow_append(COALESCE(v_old_flow, '{}'::jsonb), p_flow_data);

  IF cardinality(v_append_ids) > 0 THEN
    UPDATE public.enrollments e
    SET
      state = 'active',
      next_run_at = NOW(),
      updated_at = NOW()
    FROM public.nodes n
    WHERE e.campaign_id = p_campaign_id
      AND e.state = 'completed'
      AND e.deleted_at IS NULL
      AND n.campaign_id = p_campaign_id
      AND n.flow_node_id = ANY (v_append_ids)
      AND e.current_node_id = n.id;

    GET DIAGNOSTICS v_reactivated_count = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'campaign', to_jsonb(v_campaign),
    'reactivated_count', v_reactivated_count
  );
END;
$$;

DROP FUNCTION IF EXISTS public.update_campaign_flow_data_as_service(uuid, uuid, jsonb, text);

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
  v_append_ids text[];
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

  v_append_ids := public.detect_flow_append(COALESCE(v_old_flow, '{}'::jsonb), p_flow_data);

  IF cardinality(v_append_ids) > 0 THEN
    UPDATE public.enrollments e
    SET
      state = 'active',
      next_run_at = NOW(),
      updated_at = NOW()
    FROM public.nodes n
    WHERE e.campaign_id = p_campaign_id
      AND e.state = 'completed'
      AND e.deleted_at IS NULL
      AND n.campaign_id = p_campaign_id
      AND n.flow_node_id = ANY (v_append_ids)
      AND e.current_node_id = n.id;

    GET DIAGNOSTICS v_reactivated_count = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'campaign', to_jsonb(v_campaign),
    'reactivated_count', v_reactivated_count
  );
END;
$$;

COMMENT ON FUNCTION public.assert_flow_edit_allowed(text, jsonb, jsonb) IS
  'Enforces live flow edit policy: stopped blocks all changes; running blocks structural changes.';
COMMENT ON FUNCTION public.detect_flow_append(jsonb, jsonb) IS
  'Returns flow_node_id values that gained their first outgoing edge (former leaves extended).';
COMMENT ON FUNCTION public.update_campaign_flow_data(uuid, jsonb, text) IS
  'Updates campaigns.flow_data with lifecycle enforcement and append reactivation. Returns { campaign, reactivated_count }.';
COMMENT ON FUNCTION public.update_campaign_flow_data_as_service(uuid, uuid, jsonb, text) IS
  'Service-role flow write with lifecycle enforcement and append reactivation. Returns { campaign, reactivated_count }.';

REVOKE ALL ON FUNCTION public.internal_flow_edge_signature(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_flow_email_variant_ids(jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_classify_flow_change_kind(jsonb, jsonb) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.assert_flow_edit_allowed(text, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assert_flow_edit_allowed(text, jsonb, jsonb) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.detect_flow_append(jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.detect_flow_append(jsonb, jsonb) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.update_campaign_flow_data(uuid, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_campaign_flow_data(uuid, jsonb, text) TO authenticated;

REVOKE ALL ON FUNCTION public.update_campaign_flow_data_as_service(uuid, uuid, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_campaign_flow_data_as_service(uuid, uuid, jsonb, text) TO service_role;
