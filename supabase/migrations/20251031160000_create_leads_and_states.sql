-- ============================================
-- Migration: Create Leads and Lead States
-- ============================================
-- This migration adds lead tracking and state management
-- for campaigns with flow-based processing

-- ============================================
-- 1. EXTEND CAMPAIGNS TABLE
-- ============================================

-- Add new columns to existing campaigns table (must be done separately)
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS locked BOOLEAN DEFAULT false;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS flow_data JSONB; -- { nodes: [...], edges: [...] }
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS bucket_id UUID DEFAULT gen_random_uuid(); -- Unique bucket ID for Lead Bucket node
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'draft'; -- 'draft', 'running', 'paused', 'stopped'

-- Add constraint for status enum
ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS campaigns_status_check;
ALTER TABLE campaigns ADD CONSTRAINT campaigns_status_check 
  CHECK (status IN ('draft', 'running', 'paused', 'stopped'));

-- Indexes for flow operations
CREATE INDEX IF NOT EXISTS idx_campaigns_locked ON campaigns(locked);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);
CREATE INDEX IF NOT EXISTS idx_campaigns_bucket_id ON campaigns(bucket_id);

-- ============================================
-- 2. LEADS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  bucket_id UUID NOT NULL, -- References campaign.bucket_id (from Lead Bucket node)
  
  -- Lead identity
  email TEXT,
  name TEXT,
  phone TEXT,
  source TEXT,
  custom_lead_data JSONB, -- Flexible campaign-specific metadata
  
  -- Global tracking (for cross-campaign analytics)
  global_lead_id TEXT, -- SHA-256 hash of email (lowercase, trimmed)
  
  -- Overall lead status
  status TEXT DEFAULT 'new', -- 'new', 'processing', 'completed', 'failed', 'paused', 'removed'
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT leads_status_check CHECK (status IN ('new', 'processing', 'completed', 'failed', 'paused', 'removed'))
);

-- Indexes for leads
CREATE INDEX IF NOT EXISTS idx_leads_campaign_id ON leads(campaign_id);
CREATE INDEX IF NOT EXISTS idx_leads_bucket_id ON leads(campaign_id, bucket_id);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email);
CREATE INDEX IF NOT EXISTS idx_leads_global_lead_id ON leads(global_lead_id);
CREATE INDEX IF NOT EXISTS idx_leads_campaign_status ON leads(campaign_id, status);

-- ============================================
-- 3. LEAD_STATES TABLE
-- ============================================
-- One record per node per lead (created when lead is created)
-- States track the progression through the flow

CREATE TABLE IF NOT EXISTS lead_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  
  -- Node reference
  node_id TEXT NOT NULL, -- React Flow node ID
  node_type TEXT NOT NULL, -- 'leadSource', 'email', 'waitTime', 'aiCategorizer', 'dataSender'
  
  -- State tracking
  status TEXT DEFAULT 'schrodinger', -- 'schrodinger', 'queued', 'processing', 'processed', 'failed', 'success', 'trimmed'
  -- Note: 
  -- 'schrodinger' = not reached yet (especially for branch nodes)
  -- 'queued' = ready to be processed
  -- 'processing' = currently being processed
  -- 'processed' = completed successfully
  -- 'failed' = error occurred
  -- 'success' = completed with success flag (for nodes that have success/failure states)
  -- 'trimmed' = branch will never be taken (explicitly marked to skip)
  
  -- Branch tracking (for branching nodes like AI Categorizer)
  -- When a lead branches, child states are created for each branch path
  -- We determine which branches were taken by checking child states' statuses
  parent_state_id UUID REFERENCES lead_states(id), -- Parent state if this is from a branch (e.g., AI Categorizer node)
  -- Note: To determine which branches were taken, query child states where parent_state_id = this state's id
  -- and check their statuses (non-schrodinger = branch was taken)
  
  -- Node execution data
  execution_data JSONB, -- Node-specific results (e.g., AI categorization result, email sent confirmation)
  error_message TEXT, -- Error details if status = 'failed'
  
  -- Timestamps
  entered_at TIMESTAMPTZ, -- When lead reached this node (status changed from 'schrodinger')
  queued_at TIMESTAMPTZ, -- When status changed to 'queued'
  processing_at TIMESTAMPTZ, -- When status changed to 'processing'
  completed_at TIMESTAMPTZ, -- When status changed to 'processed'/'failed'/'success'
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  UNIQUE(lead_id, node_id), -- One state per node per lead
  CONSTRAINT lead_states_status_check CHECK (status IN ('schrodinger', 'queued', 'processing', 'processed', 'failed', 'success', 'trimmed'))
);

