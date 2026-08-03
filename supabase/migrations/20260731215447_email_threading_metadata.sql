-- Additive threading metadata: submitted vs provider Message-IDs, parsed References,
-- Thread-Topic / Thread-Index persistence, pending child-before-parent staging.
-- Also fixes create_inbox_reply_job to emit parent ancestry (not chronological siblings).

ALTER TABLE public.message_jobs
  ADD COLUMN IF NOT EXISTS submitted_message_id TEXT;

COMMENT ON COLUMN public.message_jobs.submitted_message_id IS
  'Message-ID Furnace submitted on the wire; provider_message_id remains the transport-reported ID.';

CREATE INDEX IF NOT EXISTS idx_message_jobs_submitted_message_id
  ON public.message_jobs (submitted_message_id)
  WHERE submitted_message_id IS NOT NULL;

ALTER TABLE public.email_messages
  ADD COLUMN IF NOT EXISTS reference_message_ids TEXT[],
  ADD COLUMN IF NOT EXISTS thread_topic TEXT,
  ADD COLUMN IF NOT EXISTS thread_index TEXT;

COMMENT ON COLUMN public.email_messages.reference_message_ids IS
  'Parsed ordered Message-IDs from the References header (normalized, unbracketed).';
COMMENT ON COLUMN public.email_messages.thread_topic IS
  'Normalized conversation topic (e.g. Outlook Thread-Topic), without Re:/Fwd: prefixes.';
COMMENT ON COLUMN public.email_messages.thread_index IS
  'Raw Outlook Thread-Index when present on inbound mail. Not synthesized on outbound.';

CREATE INDEX IF NOT EXISTS idx_email_messages_thread_topic
  ON public.email_messages (account_id, thread_topic)
  WHERE thread_topic IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.pending_inbound_replies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  mailbox_id UUID NOT NULL REFERENCES public.mailboxes(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  in_reply_to TEXT,
  reference_message_ids TEXT[] NOT NULL DEFAULT '{}',
  payload JSONB NOT NULL,
  reason TEXT NOT NULL DEFAULT 'parent_not_found',
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pending_inbound_replies_account_message_unique UNIQUE (account_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_pending_inbound_replies_mailbox_created
  ON public.pending_inbound_replies (mailbox_id, created_at);

COMMENT ON TABLE public.pending_inbound_replies IS
  'Inbound replies whose headers point at our outbound but the parent row is not yet present.';

ALTER TABLE public.pending_inbound_replies ENABLE ROW LEVEL SECURITY;

-- Replace the 3-arg overload; adding a param via CREATE OR REPLACE alone would
-- leave the old signature in place and confuse PostgREST.
DROP FUNCTION IF EXISTS public.finalize_message_job_sent(UUID, TEXT, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION public.finalize_message_job_sent(
  p_message_job_id UUID,
  p_provider_message_id TEXT,
  p_sent_at TIMESTAMPTZ DEFAULT NOW(),
  p_submitted_message_id TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE
  v_message_job RECORD;
  v_today DATE;
  v_current_hour INTEGER;
  v_throttle RECORD;
  v_hourly_count INTEGER;
BEGIN
  SELECT
    mj.id,
    mj.mailbox_id
  INTO v_message_job
  FROM message_jobs mj
  WHERE mj.id = p_message_job_id
    AND mj.status = 'sending'
  FOR UPDATE OF mj;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  v_today := (p_sent_at AT TIME ZONE 'UTC')::DATE;
  v_current_hour := EXTRACT(HOUR FROM p_sent_at)::INTEGER;

  SELECT * INTO v_throttle
  FROM mailbox_throttles
  WHERE mailbox_id = v_message_job.mailbox_id
    AND date = v_today
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO mailbox_throttles (
      mailbox_id,
      account_id,
      date,
      sent_count,
      hourly_sent,
      daily_limit,
      hourly_limit,
      min_gap_seconds,
      last_sent_at,
      updated_at
    )
    SELECT
      m.id,
      m.account_id,
      v_today,
      0,
      '{}'::JSONB,
      COALESCE(m.daily_limit, 50),
      COALESCE(m.hourly_limit, 10),
      COALESCE(m.min_gap_seconds, 180),
      NULL,
      NOW()
    FROM mailboxes m
    WHERE m.id = v_message_job.mailbox_id
    ON CONFLICT (mailbox_id, date) DO NOTHING
    RETURNING * INTO v_throttle;

    IF NOT FOUND THEN
      SELECT * INTO v_throttle
      FROM mailbox_throttles
      WHERE mailbox_id = v_message_job.mailbox_id
        AND date = v_today
      FOR UPDATE;
    END IF;
  END IF;

  v_hourly_count := COALESCE((v_throttle.hourly_sent->>v_current_hour::TEXT)::INTEGER, 0);

  UPDATE mailbox_throttles
  SET sent_count = sent_count + 1,
      hourly_sent = jsonb_set(
        COALESCE(hourly_sent, '{}'::JSONB),
        ARRAY[v_current_hour::TEXT],
        to_jsonb(v_hourly_count + 1)
      ),
      last_sent_at = p_sent_at,
      updated_at = NOW()
  WHERE mailbox_id = v_message_job.mailbox_id
    AND date = v_today;

  UPDATE message_jobs
  SET status = 'sent',
      status_reason = 'sent_successfully',
      sent_at = p_sent_at,
      provider_message_id = p_provider_message_id,
      submitted_message_id = COALESCE(p_submitted_message_id, submitted_message_id),
      lease_expires_at = NULL,
      claim_token = NULL,
      updated_at = NOW()
  WHERE id = p_message_job_id
    AND status = 'sending';

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

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
  v_ref_ids TEXT[];
  v_parent_id TEXT;
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

  v_parent_id := NULLIF(TRIM(BOTH '<>' FROM COALESCE(v_message.message_id, '')), '');
  v_in_reply_to_header := v_message.message_id;

  -- Prefer parsed ancestry + parent; fall back to legacy message_references string.
  IF v_message.reference_message_ids IS NOT NULL AND cardinality(v_message.reference_message_ids) > 0 THEN
    v_ref_ids := v_message.reference_message_ids;
  ELSIF v_message.message_references IS NOT NULL AND TRIM(v_message.message_references) != '' THEN
    SELECT COALESCE(array_agg(DISTINCT trim(BOTH '<>' FROM tok)), ARRAY[]::TEXT[])
    INTO v_ref_ids
    FROM unnest(regexp_split_to_array(v_message.message_references, '\s+')) AS tok
    WHERE tok IS NOT NULL AND TRIM(tok) != '' AND position('@' IN tok) > 0;
  ELSE
    v_ref_ids := ARRAY[]::TEXT[];
  END IF;

  IF v_parent_id IS NOT NULL THEN
    v_ref_ids := array_remove(v_ref_ids, v_parent_id);
    v_ref_ids := v_ref_ids || v_parent_id;
  END IF;

  SELECT string_agg('<' || rid || '>', ' ' ORDER BY ord)
  INTO v_references_header
  FROM unnest(v_ref_ids) WITH ORDINALITY AS t(rid, ord);

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
    'reference_message_ids', to_jsonb(v_ref_ids),
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

COMMENT ON FUNCTION create_inbox_reply_job IS
  'Creates a message_job for an inbox reply. References = selected parent ancestry + parent Message-ID.';
