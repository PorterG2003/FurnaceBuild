-- ============================================
-- Migration: Phase 1 - Cleanup and New Schema
-- ============================================
-- This migration:
-- 1. Drops old tables (lead_states, scheduled_jobs)
-- 2. Creates new schema (enrollments, message_jobs, events, mailbox_throttles)
-- 3. Enhances existing tables (mailboxes, campaigns)
-- 
-- Note: Since app is not in production, we delete old tables rather than migrate data

-- ============================================
-- 1. CLEANUP: Drop old tables and functions
-- ============================================

-- Drop scheduled_jobs table (replaced by enrollments.next_run_at + message_jobs)
DROP TABLE IF EXISTS scheduled_jobs CASCADE;

-- Drop functions that reference lead_states
DROP FUNCTION IF EXISTS enforce_lead_state_transition() CASCADE;
DROP FUNCTION IF EXISTS schedule_next_node_job(UUID, INTEGER) CASCADE;
DROP FUNCTION IF EXISTS get_next_scheduled_jobs(INTEGER) CASCADE;

-- Drop trigger on lead_states (will be dropped with table)
-- (Already handled by CASCADE, but explicit for clarity)
DROP TRIGGER IF EXISTS enforce_lead_state_transition_trigger ON lead_states;
DROP TRIGGER IF EXISTS update_lead_states_updated_at ON lead_states;

-- Drop lead_states table (replaced by enrollments)
DROP TABLE IF EXISTS lead_states CASCADE;

-- Note: scheduled_jobs table also references lead_states, but we drop it first above
-- Any indexes on lead_states will be dropped automatically with the table

-- ============================================
-- 2. CREATE ENROLLMENTS TABLE
-- ============================================
-- Replaces lead_states - tracks prospect-in-flow state
-- One record per lead per campaign (simpler than one per node per lead)

CREATE TABLE IF NOT EXISTS enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  
  -- Current position in flow
  current_node_id UUID REFERENCES nodes(id) ON DELETE SET NULL,
  
  -- State tracking
  state TEXT NOT NULL DEFAULT 'active',
  -- 'active' = enrollment is active and should be processed
  -- 'paused' = manually paused
  -- 'stopped' = stopped (e.g., replied, bounced, unsubscribed)
  -- 'completed' = flow completed
  
  -- Scheduling
  next_run_at TIMESTAMPTZ, -- When scheduler should evaluate this enrollment next
  
  -- Flow position snapshot (for debugging/analytics)
  flow_position JSONB, -- JSONB snapshot of current position in graph
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  UNIQUE(campaign_id, lead_id), -- One enrollment per lead per campaign
  CONSTRAINT enrollments_state_check CHECK (state IN ('active', 'paused', 'stopped', 'completed'))
);

