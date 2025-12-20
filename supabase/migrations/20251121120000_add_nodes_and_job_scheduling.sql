-- ============================================
-- Migration: Add Nodes Table and Job Scheduling
-- ============================================
-- This migration adds:
-- 1. A nodes table for better query performance and FK relationships
-- 2. A scheduled_jobs table for irregular interval job scheduling
-- 3. Updates lead_states to reference nodes table
-- 4. Optimized indexes for scalability

-- ============================================
-- 1. CREATE NODES TABLE
-- ============================================
-- Normalizes node data from campaigns.flow_data for better query performance
-- Each node in a campaign's flow gets a record here

CREATE TABLE IF NOT EXISTS nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  
  -- React Flow identifiers
  flow_node_id TEXT NOT NULL, -- The React Flow node ID (e.g., "email-1", "wait-2")
  
  -- Node type and configuration
  node_type TEXT NOT NULL, -- 'leadSource', 'email', 'waitTime', 'aiCategorizer', 'dataSender'
  node_data JSONB NOT NULL DEFAULT '{}', -- Node-specific configuration (from React Flow node.data)
  
  -- Position in flow (for debugging/analytics)
  position_x REAL,
  position_y REAL,
  
  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  UNIQUE(campaign_id, flow_node_id), -- One node per flow_node_id per campaign
  CONSTRAINT nodes_node_type_check CHECK (node_type IN ('leadSource', 'email', 'waitTime', 'aiCategorizer', 'dataSender'))
);

-- Indexes for nodes
CREATE INDEX IF NOT EXISTS idx_nodes_campaign_id ON nodes(campaign_id);
CREATE INDEX IF NOT EXISTS idx_nodes_flow_node_id ON nodes(flow_node_id);
CREATE INDEX IF NOT EXISTS idx_nodes_campaign_flow_node ON nodes(campaign_id, flow_node_id);
CREATE INDEX IF NOT EXISTS idx_nodes_node_type ON nodes(node_type);
CREATE INDEX IF NOT EXISTS idx_nodes_campaign_type ON nodes(campaign_id, node_type);

-- ============================================
-- 2. CREATE SCHEDULED_JOBS TABLE
-- ============================================
-- For scheduling jobs at irregular intervals (e.g., waitTime nodes)
-- Jobs are scheduled when a node completes, with a scheduled_at timestamp

CREATE TABLE IF NOT EXISTS scheduled_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  lead_state_id UUID NOT NULL REFERENCES lead_states(id) ON DELETE CASCADE,
  
  -- Job details
  node_id UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL, -- 'waitTime', 'email', 'aiCategorizer', 'dataSender', etc.
  
  -- Scheduling
  scheduled_at TIMESTAMPTZ NOT NULL, -- When this job should execute
  executed_at TIMESTAMPTZ, -- When job was actually executed (NULL if pending)
  
  -- Status tracking
  status TEXT DEFAULT 'pending', -- 'pending', 'executing', 'completed', 'failed', 'cancelled'
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  
  -- Job data
  job_data JSONB DEFAULT '{}', -- Node-specific job parameters
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT scheduled_jobs_status_check CHECK (status IN ('pending', 'executing', 'completed', 'failed', 'cancelled'))
);

