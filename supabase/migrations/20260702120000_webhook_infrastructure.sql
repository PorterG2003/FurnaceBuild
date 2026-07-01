-- Webhook infrastructure: shared emit primitive, enqueue-on-insert rails, DB-triggered events.

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE TABLE IF NOT EXISTS public.furnace_internal_config (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.furnace_internal_config IS
  'Environment-specific internal URLs and secrets read by database triggers (e.g. webhook enqueue).';

ALTER TABLE public.webhook_events
  ADD COLUMN IF NOT EXISTS sqs_enqueued_at timestamptz;

CREATE INDEX IF NOT EXISTS webhook_events_unenqueued_idx
  ON public.webhook_events (created_at)
  WHERE sqs_enqueued_at IS NULL;

CREATE OR REPLACE FUNCTION public.furnace_emit_webhook_event(
  p_account_id uuid,
  p_campaign_id uuid,
  p_event_type text,
  p_payload jsonb,
  p_dedupe_key text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id uuid;
BEGIN
  IF current_setting('furnace.suppress_webhook_emission', true) = 'true' THEN
    RETURN NULL;
  END IF;

  IF p_account_id IS NULL OR p_event_type IS NULL OR p_event_type = '' THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.webhook_events (
    account_id,
    campaign_id,
    event_type,
    payload,
    dedupe_key
  )
  VALUES (
    p_account_id,
    p_campaign_id,
    p_event_type,
    COALESCE(p_payload, '{}'::jsonb),
    NULLIF(p_dedupe_key, '')
  )
  ON CONFLICT (account_id, dedupe_key) WHERE dedupe_key IS NOT NULL
  DO NOTHING
  RETURNING id INTO v_event_id;

  RETURN v_event_id;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'furnace_emit_webhook_event failed: %', SQLERRM;
    RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.furnace_emit_webhook_event(uuid, uuid, text, jsonb, text) IS
  'Inserts a webhook_events row. Set LOCAL furnace.suppress_webhook_emission = true to skip during backfills.';

GRANT EXECUTE ON FUNCTION public.furnace_emit_webhook_event(uuid, uuid, text, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.furnace_emit_webhook_event(uuid, uuid, text, jsonb, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.furnace_enqueue_webhook_event_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text;
  v_secret text;
  v_headers jsonb;
BEGIN
  SELECT value INTO v_url
  FROM public.furnace_internal_config
  WHERE key = 'webhook_enqueue_url';

  IF v_url IS NULL OR btrim(v_url) = '' THEN
    RETURN NEW;
  END IF;

  SELECT value INTO v_secret
  FROM public.furnace_internal_config
  WHERE key = 'webhook_enqueue_secret';

  v_headers := jsonb_build_object('Content-Type', 'application/json');
  IF v_secret IS NOT NULL AND btrim(v_secret) <> '' THEN
    v_headers := v_headers || jsonb_build_object('X-Furnace-Internal-Secret', v_secret);
  END IF;

  PERFORM net.http_post(
    url := v_url,
    headers := v_headers,
    body := jsonb_build_object('eventId', NEW.id)
  );

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'furnace_enqueue_webhook_event_trigger failed for %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS webhook_events_enqueue_webhook ON public.webhook_events;
CREATE TRIGGER webhook_events_enqueue_webhook
  AFTER INSERT ON public.webhook_events
  FOR EACH ROW
  EXECUTE FUNCTION public.furnace_enqueue_webhook_event_trigger();

CREATE OR REPLACE FUNCTION public.furnace_emit_reply_categorized_webhook()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payload jsonb;
  v_dedupe_key text;
  v_msg record;
BEGIN
  IF OLD.category IS NOT DISTINCT FROM NEW.category THEN
    RETURN NEW;
  END IF;

  SELECT
    em.id AS email_message_id,
    em.from_email,
    COALESCE(em.subject, NEW.subject) AS subject
  INTO v_msg
  FROM public.email_messages em
  WHERE em.thread_id = NEW.id
    AND em.direction = 'received'
  ORDER BY em.received_at DESC NULLS LAST, em.created_at DESC
  LIMIT 1;

  v_payload := jsonb_strip_nulls(jsonb_build_object(
    'thread_id', NEW.id,
    'campaign_id', NEW.campaign_id,
    'lead_id', NEW.lead_id,
    'enrollment_id', NEW.enrollment_id,
    'email_message_id', v_msg.email_message_id,
    'category', NEW.category,
    'previous_category', OLD.category,
    'category_source', NEW.category_source,
    'from_email', v_msg.from_email,
    'subject', v_msg.subject
  ));

  v_dedupe_key := format(
    'reply.categorized:%s:%s',
    NEW.id,
    COALESCE(NEW.updated_at::text, clock_timestamp()::text)
  );

  PERFORM public.furnace_emit_webhook_event(
    NEW.account_id,
    NEW.campaign_id,
    'reply.categorized',
    v_payload,
    v_dedupe_key
  );

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'furnace_emit_reply_categorized_webhook failed for thread %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS email_threads_reply_categorized_webhook ON public.email_threads;
CREATE TRIGGER email_threads_reply_categorized_webhook
  AFTER UPDATE OF category ON public.email_threads
  FOR EACH ROW
  WHEN (OLD.category IS DISTINCT FROM NEW.category)
  EXECUTE FUNCTION public.furnace_emit_reply_categorized_webhook();

CREATE OR REPLACE FUNCTION public.furnace_emit_campaign_status_webhook()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_type text;
  v_dedupe_key text;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'paused' THEN
    v_event_type := 'campaign.paused';
  ELSIF NEW.status = 'running' AND OLD.status = 'paused' THEN
    v_event_type := 'campaign.resumed';
  ELSIF NEW.status = 'stopped' THEN
    v_event_type := 'campaign.stopped';
  ELSE
    RETURN NEW;
  END IF;

  v_dedupe_key := format(
    '%s:%s:%s',
    v_event_type,
    NEW.id,
    COALESCE(NEW.updated_at::text, clock_timestamp()::text)
  );

  PERFORM public.furnace_emit_webhook_event(
    NEW.account_id,
    NEW.id,
    v_event_type,
    jsonb_build_object('campaign_id', NEW.id),
    v_dedupe_key
  );

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'furnace_emit_campaign_status_webhook failed for campaign %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS campaigns_status_webhook ON public.campaigns;
CREATE TRIGGER campaigns_status_webhook
  AFTER UPDATE OF status ON public.campaigns
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.furnace_emit_campaign_status_webhook();