-- Indexes for enrollments
CREATE INDEX IF NOT EXISTS idx_enrollments_campaign_id ON enrollments(campaign_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_lead_id ON enrollments(lead_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_current_node_id ON enrollments(current_node_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_state ON enrollments(state);
-- Critical index for scheduler queries
CREATE INDEX IF NOT EXISTS idx_enrollments_next_run_at_state ON enrollments(next_run_at, state) 
  WHERE state = 'active';
CREATE INDEX IF NOT EXISTS idx_enrollments_campaign_state ON enrollments(campaign_id, state);

-- Trigger for updated_at
CREATE TRIGGER update_enrollments_updated_at
  BEFORE UPDATE ON enrollments
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Comments
COMMENT ON TABLE enrollments IS 'Tracks prospect-in-flow state. One enrollment per lead per campaign. Replaces lead_states.';
COMMENT ON COLUMN enrollments.current_node_id IS 'FK to nodes.id - the current node the lead is at in the flow';
COMMENT ON COLUMN enrollments.state IS 'Enrollment state: active=should be processed, paused=manually paused, stopped=stopped (replied/bounced), completed=flow finished';
COMMENT ON COLUMN enrollments.next_run_at IS 'When scheduler should evaluate this enrollment next. Used by scheduler to find enrollments ready to process.';
COMMENT ON COLUMN enrollments.flow_position IS 'JSONB snapshot of current position in flow graph (for debugging/analytics)';

-- ============================================
-- 3. CREATE MESSAGE_JOBS TABLE
-- ============================================
-- Concrete send actions created by scheduler
-- Represents a specific email that needs to be sent

CREATE TABLE IF NOT EXISTS message_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id UUID NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  mailbox_id UUID NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
  node_id UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE, -- The email node
  
  -- Status tracking
  status TEXT NOT NULL DEFAULT 'pending',
  -- 'pending' = created, waiting to be sent
  -- 'reserved' = reserved by worker (throttle checks passed)
  -- 'sending' = currently sending (optional, can skip to 'sent')
  -- 'sent' = successfully sent
  -- 'failed' = failed to send
  -- 'cancelled' = manually cancelled
  
  -- Scheduling timestamps
  scheduled_at TIMESTAMPTZ NOT NULL, -- When email should be sent (respects campaign schedule, jitter, etc.)
  reserved_at TIMESTAMPTZ, -- When job was reserved by worker (throttle check passed)
  sent_at TIMESTAMPTZ, -- When email was actually sent
  
  -- Message tracking
  provider_message_id TEXT, -- SMTP Message-ID header (for reply detection)
  sqs_message_id TEXT, -- SQS message ID (for tracking in queue)
  
  -- Error handling
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  
  -- Message content
  message_data JSONB NOT NULL DEFAULT '{}', -- Subject, body, template variables, etc.
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT message_jobs_status_check CHECK (status IN ('pending', 'reserved', 'sending', 'sent', 'failed', 'cancelled'))
);

-- Indexes for message_jobs
CREATE INDEX IF NOT EXISTS idx_message_jobs_enrollment_id ON message_jobs(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_message_jobs_campaign_id ON message_jobs(campaign_id);
CREATE INDEX IF NOT EXISTS idx_message_jobs_lead_id ON message_jobs(lead_id);
CREATE INDEX IF NOT EXISTS idx_message_jobs_mailbox_id ON message_jobs(mailbox_id);
CREATE INDEX IF NOT EXISTS idx_message_jobs_node_id ON message_jobs(node_id);
CREATE INDEX IF NOT EXISTS idx_message_jobs_status ON message_jobs(status);
-- Critical index for send workers to find pending jobs
CREATE INDEX IF NOT EXISTS idx_message_jobs_status_scheduled_at ON message_jobs(status, scheduled_at) 
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_message_jobs_provider_message_id ON message_jobs(provider_message_id) 
  WHERE provider_message_id IS NOT NULL; -- For reply detection

-- Trigger for updated_at
CREATE TRIGGER update_message_jobs_updated_at
  BEFORE UPDATE ON message_jobs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Comments
COMMENT ON TABLE message_jobs IS 'Concrete send actions created by scheduler. Represents a specific email that needs to be sent.';
COMMENT ON COLUMN message_jobs.enrollment_id IS 'FK to enrollments - the enrollment this job belongs to';
COMMENT ON COLUMN message_jobs.provider_message_id IS 'SMTP Message-ID header - used for reply detection (In-Reply-To matching)';
COMMENT ON COLUMN message_jobs.sqs_message_id IS 'SQS message ID - for tracking job in send_queue';
COMMENT ON COLUMN message_jobs.message_data IS 'JSONB with message content: subject, body, template variables, etc.';

-- ============================================
-- 4. ENHANCE MAILBOXES TABLE
-- ============================================
-- Add SMTP connection management and provider fields

-- Add SMTP connection management columns
ALTER TABLE mailboxes ADD COLUMN IF NOT EXISTS smtp_connection_limit INTEGER DEFAULT 5;
ALTER TABLE mailboxes ADD COLUMN IF NOT EXISTS smtp_messages_per_connection INTEGER DEFAULT 100;
ALTER TABLE mailboxes ADD COLUMN IF NOT EXISTS smtp_last_connected_at TIMESTAMPTZ;
ALTER TABLE mailboxes ADD COLUMN IF NOT EXISTS smtp_error_count INTEGER DEFAULT 0;
ALTER TABLE mailboxes ADD COLUMN IF NOT EXISTS smtp_status TEXT DEFAULT 'active';
ALTER TABLE mailboxes ADD CONSTRAINT mailboxes_smtp_status_check 
  CHECK (smtp_status IN ('active', 'throttled', 'error', 'disabled'));

-- Add provider field (flexible, no enum constraint)
ALTER TABLE mailboxes ADD COLUMN IF NOT EXISTS provider TEXT;

-- Indexes for mailboxes
CREATE INDEX IF NOT EXISTS idx_mailboxes_smtp_status ON mailboxes(smtp_status);

-- Comments
COMMENT ON COLUMN mailboxes.smtp_connection_limit IS 'Max concurrent SMTP connections per mailbox (default: 5)';
COMMENT ON COLUMN mailboxes.smtp_messages_per_connection IS 'Max messages per connection before reconnect (default: 100)';
COMMENT ON COLUMN mailboxes.smtp_last_connected_at IS 'Last successful SMTP connection time (for health tracking)';
COMMENT ON COLUMN mailboxes.smtp_error_count IS 'Consecutive SMTP failures (reset on success)';
COMMENT ON COLUMN mailboxes.smtp_status IS 'SMTP status: active=normal, throttled=rate limited, error=connection issues, disabled=manually disabled';
COMMENT ON COLUMN mailboxes.provider IS 'Provider name (flexible, e.g., gmail, google_workspace, provider_name, etc.)';

-- ============================================
-- 5. CREATE EVENTS TABLE
-- ============================================
-- Track all events (sent, replied, bounced, opened, clicked, etc.)

CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  enrollment_id UUID REFERENCES enrollments(id) ON DELETE SET NULL,
  message_job_id UUID REFERENCES message_jobs(id) ON DELETE SET NULL,
  
  -- Event type and data
  event_type TEXT NOT NULL,
  -- 'sent' = email was sent
  -- 'delivered' = email was delivered (if tracking available)
  -- 'opened' = email was opened
  -- 'clicked' = link was clicked
  -- 'replied' = recipient replied
  -- 'bounced' = email bounced
  -- 'unsubscribed' = recipient unsubscribed
  
  event_data JSONB DEFAULT '{}', -- Metadata, timestamps, provider data, etc.
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT events_event_type_check CHECK (
    event_type IN ('sent', 'delivered', 'opened', 'clicked', 'replied', 'bounced', 'unsubscribed')
  )
);

-- Indexes for events
CREATE INDEX IF NOT EXISTS idx_events_campaign_id ON events(campaign_id);
CREATE INDEX IF NOT EXISTS idx_events_lead_id ON events(lead_id);
CREATE INDEX IF NOT EXISTS idx_events_enrollment_id ON events(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_events_message_job_id ON events(message_job_id);
CREATE INDEX IF NOT EXISTS idx_events_event_type ON events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);
-- Composite indexes for common queries
CREATE INDEX IF NOT EXISTS idx_events_campaign_type_created ON events(campaign_id, event_type, created_at);
CREATE INDEX IF NOT EXISTS idx_events_enrollment_type ON events(enrollment_id, event_type) 
  WHERE enrollment_id IS NOT NULL;

-- Comments
COMMENT ON TABLE events IS 'Tracks all events: sent, delivered, opened, clicked, replied, bounced, unsubscribed';
COMMENT ON COLUMN events.event_data IS 'JSONB with event metadata: timestamps, provider data, etc.';

-- ============================================
-- 6. CREATE MAILBOX_THROTTLES TABLE
-- ============================================
-- Track per-mailbox rate limits and caps

CREATE TABLE IF NOT EXISTS mailbox_throttles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mailbox_id UUID NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
  date DATE NOT NULL, -- Date for daily counting (UTC date)
  
  -- Counters
  sent_count INTEGER DEFAULT 0, -- Emails sent today
  hourly_sent JSONB DEFAULT '{}', -- Hourly counts: {"0": 5, "1": 10, ...} (hour as string key, count as value)
  last_sent_at TIMESTAMPTZ, -- Last send timestamp (for min-gap enforcement)
  
  -- Limits
  daily_limit INTEGER DEFAULT 50, -- Daily limit (conservative default for Gmail)
  hourly_limit INTEGER DEFAULT 10, -- Hourly limit (conservative default for Gmail)
  min_gap_seconds INTEGER DEFAULT 180, -- Minimum seconds between sends (default: 3 minutes)
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  UNIQUE(mailbox_id, date) -- One throttle record per mailbox per day
);

-- Indexes for mailbox_throttles
CREATE INDEX IF NOT EXISTS idx_mailbox_throttles_mailbox_date ON mailbox_throttles(mailbox_id, date);
CREATE INDEX IF NOT EXISTS idx_mailbox_throttles_date ON mailbox_throttles(date);

-- Trigger for updated_at
CREATE TRIGGER update_mailbox_throttles_updated_at
  BEFORE UPDATE ON mailbox_throttles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Comments
COMMENT ON TABLE mailbox_throttles IS 'Tracks per-mailbox rate limits and caps. One record per mailbox per day.';
COMMENT ON COLUMN mailbox_throttles.hourly_sent IS 'JSONB tracking hourly counts: {"0": 5, "1": 10, ...} (hour 0-23 as string key)';
COMMENT ON COLUMN mailbox_throttles.daily_limit IS 'Daily email limit for this mailbox (default: 50, conservative for Gmail)';
COMMENT ON COLUMN mailbox_throttles.hourly_limit IS 'Hourly email limit for this mailbox (default: 10, conservative for Gmail)';
COMMENT ON COLUMN mailbox_throttles.min_gap_seconds IS 'Minimum seconds between sends from this mailbox (default: 180s = 3 minutes)';

-- ============================================
-- 7. ADD CAMPAIGN SCHEDULE
-- ============================================
-- Define when campaigns are active (when emails can be sent)

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS schedule JSONB;
-- Structure: {timezone: string, start_hour: number, end_hour: number, days_of_week: number[] | null}
-- Default: null (campaign runs 24/7, no restrictions)
-- Example: {timezone: "America/New_York", start_hour: 9, end_hour: 17, days_of_week: [1,2,3,4,5]}

-- Set existing campaigns to null (24/7, no restrictions)
UPDATE campaigns SET schedule = NULL WHERE schedule IS NULL;

-- Comments
COMMENT ON COLUMN campaigns.schedule IS 'Campaign schedule JSONB: {timezone, start_hour, end_hour, days_of_week}. null = 24/7, no restrictions';

