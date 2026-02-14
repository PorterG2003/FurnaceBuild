-- ============================================
-- Migration: Phase 1.7 - Create Email Threads and Messages Tables
-- ============================================
-- This migration creates tables for storing full email conversations
-- for the inbox UI. Only stores emails that are replies to campaign emails.

-- ============================================
-- 1. CREATE EMAIL_THREADS TABLE
-- ============================================
-- Stores email conversation threads (one per campaign email conversation)
-- Only threads with replies (has_reply = true) are shown in inbox UI

CREATE TABLE IF NOT EXISTS email_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Ownership and relationships
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  enrollment_id UUID NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  message_job_id UUID NOT NULL REFERENCES message_jobs(id) ON DELETE CASCADE,
  mailbox_id UUID NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
  
  -- Thread metadata
  subject TEXT NOT NULL,
  participants TEXT[] NOT NULL DEFAULT '{}', -- Array of email addresses in conversation
  last_message_at TIMESTAMPTZ NOT NULL, -- Timestamp of most recent message
  message_count INTEGER NOT NULL DEFAULT 1, -- Number of messages in thread
  
  -- Filtering flag
  has_reply BOOLEAN NOT NULL DEFAULT false, -- true if thread has at least one received message/reply
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT email_threads_message_count_check CHECK (message_count > 0)
);

-- Indexes for email_threads
-- Critical composite index for efficient inbox query filtering
CREATE INDEX IF NOT EXISTS idx_email_threads_account_has_reply_last_message 
  ON email_threads(account_id, has_reply, last_message_at DESC);

-- Index for all threads (with or without replies) by account
CREATE INDEX IF NOT EXISTS idx_email_threads_account_last_message 
  ON email_threads(account_id, last_message_at DESC);

-- Foreign key indexes
CREATE INDEX IF NOT EXISTS idx_email_threads_campaign_id ON email_threads(campaign_id);
CREATE INDEX IF NOT EXISTS idx_email_threads_lead_id ON email_threads(lead_id);
CREATE INDEX IF NOT EXISTS idx_email_threads_enrollment_id ON email_threads(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_email_threads_message_job_id ON email_threads(message_job_id);
CREATE INDEX IF NOT EXISTS idx_email_threads_mailbox_id ON email_threads(mailbox_id);

-- Trigger for updated_at
CREATE TRIGGER update_email_threads_updated_at
  BEFORE UPDATE ON email_threads
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Comments
COMMENT ON TABLE email_threads IS 'Stores email conversation threads for campaign replies. Only threads with replies (has_reply = true) are shown in inbox UI.';
COMMENT ON COLUMN email_threads.account_id IS 'Account (organization) that owns this thread - for efficient filtering';
COMMENT ON COLUMN email_threads.has_reply IS 'true if thread has at least one received message/reply, false if only sent messages';
COMMENT ON COLUMN email_threads.message_job_id IS 'The original sent email (message_job) that started this thread';
COMMENT ON COLUMN email_threads.participants IS 'Array of email addresses participating in the conversation';

-- ============================================
-- 2. CREATE EMAIL_MESSAGES TABLE
-- ============================================
-- Stores individual email messages within threads
-- Both sent and received messages are stored here

CREATE TABLE IF NOT EXISTS email_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Relationships
  thread_id UUID NOT NULL REFERENCES email_threads(id) ON DELETE CASCADE,
  message_job_id UUID REFERENCES message_jobs(id) ON DELETE SET NULL, -- NULL for received messages, set for sent messages
  
  -- Message direction
  direction TEXT NOT NULL, -- 'sent' | 'received'
  
  -- Email addresses
  from_email TEXT NOT NULL,
  from_name TEXT,
  to_email TEXT NOT NULL,
  to_name TEXT,
  
  -- Message content
  subject TEXT NOT NULL,
  body_text TEXT, -- Plain text body
  body_html TEXT, -- HTML body
  
  -- Threading headers (for reply detection and threading)
  message_id TEXT, -- IMAP Message-ID header (unique identifier)
  in_reply_to TEXT, -- In-Reply-To header (links to parent message)
  message_references TEXT, -- References header (thread history) - renamed from 'references' (reserved keyword)
  
  -- Timestamps
  received_at TIMESTAMPTZ NOT NULL, -- When message was received (from IMAP) or sent (for sent messages)
  read_at TIMESTAMPTZ, -- When user marked message as read (NULL if unread)
  
  -- Metadata
  headers JSONB DEFAULT '{}', -- Full email headers for debugging
  attachments JSONB DEFAULT '[]', -- Array of attachment metadata: {filename, content_type, size, imap_uid}
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT email_messages_direction_check CHECK (direction IN ('sent', 'received'))
);

-- Indexes for email_messages
-- Index for querying messages in a thread (ordered by received_at)
CREATE INDEX IF NOT EXISTS idx_email_messages_thread_received 
  ON email_messages(thread_id, received_at);

-- Index for linking to message_jobs
CREATE INDEX IF NOT EXISTS idx_email_messages_message_job_id 
  ON email_messages(message_job_id) WHERE message_job_id IS NOT NULL;

-- Index for reply matching (In-Reply-To header lookup)
CREATE INDEX IF NOT EXISTS idx_email_messages_message_id 
  ON email_messages(message_id) WHERE message_id IS NOT NULL;

-- Index for In-Reply-To matching (for finding parent messages)
CREATE INDEX IF NOT EXISTS idx_email_messages_in_reply_to 
  ON email_messages(in_reply_to) WHERE in_reply_to IS NOT NULL;

-- Trigger for updated_at
CREATE TRIGGER update_email_messages_updated_at
  BEFORE UPDATE ON email_messages
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Comments
COMMENT ON TABLE email_messages IS 'Stores individual email messages within threads. Both sent and received messages are stored here.';
COMMENT ON COLUMN email_messages.direction IS 'sent = message sent by our system, received = reply from lead';
COMMENT ON COLUMN email_messages.message_job_id IS 'Links to message_jobs for sent messages. NULL for received messages.';
COMMENT ON COLUMN email_messages.message_id IS 'IMAP Message-ID header - unique identifier for the message';
COMMENT ON COLUMN email_messages.in_reply_to IS 'In-Reply-To header - links to parent message Message-ID';
COMMENT ON COLUMN email_messages.message_references IS 'References header - thread history (renamed from references, reserved keyword)';
COMMENT ON COLUMN email_messages.received_at IS 'When message was received (from IMAP) or sent (for sent messages)';
COMMENT ON COLUMN email_messages.headers IS 'Full email headers stored as JSONB for debugging and advanced features';
COMMENT ON COLUMN email_messages.attachments IS 'Array of attachment metadata: {filename, contentType, size, part, imapUid}. part = MIME part identifier for on-demand fetching, imapUid = message UID.';

