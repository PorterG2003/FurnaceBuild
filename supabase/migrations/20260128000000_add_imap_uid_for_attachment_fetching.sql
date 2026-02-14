-- ============================================
-- Migration: Add IMAP UID for on-demand attachment fetching
-- ============================================
-- Adds imap_uid column to email_messages and updates attachment metadata structure
-- to support on-demand attachment fetching from IMAP

-- Add imap_uid column to email_messages (for received messages only)
ALTER TABLE email_messages 
  ADD COLUMN IF NOT EXISTS imap_uid INTEGER;

-- Create index for efficient lookup by imap_uid
CREATE INDEX IF NOT EXISTS idx_email_messages_imap_uid 
  ON email_messages(imap_uid) 
  WHERE imap_uid IS NOT NULL;

-- Update comment to reflect new structure
COMMENT ON COLUMN email_messages.imap_uid IS 'IMAP UID of the message (for received messages). Used for on-demand attachment fetching.';
COMMENT ON COLUMN email_messages.attachments IS 'Array of attachment metadata: {filename, contentType, size, part, imapUid}. part = MIME part identifier (e.g., "1", "1.2") for downloading specific parts via IMAP, imapUid = message UID for fetching.';
