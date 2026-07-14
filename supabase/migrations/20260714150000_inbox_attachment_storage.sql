-- ============================================
-- Inbox outbound attachments: private Storage bucket + tracking + thin job payloads
-- ============================================

-- Bucket (private; service_role only — clients use signed URLs via fetchEmailAttachment Lambda)
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('inbox-attachments', 'inbox-attachments', false, 5242880)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "inbox_attachments_objects_insert"
  ON storage.objects FOR INSERT
  TO service_role
  WITH CHECK (bucket_id = 'inbox-attachments');

CREATE POLICY "inbox_attachments_objects_select"
  ON storage.objects FOR SELECT
  TO service_role
  USING (bucket_id = 'inbox-attachments');

CREATE POLICY "inbox_attachments_objects_update"
  ON storage.objects FOR UPDATE
  TO service_role
  USING (bucket_id = 'inbox-attachments')
  WITH CHECK (bucket_id = 'inbox-attachments');

CREATE POLICY "inbox_attachments_objects_delete"
  ON storage.objects FOR DELETE
  TO service_role
  USING (bucket_id = 'inbox-attachments');

-- Tracking table for pending → claimed → sent lifecycle
CREATE TABLE IF NOT EXISTS public.inbox_attachment_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  thread_id UUID NOT NULL REFERENCES public.email_threads(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'claimed', 'sent')),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_inbox_attachment_uploads_account_thread
  ON public.inbox_attachment_uploads (account_id, thread_id);

CREATE INDEX IF NOT EXISTS idx_inbox_attachment_uploads_pending_created
  ON public.inbox_attachment_uploads (created_at)
  WHERE status = 'pending';

ALTER TABLE public.inbox_attachment_uploads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inbox_attachment_uploads_select_members"
  ON public.inbox_attachment_uploads FOR SELECT
  TO authenticated
  USING (
    account_id IN (SELECT account_id FROM public.account_users WHERE user_id = auth.uid())
  );

-- GC queue for Storage object deletion
CREATE TABLE IF NOT EXISTS public.inbox_attachment_gc_queue (
  storage_path TEXT PRIMARY KEY,
  enqueued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reason TEXT NOT NULL
    CHECK (reason IN ('unclaimed_ttl', 'message_deleted', 'thread_deleted', 'user_removed'))
);

ALTER TABLE public.inbox_attachment_gc_queue ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS; no member policies needed for GC queue.

