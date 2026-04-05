-- 20260408130000 rewrote sync_campaign_nodes for soft-deleted nodes but dropped
-- SECURITY DEFINER and account_id on INSERT. The trigger then ran as the caller and
-- violated nodes RLS (WITH CHECK on account_id), surfacing as 403 on campaigns PATCH.

CREATE OR REPLACE FUNCTION sync_campaign_nodes()
RETURNS TRIGGER AS $$
DECLARE
  flow_nodes JSONB;
  flow_node JSONB;
BEGIN
  IF NEW.account_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.flow_data IS NOT DISTINCT FROM NEW.flow_data THEN
    RETURN NEW;
  END IF;

  flow_nodes := COALESCE(NEW.flow_data->'nodes', '[]'::jsonb);

  IF jsonb_typeof(flow_nodes) <> 'array' THEN
    RETURN NEW;
  END IF;

  FOR flow_node IN SELECT * FROM jsonb_array_elements(flow_nodes)
  LOOP
    INSERT INTO nodes (
      campaign_id,
      account_id,
      flow_node_id,
      node_type,
      node_data,
      position_x,
      position_y,
      deleted_at
    ) VALUES (
      NEW.id,
      NEW.account_id,
      flow_node->>'id',
      flow_node->>'type',
      COALESCE(flow_node->'data', '{}'::jsonb),
      (flow_node->'position'->>'x')::REAL,
      (flow_node->'position'->>'y')::REAL,
      NULL
    )
    ON CONFLICT (campaign_id, flow_node_id)
    DO UPDATE SET
      account_id = EXCLUDED.account_id,
      node_type = EXCLUDED.node_type,
      node_data = EXCLUDED.node_data,
      position_x = EXCLUDED.position_x,
      position_y = EXCLUDED.position_y,
      deleted_at = NULL,
      updated_at = NOW();
  END LOOP;

  UPDATE nodes
  SET deleted_at = NOW(),
      updated_at = NOW()
  WHERE nodes.campaign_id = NEW.id
    AND nodes.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(flow_nodes) AS active_node
      WHERE active_node->>'id' = nodes.flow_node_id
    );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
