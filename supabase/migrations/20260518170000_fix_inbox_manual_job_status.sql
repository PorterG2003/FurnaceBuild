-- ============================================
-- Migration: align inbox manual job RPC status with message_jobs constraint
-- ============================================

CREATE OR REPLACE FUNCTION create_inbox_reply_job(
  p_account_id UUID,
  p_thread_id UUID,
  p_in_reply_to_message_id UUID,
  p_subject TEXT,
  p_body_text TEXT,
  p_body_html TEXT,
  p_to_email TEXT,
  p_to_name TEXT DEFAULT NULL,
  p_cc TEXT[] DEFAULT NULL,
  p_attachments JSONB DEFAULT NULL
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
  SELECT * INTO v_thread
  FROM email_threads
  WHERE id = p_thread_id
    AND account_id = p_account_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Thread not found or access denied: thread_id=%, account_id=%', p_thread_id, p_account_id;
  END IF;

  SELECT * INTO v_message
  FROM email_messages
  WHERE id = p_in_reply_to_message_id
    AND thread_id = p_thread_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Message not found: message_id=%, thread_id=%', p_in_reply_to_message_id, p_thread_id;
  END IF;

  v_in_reply_to_header := v_message.message_id;

  SELECT string_agg(msg.message_id, ' ' ORDER BY msg.received_at)
  INTO v_references_header
  FROM email_messages msg
  WHERE msg.thread_id = p_thread_id
    AND msg.message_id IS NOT NULL
    AND TRIM(msg.message_id) != '';

  v_references_header := NULLIF(TRIM(COALESCE(v_references_header, '')), '');

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
    'message_references', v_references_header,
    'attachments', COALESCE(p_attachments, '[]'::jsonb)
  );

  INSERT INTO message_jobs (
    enrollment_id,
    campaign_id,
    account_id,
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
    v_thread.account_id,
    v_thread.lead_id,
    v_thread.mailbox_id,
    NULL,
    NULL,
    'inbox_reply',
    'queued',
    NOW(),
    v_message_data
  )
  RETURNING id INTO v_new_job_id;

  RETURN v_new_job_id;
END;
$$;

CREATE OR REPLACE FUNCTION create_inbox_forward_job(
  p_account_id UUID,
  p_thread_id UUID,
  p_forwarded_message_id UUID,
  p_subject TEXT,
  p_body_text TEXT,
  p_body_html TEXT,
  p_to_email TEXT,
  p_to_name TEXT DEFAULT NULL,
  p_cc TEXT[] DEFAULT NULL,
  p_attachments JSONB DEFAULT NULL
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
  SELECT * INTO v_thread
  FROM email_threads
  WHERE id = p_thread_id
    AND account_id = p_account_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Thread not found or access denied: thread_id=%, account_id=%', p_thread_id, p_account_id;
  END IF;

  SELECT * INTO v_message
  FROM email_messages
  WHERE id = p_forwarded_message_id
    AND thread_id = p_thread_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Message not found: message_id=%, thread_id=%', p_forwarded_message_id, p_thread_id;
  END IF;

  v_message_data := jsonb_build_object(
    'source', 'inbox_forward',
    'thread_id', p_thread_id,
    'forwarded_message_id', p_forwarded_message_id,
    'subject', p_subject,
    'body_text', p_body_text,
    'body_html', p_body_html,
    'to_email', p_to_email,
    'to_name', COALESCE(p_to_name, ''),
    'cc', COALESCE(p_cc, ARRAY[]::TEXT[]),
    'attachments', COALESCE(p_attachments, '[]'::jsonb)
  );

  INSERT INTO message_jobs (
    enrollment_id,
    campaign_id,
    account_id,
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
    v_thread.account_id,
    v_thread.lead_id,
    v_thread.mailbox_id,
    NULL,
    NULL,
    'inbox_forward',
    'queued',
    NOW(),
    v_message_data
  )
  RETURNING id INTO v_new_job_id;

  RETURN v_new_job_id;
END;
$$;
