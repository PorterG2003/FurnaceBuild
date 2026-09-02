-- Block list webhooks: emit entry_added / entry_removed from the table.
-- Optional source stamps who wrote the row. Existing rows stay NULL.

ALTER TABLE public.block_list
  ADD COLUMN IF NOT EXISTS source text;

ALTER TABLE public.block_list
  DROP CONSTRAINT IF EXISTS block_list_source_check;

ALTER TABLE public.block_list
  ADD CONSTRAINT block_list_source_check
  CHECK (
    source IS NULL
    OR source IN ('reply_opt_out', 'inbox', 'api', 'import', 'bounce')
  );

COMMENT ON COLUMN public.block_list.source IS
  'Who wrote the row: reply_opt_out, inbox, api, import, bounce. Null on legacy rows.';

CREATE OR REPLACE FUNCTION public.private_block_list_webhook_payload(
  p_account_id uuid,
  p_value text,
  p_type text,
  p_reason text,
  p_source text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_lead_id uuid;
  v_campaign_id uuid;
  v_enroll_campaign_id uuid;
  v_mailbox_id uuid;
  v_enrollment_id uuid;
  v_identity jsonb := '{}'::jsonb;
  v_email text;
BEGIN
  IF p_type = 'email' THEN
    v_email := NULLIF(lower(btrim(p_value)), '');

    SELECT l.id, l.campaign_id, l.mailbox_id
    INTO v_lead_id, v_campaign_id, v_mailbox_id
    FROM public.leads l
    WHERE l.account_id = p_account_id
      AND l.deleted_at IS NULL
      AND lower(btrim(l.email)) = v_email
    ORDER BY l.updated_at DESC NULLS LAST, l.created_at DESC
    LIMIT 1;

    IF v_lead_id IS NOT NULL THEN
      SELECT e.id, e.campaign_id
      INTO v_enrollment_id, v_enroll_campaign_id
      FROM public.enrollments e
      WHERE e.lead_id = v_lead_id
        AND e.deleted_at IS NULL
      ORDER BY e.updated_at DESC NULLS LAST, e.created_at DESC
      LIMIT 1;

      IF v_enroll_campaign_id IS NOT NULL THEN
        v_campaign_id := v_enroll_campaign_id;
      END IF;

      IF v_mailbox_id IS NULL THEN
        SELECT mj.mailbox_id
        INTO v_mailbox_id
        FROM public.message_jobs mj
        WHERE mj.lead_id = v_lead_id
          AND mj.status = 'sent'
        ORDER BY mj.sent_at DESC NULLS LAST
        LIMIT 1;
      END IF;

      v_identity := public.private_lead_webhook_identity(
        v_lead_id,
        v_campaign_id,
        v_mailbox_id
      );
    END IF;
  END IF;

  RETURN jsonb_strip_nulls(
    COALESCE(v_identity, '{}'::jsonb)
    || jsonb_build_object(
      'value', NULLIF(btrim(p_value), ''),
      'type', NULLIF(btrim(p_type), ''),
      'reason', NULLIF(btrim(p_reason), ''),
      'source', NULLIF(btrim(p_source), ''),
      'email', v_email,
      'enrollment_id', v_enrollment_id
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.furnace_emit_block_list_added_webhook()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payload jsonb;
  v_campaign_id uuid;
BEGIN
  v_payload := public.private_block_list_webhook_payload(
    NEW.account_id,
    NEW.value,
    NEW.type,
    NEW.reason,
    NEW.source
  );
  v_campaign_id := NULLIF(v_payload->>'campaign_id', '')::uuid;

  PERFORM public.furnace_emit_webhook_event(
    NEW.account_id,
    v_campaign_id,
    'blocklist.entry_added',
    v_payload,
    format('blocklist.entry_added:%s:%s:%s', NEW.account_id, NEW.type, NEW.value)
  );

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'furnace_emit_block_list_added_webhook failed for block_list %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.furnace_emit_block_list_removed_webhook()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payload jsonb;
  v_campaign_id uuid;
BEGIN
  v_payload := public.private_block_list_webhook_payload(
    OLD.account_id,
    OLD.value,
    OLD.type,
    OLD.reason,
    OLD.source
  );
  v_campaign_id := NULLIF(v_payload->>'campaign_id', '')::uuid;

  PERFORM public.furnace_emit_webhook_event(
    OLD.account_id,
    v_campaign_id,
    'blocklist.entry_removed',
    v_payload,
    format('blocklist.entry_removed:%s:%s', OLD.account_id, OLD.id)
  );

  RETURN OLD;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'furnace_emit_block_list_removed_webhook failed for block_list %: %', OLD.id, SQLERRM;
    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS block_list_emit_added_webhook ON public.block_list;
CREATE TRIGGER block_list_emit_added_webhook
  AFTER INSERT ON public.block_list
  FOR EACH ROW
  EXECUTE FUNCTION public.furnace_emit_block_list_added_webhook();

DROP TRIGGER IF EXISTS block_list_emit_removed_webhook ON public.block_list;
CREATE TRIGGER block_list_emit_removed_webhook
  AFTER DELETE ON public.block_list
  FOR EACH ROW
  EXECUTE FUNCTION public.furnace_emit_block_list_removed_webhook();

GRANT EXECUTE ON FUNCTION public.private_block_list_webhook_payload(uuid, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.furnace_emit_block_list_added_webhook() TO service_role;
GRANT EXECUTE ON FUNCTION public.furnace_emit_block_list_removed_webhook() TO service_role;
