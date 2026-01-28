-- ============================================
-- Migration: create_inbox_reply_job RPC
-- ============================================
-- Creates a message_job for an inbox reply. Callable by any account member
-- (caller must pass account_id; thread must belong to that account).
-- SECURITY DEFINER so the function can insert into message_jobs.

CREATE OR REPLACE FUNCTION create_inbox_reply_job(
  p_account_id UUID,
  p_thread_id UUID,
  p_in_reply_to_message_id UUID,
  p_subject TEXT,
  p_body_text TEXT,
  p_body_html TEXT,
  p_to_email TEXT,
  p_to_name TEXT DEFAULT NULL,
  p_cc TEXT[] DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_thread email_threads%ROWTYPE;
  v_message email_messages%ROWTYPE;
  v_in_reply_to_header TEXT;
  v_references_header TEXT;
  v_message_data JSONB;
  v_new_job_id UUID;
BEGIN
  -- 1. Load thread; must belong to account (any account member can reply)
  SELECT * INTO v_thread
  FROM email_threads
  WHERE id = p_thread_id
    AND account_id = p_account_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Thread not found or access denied: thread_id=%, account_id=%', p_thread_id, p_account_id;
  END IF;

  -- 2. Load the message we are replying to (for In-Reply-To and References)
  SELECT * INTO v_message
  FROM email_messages
  WHERE id = p_in_reply_to_message_id
    AND thread_id = p_thread_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Message not found: message_id=%, thread_id=%', p_in_reply_to_message_id, p_thread_id;
  END IF;

  -- 3. Build threading headers for the reply
  v_in_reply_to_header := v_message.message_id;  -- In-Reply-To: parent's Message-ID
  v_references_header := COALESCE(TRIM(v_message.message_references), '') || CASE WHEN v_message.message_references IS NOT NULL AND v_message.message_references != '' THEN ' ' ELSE '' END || COALESCE(v_message.message_id, '');

  -- 4. Build message_data for the worker
  v_message_data := jsonb_build_object(
    'source', 'inbox_reply',
    'thread_id', p_thread_id,
    'in_reply_to_message_id', p_in_reply_to_message_id,
    'subject', p_subject,
    'body_text', p_body_text,
    'body_html', p_body_html,
    'to_email', p_to_email,
    'to_name', COALESCE(p_to_name, ''),
    'cc', COALESCE(p_cc, ARRAY[]::TEXT[]),
    'in_reply_to', v_in_reply_to_header,
    'message_references', NULLIF(TRIM(v_references_header), '')
  );

  -- 5. Insert message_job (manual type; interval_id and node_id NULL)
  INSERT INTO message_jobs (
    enrollment_id,
    campaign_id,
    lead_id,
    mailbox_id,
    node_id,
    interval_id,
    message_type,
    status,
    scheduled_at,
    message_data
  ) VALUES (
    v_thread.enrollment_id,
    v_thread.campaign_id,
    v_thread.lead_id,
    v_thread.mailbox_id,
    NULL,
    NULL,
    'inbox_reply',
    'pending',
    NOW(),
    v_message_data
  )
  RETURNING id INTO v_new_job_id;

  RETURN v_new_job_id;
END;
$$;

COMMENT ON FUNCTION create_inbox_reply_job IS
  'Creates a message_job for an inbox reply. Caller must pass account_id; thread must belong to that account (any account member can reply). Returns the new message_job id.';
