-- Migrate campaigns.owner_id from Cognito TEXT to Supabase user UUID
-- 1. Add new column
ALTER TABLE campaigns ADD COLUMN owner_user_id UUID REFERENCES users(id);

-- 2. Backfill: match by Supabase user id (owner_id stored as UUID string) or legacy Cognito external_id
UPDATE campaigns c
SET owner_user_id = u.id
FROM users u
WHERE (u.id::text = c.owner_id OR u.external_id = c.owner_id)
  AND c.owner_user_id IS NULL;

-- 3. Only complete migration if every row was backfilled (no orphaned campaigns)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM campaigns WHERE owner_user_id IS NULL) THEN
    ALTER TABLE campaigns ALTER COLUMN owner_user_id SET NOT NULL;
    ALTER TABLE campaigns DROP COLUMN owner_id;
    ALTER TABLE campaigns RENAME COLUMN owner_user_id TO owner_id;
    CREATE INDEX IF NOT EXISTS idx_campaigns_owner_id ON campaigns(owner_id);
  END IF;
END $$;