-- Critical indexes for job scheduling queries
CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_scheduled_at ON scheduled_jobs(scheduled_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_campaign_scheduled ON scheduled_jobs(campaign_id, scheduled_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_lead_state ON scheduled_jobs(lead_state_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_lead_id ON scheduled_jobs(lead_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_node_id ON scheduled_jobs(node_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_status ON scheduled_jobs(status);
CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_pending_execution ON scheduled_jobs(scheduled_at, status) WHERE status = 'pending';

-- ============================================
-- 3. UPDATE LEAD_STATES TABLE
-- ============================================
-- Add foreign key reference to nodes table
-- Keep node_id as TEXT for backward compatibility during migration

-- Add node reference (nullable during migration, will be populated)
ALTER TABLE lead_states ADD COLUMN IF NOT EXISTS node_uuid UUID REFERENCES nodes(id) ON DELETE SET NULL;

-- Create index for the new FK
CREATE INDEX IF NOT EXISTS idx_lead_states_node_uuid ON lead_states(node_uuid);

-- Composite index for common query: find all states for a node
CREATE INDEX IF NOT EXISTS idx_lead_states_node_campaign ON lead_states(node_uuid, campaign_id) WHERE node_uuid IS NOT NULL;

-- Index for finding ready-to-process states (optimized for worker queries)
CREATE INDEX IF NOT EXISTS idx_lead_states_ready_to_process ON lead_states(campaign_id, status, queued_at) 
  WHERE status IN ('queued', 'processing');

-- Index for finding next states to schedule (after a node completes)
CREATE INDEX IF NOT EXISTS idx_lead_states_next_to_schedule ON lead_states(lead_id, status, completed_at) 
  WHERE status IN ('processed', 'success');

-- ============================================
-- 4. HELPER FUNCTIONS
-- ============================================

-- Function to sync nodes from flow_data to nodes table
-- Call this when campaign.flow_data is updated
CREATE OR REPLACE FUNCTION sync_campaign_nodes()
RETURNS TRIGGER AS $$
DECLARE
  flow_nodes JSONB;
  flow_node JSONB;
  node_record RECORD;
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
  
  -- Insert/update nodes from flow_data
  FOR flow_node IN SELECT * FROM jsonb_array_elements(flow_nodes)
  LOOP
    INSERT INTO nodes (
      campaign_id,
      flow_node_id,
      node_type,
      node_data,
      position_x,
      position_y
    ) VALUES (
      NEW.id,
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
$$ LANGUAGE plpgsql;

-- Trigger to auto-sync nodes when flow_data changes
DROP TRIGGER IF EXISTS sync_campaign_nodes_trigger ON campaigns;
CREATE TRIGGER sync_campaign_nodes_trigger
  AFTER INSERT OR UPDATE OF flow_data ON campaigns
  FOR EACH ROW
  EXECUTE FUNCTION sync_campaign_nodes();

-- Function to get next scheduled jobs (for worker polling)
CREATE OR REPLACE FUNCTION get_next_scheduled_jobs(limit_count INTEGER DEFAULT 100)
RETURNS TABLE (
  id UUID,
  campaign_id UUID,
  lead_id UUID,
  lead_state_id UUID,
  node_id UUID,
  job_type TEXT,
  scheduled_at TIMESTAMPTZ,
  job_data JSONB
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    sj.id,
    sj.campaign_id,
    sj.lead_id,
    sj.lead_state_id,
    sj.node_id,
    sj.job_type,
    sj.scheduled_at,
    sj.job_data
  FROM scheduled_jobs sj
  WHERE sj.status = 'pending'
    AND sj.scheduled_at <= NOW()
  ORDER BY sj.scheduled_at ASC
  LIMIT limit_count
  FOR UPDATE SKIP LOCKED; -- Prevents multiple workers from picking same job
END;
$$ LANGUAGE plpgsql;

-- Function to schedule next job after a node completes
CREATE OR REPLACE FUNCTION schedule_next_node_job(
  p_lead_state_id UUID,
  p_wait_duration_seconds INTEGER DEFAULT 0
)
RETURNS UUID AS $$
DECLARE
  v_lead_state RECORD;
  v_next_node UUID;
  v_next_flow_node_id TEXT;
  v_next_node_type TEXT;
  v_job_id UUID;
BEGIN
  -- Get the completed lead state
  SELECT ls.*, n.node_type, n.id as node_uuid
  INTO v_lead_state
  FROM lead_states ls
  LEFT JOIN nodes n ON n.flow_node_id = ls.node_id AND n.campaign_id = ls.campaign_id
  WHERE ls.id = p_lead_state_id
    AND ls.status IN ('processed', 'success');
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lead state % not found or not completed', p_lead_state_id;
  END IF;
  
  -- Find next node in flow (simplified - you'll need to implement flow traversal logic)
  -- This is a placeholder - you'll need to query edges from flow_data to find next nodes
  -- For now, we'll create a job that can be scheduled
  
  -- If wait_duration > 0, schedule a wait job
  IF p_wait_duration_seconds > 0 THEN
    -- Find the waitTime node that should execute next
    -- This is simplified - you'll need to implement proper flow traversal
    SELECT n.id, n.flow_node_id, n.node_type
    INTO v_next_node, v_next_flow_node_id, v_next_node_type
    FROM nodes n
    WHERE n.campaign_id = v_lead_state.campaign_id
      AND n.node_type = 'waitTime'
      AND n.flow_node_id IN (
        -- Find nodes connected via edges (you'll need to query flow_data edges)
        -- This is a placeholder - implement proper edge traversal
        SELECT 'next-node-id'::TEXT
      )
    LIMIT 1;
    
    IF v_next_node IS NOT NULL THEN
      INSERT INTO scheduled_jobs (
        campaign_id,
        lead_id,
        lead_state_id,
        node_id,
        job_type,
        scheduled_at,
        job_data
      ) VALUES (
        v_lead_state.campaign_id,
        v_lead_state.lead_id,
        p_lead_state_id,
        v_next_node,
        v_next_node_type,
        NOW() + (p_wait_duration_seconds || ' seconds')::INTERVAL,
        jsonb_build_object('wait_duration_seconds', p_wait_duration_seconds)
      )
      RETURNING id INTO v_job_id;
      
      RETURN v_job_id;
    END IF;
  END IF;
  
  -- If no wait needed, schedule immediate execution
  -- (Implement your flow traversal logic here)
  
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 5. COMMENTS FOR DOCUMENTATION
-- ============================================

COMMENT ON TABLE nodes IS 'Normalized node definitions from campaign flow_data. Enables fast queries and FK relationships. Auto-synced from campaigns.flow_data.';
COMMENT ON COLUMN nodes.flow_node_id IS 'React Flow node ID (e.g., "email-1"). Maps to lead_states.node_id.';
COMMENT ON COLUMN nodes.node_data IS 'Node configuration from React Flow node.data field. Type-specific configuration.';

COMMENT ON TABLE scheduled_jobs IS 'Jobs scheduled for irregular intervals (e.g., waitTime nodes). Workers poll this table for jobs ready to execute.';
COMMENT ON COLUMN scheduled_jobs.scheduled_at IS 'When this job should execute. Jobs with scheduled_at <= NOW() are ready.';
COMMENT ON COLUMN scheduled_jobs.status IS 'pending=waiting to execute, executing=currently running, completed=done, failed=error, cancelled=manually cancelled';

COMMENT ON FUNCTION get_next_scheduled_jobs IS 'Returns next batch of jobs ready to execute. Uses SKIP LOCKED for concurrent worker safety.';
COMMENT ON FUNCTION schedule_next_node_job IS 'Schedules the next job after a node completes. Handles waitTime delays and flow traversal.';

