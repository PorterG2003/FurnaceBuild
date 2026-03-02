-- Fix: campaigns.account_id was added in Dec 2025 without NOT NULL or a backfill,
-- leaving existing campaigns with account_id = NULL. When sync_campaign_nodes fires
-- and tries INSERT INTO nodes (..., account_id = NEW.account_id = NULL), the RLS
-- WITH CHECK evaluates NULL IN (...) → FALSE → "row-level security policy" violation.
--
-- Additionally, both trigger functions were missing SET search_path = public, which
-- Supabase Cloud requires for SECURITY DEFINER to correctly bypass RLS.

-- ---------------------------------------------------------------------------
-- 1. Backfill campaigns.account_id from owner → users → account_users
-- ---------------------------------------------------------------------------
-- Try is_owner account first (most likely the right one); fall back to any account.
UPDATE campaigns c
SET account_id = sub.account_id
FROM (
  SELECT DISTINCT ON (c2.id)
    c2.id AS campaign_id,
    au.account_id
  FROM campaigns c2
  JOIN users u
    ON u.id::text = c2.owner_id::text
  JOIN account_users au ON au.user_id = u.id
  WHERE c2.account_id IS NULL
  ORDER BY c2.id, au.is_owner DESC, au.created_at ASC
) sub
WHERE c.id = sub.campaign_id;

-- Also try via external_id (Cognito legacy campaigns whose owner_id was a Cognito sub)
UPDATE campaigns c
SET account_id = sub.account_id
FROM (
  SELECT DISTINCT ON (c2.id)
    c2.id AS campaign_id,
    au.account_id
  FROM campaigns c2
  JOIN users u ON u.external_id = c2.owner_id::text
  JOIN account_users au ON au.user_id = u.id
  WHERE c2.account_id IS NULL
  ORDER BY c2.id, au.is_owner DESC, au.created_at ASC
) sub
WHERE c.id = sub.campaign_id;

-- Make NOT NULL if every row is now backfilled (safe guard)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM campaigns WHERE account_id IS NULL) THEN
    ALTER TABLE campaigns ALTER COLUMN account_id SET NOT NULL;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Fix create_campaign_stats_on_campaign_insert
--    Add SET search_path = public (required by Supabase Cloud for SECURITY DEFINER)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_campaign_stats_on_campaign_insert()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.account_id IS NULL THEN
    RETURN NEW;
  END IF;
  INSERT INTO campaign_stats (campaign_id, account_id, sent_count, replied_count, positive_reply_count, bounce_count, updated_at)
  VALUES (NEW.id, NEW.account_id, 0, 0, 0, 0, NOW())
  ON CONFLICT (campaign_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ---------------------------------------------------------------------------
-- 3. Fix sync_campaign_nodes
--    Add SET search_path = public + NULL guard on account_id
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sync_campaign_nodes()
RETURNS TRIGGER AS $$
DECLARE
  flow_nodes JSONB;
  flow_node JSONB;
BEGIN
  -- Skip if account_id is not yet set (campaign not fully initialized)
  IF NEW.account_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Only process if flow_data exists and changed
  IF NEW.flow_data IS NULL OR (OLD.flow_data IS NOT DISTINCT FROM NEW.flow_data) THEN
    RETURN NEW;
  END IF;

  flow_nodes := NEW.flow_data->'nodes';

  IF flow_nodes IS NULL OR jsonb_typeof(flow_nodes) != 'array' THEN
    RETURN NEW;
  END IF;

  DELETE FROM nodes WHERE campaign_id = NEW.id;

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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
