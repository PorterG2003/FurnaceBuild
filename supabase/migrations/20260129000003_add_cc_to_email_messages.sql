-- ============================================
-- Migration: Add cc to email_messages for sent messages (replies/forwards)
-- ============================================
ALTER TABLE email_messages
  ADD COLUMN IF NOT EXISTS cc TEXT[] DEFAULT NULL;

COMMENT ON COLUMN email_messages.cc IS 'CC recipients (for sent messages with CC).';
