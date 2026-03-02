-- Fix: campaign_stats and sync_campaign_nodes triggers were not including account_id,
-- causing RLS violations. After add_account_id_to_child_tables, both campaign_stats
-- and nodes have account_id NOT NULL with RLS insert policies that check account_id.
-- Both trigger functions must pass NEW.account_id and use SECURITY DEFINER so they
-- run as the function owner and bypass RLS (correct pattern for system-level triggers).

-- Fix 1: campaign_stats row creation trigger
CREATE OR REPLACE FUNCTION create_campaign_stats_on_campaign_insert()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO campaign_stats (campaign_id, account_id, sent_count, replied_count, positive_reply_count, bounce_count, updated_at)
  VALUES (NEW.id, NEW.account_id, 0, 0, 0, 0, NOW())
  ON CONFLICT (campaign_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Fix 2: sync_campaign_nodes trigger (fires on campaigns UPDATE OF flow_data)
CREATE OR REPLACE FUNCTION sync_campaign_nodes()
RETURNS TRIGGER AS $$
DECLARE
  flow_nodes JSONB;
  flow_node JSONB;
BEGIN
  -- Only process if flow_data exists and changed
  IF NEW.flow_data IS NULL OR (OLD.flow_data IS NOT DISTINCT FROM NEW.flow_data) THEN
    RETURN NEW;
  END IF;

  -- Extract nodes array from flow_data
  flow_nodes := NEW.flow_data->'nodes';

  IF flow_nodes IS NULL OR jsonb_typeof(flow_nodes) != 'array' THEN
    RETURN NEW;
  END IF;

  -- Delete existing nodes for this campaign
  DELETE FROM nodes WHERE campaign_id = NEW.id;

  -- Insert nodes from flow_data, including account_id for RLS
  FOR flow_node IN SELECT * FROM jsonb_array_elements(flow_nodes)
  LOOP
    INSERT INTO nodes (
      campaign_id,
      account_id,
      flow_node_id,
      node_type,
      node_data,
      position_x,
      position_y
    ) VALUES (
      NEW.id,
      NEW.account_id,
      flow_node->>'id',
      flow_node->>'type',
      COALESCE(flow_node->'data', '{}'::jsonb),
      (flow_node->'position'->>'x')::REAL,
      (flow_node->'position'->>'y')::REAL
    )
    ON CONFLICT (campaign_id, flow_node_id)
    DO UPDATE SET
      node_type = EXCLUDED.node_type,
      node_data = EXCLUDED.node_data,
      position_x = EXCLUDED.position_x,
      position_y = EXCLUDED.position_y,
      updated_at = NOW();
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