CREATE OR REPLACE FUNCTION public.enqueue_inbox_attachment_gc(
  p_storage_path TEXT,
  p_reason TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_storage_path IS NULL OR TRIM(p_storage_path) = '' THEN
    RETURN;
  END IF;
  INSERT INTO public.inbox_attachment_gc_queue (storage_path, reason)
  VALUES (p_storage_path, p_reason)
  ON CONFLICT (storage_path) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.extract_storage_paths_from_attachments(p_attachments JSONB)
RETURNS TEXT[]
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_paths TEXT[] := ARRAY[]::TEXT[];
  v_elem JSONB;
  v_path TEXT;
BEGIN
  IF p_attachments IS NULL OR jsonb_typeof(p_attachments) <> 'array' THEN
    RETURN v_paths;
  END IF;
  FOR v_elem IN SELECT * FROM jsonb_array_elements(p_attachments)
  LOOP
    v_path := NULLIF(TRIM(COALESCE(v_elem->>'storagePath', v_elem->>'storage_path', '')), '');
    IF v_path IS NOT NULL THEN
      v_paths := array_append(v_paths, v_path);
    END IF;
  END LOOP;
  RETURN v_paths;
END;
$$;

CREATE OR REPLACE FUNCTION public.email_messages_enqueue_attachment_gc()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_path TEXT;
BEGIN
  FOREACH v_path IN ARRAY public.extract_storage_paths_from_attachments(OLD.attachments)
  LOOP
    PERFORM public.enqueue_inbox_attachment_gc(v_path, 'message_deleted');
  END LOOP;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_email_messages_enqueue_attachment_gc ON public.email_messages;
CREATE TRIGGER trg_email_messages_enqueue_attachment_gc
  BEFORE DELETE ON public.email_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.email_messages_enqueue_attachment_gc();

CREATE OR REPLACE FUNCTION public.email_threads_enqueue_attachment_gc()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_path TEXT;
BEGIN
  FOR v_path IN
    SELECT u.storage_path
    FROM public.inbox_attachment_uploads u
    WHERE u.thread_id = OLD.id
  LOOP
    PERFORM public.enqueue_inbox_attachment_gc(v_path, 'thread_deleted');
  END LOOP;

  FOR v_path IN
    SELECT DISTINCT p.path
    FROM public.email_messages m
    CROSS JOIN LATERAL unnest(public.extract_storage_paths_from_attachments(m.attachments)) AS p(path)
    WHERE m.thread_id = OLD.id
  LOOP
    PERFORM public.enqueue_inbox_attachment_gc(v_path, 'thread_deleted');
  END LOOP;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_email_threads_enqueue_attachment_gc ON public.email_threads;
CREATE TRIGGER trg_email_threads_enqueue_attachment_gc
  BEFORE DELETE ON public.email_threads
  FOR EACH ROW
  EXECUTE FUNCTION public.email_threads_enqueue_attachment_gc();

-- Validate thin attachment payload and claim pending uploads
CREATE OR REPLACE FUNCTION public.validate_and_claim_inbox_attachments(
  p_account_id UUID,
  p_thread_id UUID,
  p_attachments JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_elem JSONB;
  v_result JSONB := '[]'::jsonb;
  v_path TEXT;
  v_filename TEXT;
  v_content_type TEXT;
  v_size BIGINT;
  v_upload public.inbox_attachment_uploads%ROWTYPE;
  i INT := 0;
BEGIN
  IF p_attachments IS NULL OR jsonb_typeof(p_attachments) <> 'array' THEN
    RETURN '[]'::jsonb;
  END IF;

  IF jsonb_array_length(p_attachments) > 10 THEN
    RAISE EXCEPTION 'Too many attachments (max 10)';
  END IF;

  FOR v_elem IN SELECT * FROM jsonb_array_elements(p_attachments)
  LOOP
    i := i + 1;
    IF v_elem ? 'content' AND NULLIF(TRIM(COALESCE(v_elem->>'content', '')), '') IS NOT NULL THEN
      RAISE EXCEPTION 'Attachment payloads must not include base64 content; use storagePath';
    END IF;

    v_path := NULLIF(TRIM(COALESCE(v_elem->>'storagePath', v_elem->>'storage_path', '')), '');
    v_filename := NULLIF(TRIM(COALESCE(v_elem->>'filename', '')), '');
    v_content_type := COALESCE(NULLIF(TRIM(COALESCE(v_elem->>'contentType', v_elem->>'content_type', '')), ''), 'application/octet-stream');
    BEGIN
      v_size := COALESCE((v_elem->>'size')::BIGINT, 0);
    EXCEPTION WHEN others THEN
      v_size := 0;
    END;

    IF v_path IS NULL OR v_filename IS NULL THEN
      RAISE EXCEPTION 'Attachment % missing storagePath or filename', i;
    END IF;

    SELECT * INTO v_upload
    FROM public.inbox_attachment_uploads
    WHERE storage_path = v_path
      AND account_id = p_account_id
      AND thread_id = p_thread_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Unknown or inaccessible attachment storagePath: %', v_path;
    END IF;

    IF v_upload.status NOT IN ('pending', 'claimed') THEN
      RAISE EXCEPTION 'Attachment % is not claimable (status=%)', v_path, v_upload.status;
    END IF;

    IF v_upload.status = 'pending' THEN
      UPDATE public.inbox_attachment_uploads
      SET status = 'claimed', claimed_at = NOW()
      WHERE id = v_upload.id;
    END IF;

    v_result := v_result || jsonb_build_array(
      jsonb_build_object(
        'filename', COALESCE(v_filename, v_upload.filename),
        'contentType', COALESCE(v_content_type, v_upload.content_type),
        'size', CASE WHEN v_size > 0 THEN v_size ELSE v_upload.size END,
        'storagePath', v_path
      )
    );
  END LOOP;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_expired_pending_inbox_attachments(
  p_older_than_hours INT DEFAULT 24
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT := 0;
  v_row public.inbox_attachment_uploads%ROWTYPE;
BEGIN
  FOR v_row IN
    SELECT *
    FROM public.inbox_attachment_uploads
    WHERE status = 'pending'
      AND created_at < NOW() - make_interval(hours => p_older_than_hours)
  LOOP
    PERFORM public.enqueue_inbox_attachment_gc(v_row.storage_path, 'unclaimed_ttl');
    DELETE FROM public.inbox_attachment_uploads WHERE id = v_row.id;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

-- Thin-payload reply / forward RPCs
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
  v_attachments JSONB;
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

  v_attachments := public.validate_and_claim_inbox_attachments(p_account_id, p_thread_id, p_attachments);

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
    'attachments', v_attachments
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
  v_attachments JSONB;
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

  v_attachments := public.validate_and_claim_inbox_attachments(p_account_id, p_thread_id, p_attachments);

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
    'attachments', v_attachments
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

COMMENT ON FUNCTION create_inbox_reply_job IS
  'Creates a message_job for an inbox reply. Optional p_attachments: JSONB array of { filename, contentType, size, storagePath } (no base64).';

COMMENT ON FUNCTION create_inbox_forward_job IS
  'Creates a message_job for an inbox forward. Optional p_attachments: JSONB array of { filename, contentType, size, storagePath } (no base64).';

COMMENT ON TABLE public.inbox_attachment_uploads IS
  'Outbound inbox attachment uploads: pending (composer) → claimed (job created) → sent (message persisted).';

COMMENT ON TABLE public.inbox_attachment_gc_queue IS
  'Storage paths awaiting deletion after wipe, user remove, or unclaimed TTL.';
