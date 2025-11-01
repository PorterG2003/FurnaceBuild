-- Create campaigns table
-- This table stores campaign information with ownership support

CREATE TABLE IF NOT EXISTS campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  owner_id TEXT NOT NULL, -- Amplify Cognito user ID
  organization_id TEXT, -- Future: organization/team ownership (nullable for now)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_campaigns_owner_id ON campaigns(owner_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_organization_id ON campaigns(organization_id);

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_campaigns_updated_at
  BEFORE UPDATE ON campaigns
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Optional: Add Row Level Security (RLS) policies
-- For now, we'll handle authorization at the application level
-- Uncomment these if you want database-level RLS:

-- ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;

-- -- Policy: Users can view their own campaigns
-- CREATE POLICY "Users can view own campaigns"
--   ON campaigns FOR SELECT
--   USING (auth.uid()::text = owner_id);

-- -- Policy: Users can insert their own campaigns
-- CREATE POLICY "Users can insert own campaigns"
--   ON campaigns FOR INSERT
--   WITH CHECK (auth.uid()::text = owner_id);

-- -- Policy: Users can update their own campaigns
-- CREATE POLICY "Users can update own campaigns"
--   ON campaigns FOR UPDATE
--   USING (auth.uid()::text = owner_id);

-- -- Policy: Users can delete their own campaigns
-- CREATE POLICY "Users can delete own campaigns"
--   ON campaigns FOR DELETE
--   USING (auth.uid()::text = owner_id);


