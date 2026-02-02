-- ============================================
-- Migration: Reply References = full thread history
-- ============================================
-- Build References header from all messages in the thread (chronological order)
-- so To and CC recipients see the full thread in their email client.

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

  -- 2. Load the message we are replying to (for In-Reply-To)
  SELECT * INTO v_message
  FROM email_messages
  WHERE id = p_in_reply_to_message_id
    AND thread_id = p_thread_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Message not found: message_id=%, thread_id=%', p_in_reply_to_message_id, p_thread_id;
  END IF;

  -- 3. Build threading headers: In-Reply-To = parent Message-ID; References = full thread (all message_ids in order)
  v_in_reply_to_header := v_message.message_id;

  SELECT string_agg(msg.message_id, ' ' ORDER BY msg.received_at)
  INTO v_references_header
  FROM email_messages msg
  WHERE msg.thread_id = p_thread_id
    AND msg.message_id IS NOT NULL
    AND TRIM(msg.message_id) != '';

  v_references_header := NULLIF(TRIM(COALESCE(v_references_header, '')), '');

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
    'message_references', v_references_header
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
  'Creates a message_job for an inbox reply. References header is built from full thread (all message_ids in chronological order) so To/CC recipients see the full thread.';
