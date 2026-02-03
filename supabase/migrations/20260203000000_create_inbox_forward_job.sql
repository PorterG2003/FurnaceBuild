-- ============================================
-- Migration: create_inbox_forward_job RPC
-- ============================================
-- Forward a message to new recipients. Creates a message_job with message_type = 'inbox_forward'.
-- Unlike reply, forward does not insert into email_messages or update email_threads (send only).

CREATE OR REPLACE FUNCTION create_inbox_forward_job(
  p_account_id UUID,
  p_thread_id UUID,
  p_forwarded_message_id UUID,
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
  v_message_data JSONB;
  v_new_job_id UUID;
BEGIN
  -- 1. Load thread; must belong to account
  SELECT * INTO v_thread
  FROM email_threads
  WHERE id = p_thread_id
    AND account_id = p_account_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Thread not found or access denied: thread_id=%, account_id=%', p_thread_id, p_account_id;
  END IF;

  -- 2. Load the message being forwarded (for validation)
  SELECT * INTO v_message
  FROM email_messages
  WHERE id = p_forwarded_message_id
    AND thread_id = p_thread_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Message not found: message_id=%, thread_id=%', p_forwarded_message_id, p_thread_id;
  END IF;

  -- 3. Build message_data for the worker (no In-Reply-To/References for forward)
  v_message_data := jsonb_build_object(
    'source', 'inbox_forward',
    'thread_id', p_thread_id,
    'forwarded_message_id', p_forwarded_message_id,
    'subject', p_subject,
    'body_text', p_body_text,
    'body_html', p_body_html,
    'to_email', p_to_email,
    'to_name', COALESCE(p_to_name, ''),
    'cc', COALESCE(p_cc, ARRAY[]::TEXT[])
  );

  -- 4. Insert message_job (manual type; interval_id and node_id NULL)
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
    'inbox_forward',
    'pending',
    NOW(),
    v_message_data
  )
  RETURNING id INTO v_new_job_id;

  RETURN v_new_job_id;
END;
$$;

COMMENT ON FUNCTION create_inbox_forward_job IS
  'Creates a message_job for forwarding a message to new recipients. Forward is send-only (no email_messages insert, no email_threads update).';