-- Indexes for lead_states
CREATE INDEX IF NOT EXISTS idx_lead_states_lead_id ON lead_states(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_states_campaign_id ON lead_states(campaign_id);
CREATE INDEX IF NOT EXISTS idx_lead_states_node_id ON lead_states(node_id);
CREATE INDEX IF NOT EXISTS idx_lead_states_status ON lead_states(status);
CREATE INDEX IF NOT EXISTS idx_lead_states_parent_state_id ON lead_states(parent_state_id);
CREATE INDEX IF NOT EXISTS idx_lead_states_queued ON lead_states(campaign_id, status) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS idx_lead_states_processing ON lead_states(campaign_id, status) WHERE status = 'processing';
CREATE INDEX IF NOT EXISTS idx_lead_states_node_lead ON lead_states(node_id, lead_id);

-- ============================================
-- 4. TRIGGERS
-- ============================================

-- Update updated_at on leads
CREATE TRIGGER update_leads_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Update updated_at on lead_states
CREATE TRIGGER update_lead_states_updated_at
  BEFORE UPDATE ON lead_states
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Trigger to enforce status transitions and update timestamps
CREATE OR REPLACE FUNCTION enforce_lead_state_transition()
RETURNS TRIGGER AS $$
BEGIN
  -- Validate status transitions
  -- Valid transitions:
  -- schrodinger -> queued -> processing -> (processed | failed | success)
  -- schrodinger -> processing (direct, if immediate)
  -- schrodinger -> trimmed (mark branch as never to be taken)
  -- Any -> failed (error can occur at any time)
  -- trimmed is terminal (cannot transition out of it)
  
  IF OLD.status != NEW.status THEN
    -- Check if transition is valid
    IF OLD.status = 'schrodinger' AND NEW.status NOT IN ('queued', 'processing', 'trimmed') THEN
      RAISE EXCEPTION 'Invalid transition from schrodinger to %', NEW.status;
    ELSIF OLD.status = 'queued' AND NEW.status NOT IN ('processing', 'failed') THEN
      RAISE EXCEPTION 'Invalid transition from queued to %', NEW.status;
    ELSIF OLD.status = 'processing' AND NEW.status NOT IN ('processed', 'failed', 'success') THEN
      RAISE EXCEPTION 'Invalid transition from processing to %', NEW.status;
    ELSIF OLD.status IN ('processed', 'success') AND NEW.status != 'failed' THEN
      RAISE EXCEPTION 'Cannot transition from % to %', OLD.status, NEW.status;
    ELSIF OLD.status = 'failed' AND NEW.status != 'failed' THEN
      RAISE EXCEPTION 'Cannot transition from failed to %', NEW.status;
    ELSIF OLD.status = 'trimmed' AND NEW.status != 'trimmed' THEN
      RAISE EXCEPTION 'Cannot transition from trimmed to %', NEW.status;
    END IF;
    
    -- Update timestamps based on status changes
    CASE NEW.status
      WHEN 'queued' THEN
        NEW.queued_at = COALESCE(NEW.queued_at, NOW());
        NEW.entered_at = COALESCE(NEW.entered_at, NOW());
      WHEN 'processing' THEN
        NEW.processing_at = COALESCE(NEW.processing_at, NOW());
        NEW.entered_at = COALESCE(NEW.entered_at, NOW());
        -- If coming from schrodinger directly, set queued_at too
        IF OLD.status = 'schrodinger' THEN
          NEW.queued_at = NOW();
        END IF;
      WHEN 'processed' THEN
        NEW.completed_at = COALESCE(NEW.completed_at, NOW());
      WHEN 'failed' THEN
        NEW.completed_at = COALESCE(NEW.completed_at, NOW());
      WHEN 'success' THEN
        NEW.completed_at = COALESCE(NEW.completed_at, NOW());
      WHEN 'trimmed' THEN
        NEW.completed_at = COALESCE(NEW.completed_at, NOW());
        -- Mark as entered when trimmed (for tracking)
        NEW.entered_at = COALESCE(NEW.entered_at, NOW());
    END CASE;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER enforce_lead_state_transition_trigger
  BEFORE UPDATE ON lead_states
  FOR EACH ROW
  EXECUTE FUNCTION enforce_lead_state_transition();

-- ============================================
-- 5. HELPER FUNCTIONS
-- ============================================

-- Function to generate global_lead_id from email
CREATE OR REPLACE FUNCTION generate_global_lead_id(email_address TEXT)
RETURNS TEXT AS $$
BEGIN
  -- Hash email (lowercase, trimmed) for consistent global ID
  IF email_address IS NULL OR trim(email_address) = '' THEN
    RETURN NULL;
  END IF;
  RETURN encode(digest(lower(trim(email_address)), 'sha256'), 'hex');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================
-- 6. COMMENTS FOR DOCUMENTATION
-- ============================================

COMMENT ON TABLE leads IS 'Stores leads belonging to campaigns. Each lead is campaign-specific even if same person across campaigns.';
COMMENT ON COLUMN leads.bucket_id IS 'References the bucket_id from the campaign''s Lead Bucket node';
COMMENT ON COLUMN leads.global_lead_id IS 'SHA-256 hash of email for cross-campaign analytics and deduplication';
COMMENT ON COLUMN leads.status IS 'Overall lead status: new=just created, processing=in flow, completed=finished flow, failed=error, paused=manually paused, removed=soft deleted';

COMMENT ON TABLE lead_states IS 'One record per node per lead. Tracks the state of each lead at each node in the flow. For branching nodes, child states are created for each branch path.';
COMMENT ON COLUMN lead_states.status IS 'Node state: schrodinger=not reached yet (especially branch nodes), queued=ready to process, processing=currently executing, processed=completed, failed=error, success=completed with success flag, trimmed=branch will never be taken (explicitly marked to skip)';
COMMENT ON COLUMN lead_states.parent_state_id IS 'For branching: points to the state that created this branch (e.g., AI Categorizer node). NULL for non-branch paths. To determine which branches were taken, query child states where parent_state_id = branching node state id and check their statuses (non-schrodinger and non-trimmed = branch was taken).';

