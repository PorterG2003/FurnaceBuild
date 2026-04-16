-- One-time: pre–A/B email nodes (no variants array) get a single variant A (canonical legacy UUID).
-- Updates campaigns.flow_data → sync_campaign_nodes refreshes nodes.node_data.
-- Sets message_jobs.variant_id for campaign jobs on those nodes where it was NULL.

DO $$
DECLARE
  v_legacy_id CONSTANT uuid := 'a0000000-0000-4000-8000-000000000001'::uuid;
  v_legacy_text CONSTANT text := 'a0000000-0000-4000-8000-000000000001';
  rec RECORD;
  v_fd jsonb;
  v_nodes jsonb;
  v_new_nodes jsonb;
  v_elem jsonb;
  v_data jsonb;
  v_variant jsonb;
  v_new_data jsonb;
  v_new_elem jsonb;
  v_changed boolean;
  i int;
  v_len int;
  v_mj_updated bigint;
BEGIN
  DROP TABLE IF EXISTS _legacy_var_mig;
  CREATE TEMP TABLE _legacy_var_mig (
    campaign_id uuid NOT NULL,
    flow_node_id text NOT NULL,
    PRIMARY KEY (campaign_id, flow_node_id)
  ) ON COMMIT DROP;

  FOR rec IN
    SELECT id, flow_data
    FROM campaigns
    WHERE flow_data IS NOT NULL
      AND deleted_at IS NULL
  LOOP
    v_fd := rec.flow_data;
    v_nodes := v_fd -> 'nodes';
    IF v_nodes IS NULL OR jsonb_typeof(v_nodes) <> 'array' THEN
      CONTINUE;
    END IF;

    v_new_nodes := '[]'::jsonb;
    v_changed := false;
    v_len := jsonb_array_length(v_nodes);

    FOR i IN 0 .. v_len - 1 LOOP
      v_elem := v_nodes -> i;

      IF (v_elem ->> 'type') IS DISTINCT FROM 'email' THEN
        v_new_nodes := v_new_nodes || jsonb_build_array(v_elem);
        CONTINUE;
      END IF;

      v_data := COALESCE(v_elem -> 'data', '{}'::jsonb);

      IF (v_data ? 'variants')
         AND jsonb_typeof(v_data -> 'variants') = 'array'
         AND jsonb_array_length(COALESCE(v_data -> 'variants', '[]'::jsonb)) > 0
      THEN
        v_new_nodes := v_new_nodes || jsonb_build_array(v_elem);
        CONTINUE;
      END IF;

      v_variant := jsonb_build_object(
        'id', v_legacy_text,
        'label', 'A',
        'subject', COALESCE(v_data ->> 'subject', ''),
        'template', COALESCE(v_data ->> 'template', ''),
        'body_html', v_data -> 'body_html',
        'body_text', v_data -> 'body_text',
        'isActive', to_jsonb(true),
        'order', to_jsonb(0)
      );

      v_new_data := v_data || jsonb_build_object('variants', jsonb_build_array(v_variant));
      v_new_elem := jsonb_set(v_elem, '{data}', v_new_data, true);

      INSERT INTO _legacy_var_mig (campaign_id, flow_node_id)
      VALUES (rec.id, v_elem ->> 'id')
      ON CONFLICT (campaign_id, flow_node_id) DO NOTHING;

      v_new_nodes := v_new_nodes || jsonb_build_array(v_new_elem);
      v_changed := true;
    END LOOP;

    IF v_changed THEN
      UPDATE campaigns
      SET
        flow_data = jsonb_set(v_fd, '{nodes}', v_new_nodes, true),
        updated_at = NOW()
      WHERE id = rec.id;
    END IF;
  END LOOP;

  UPDATE message_jobs mj
  SET variant_id = v_legacy_id
  FROM nodes n
  INNER JOIN _legacy_var_mig t
    ON t.campaign_id = n.campaign_id
   AND t.flow_node_id = n.flow_node_id
  WHERE mj.node_id = n.id
    AND mj.campaign_id = n.campaign_id
    AND (mj.message_type = 'campaign' OR mj.message_type IS NULL)
    AND mj.variant_id IS NULL;

  GET DIAGNOSTICS v_mj_updated = ROW_COUNT;
  RAISE NOTICE 'legacy_variant_migration: message_jobs rows updated = %', v_mj_updated;
END;
$$;
