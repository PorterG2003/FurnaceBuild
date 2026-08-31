-- Shared lead identity block for CRM webhook payloads, plus reply.categorized enrichment.

CREATE OR REPLACE FUNCTION public.private_lead_webhook_custom_value(p_value jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_value IS NULL OR p_value = 'null'::jsonb THEN
    RETURN NULL;
  END IF;

  IF jsonb_typeof(p_value) = 'string' THEN
    RETURN NULLIF(btrim(p_value #>> '{}'), '');
  END IF;

  IF jsonb_typeof(p_value) IN ('number', 'boolean') THEN
    RETURN p_value #>> '{}';
  END IF;

  IF jsonb_typeof(p_value) IN ('object', 'array') THEN
    RETURN replace(replace(p_value::text, ': ', ':'), ', ', ',');
  END IF;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.private_jsonb_compact_text(p_value jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT replace(replace(p_value::text, ': ', ':'), ', ', ',');
$$;

CREATE OR REPLACE FUNCTION public.private_lead_webhook_identity(
  p_lead_id uuid,
  p_campaign_id uuid,
  p_mailbox_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_lead record;
  v_campaign_name text;
  v_mailbox_email text;
  v_title text;
  v_custom jsonb := '{}'::jsonb;
  v_truncated boolean := false;
  v_key text;
  v_val text;
  v_next jsonb;
  v_keys text[];
BEGIN
  IF p_lead_id IS NULL THEN
    RETURN '{}'::jsonb;
  END IF;

  SELECT
    id,
    email,
    first_name,
    last_name,
    name,
    company_name,
    website,
    linkedin_url,
    company_linkedin_url,
    phone_number,
    custom_lead_data
  INTO v_lead
  FROM public.leads
  WHERE id = p_lead_id;

  IF NOT FOUND THEN
    RETURN jsonb_strip_nulls(jsonb_build_object(
      'campaign_id', p_campaign_id,
      'lead_id', p_lead_id,
      'mailbox_id', p_mailbox_id
    ));
  END IF;

  IF p_campaign_id IS NOT NULL THEN
    SELECT NULLIF(btrim(name), '')
    INTO v_campaign_name
    FROM public.campaigns
    WHERE id = p_campaign_id;
  END IF;

  IF p_mailbox_id IS NOT NULL THEN
    SELECT NULLIF(btrim(email_address), '')
    INTO v_mailbox_email
    FROM public.mailboxes
    WHERE id = p_mailbox_id;
  END IF;

  IF v_lead.custom_lead_data IS NOT NULL AND jsonb_typeof(v_lead.custom_lead_data) = 'object' THEN
    SELECT array_agg(k ORDER BY k)
    INTO v_keys
    FROM jsonb_object_keys(v_lead.custom_lead_data) AS k;

    IF v_keys IS NOT NULL THEN
      FOREACH v_key IN ARRAY v_keys LOOP
        v_val := public.private_lead_webhook_custom_value(v_lead.custom_lead_data -> v_key);
        IF v_val IS NULL THEN
          CONTINUE;
        END IF;
        v_next := v_custom || jsonb_build_object(v_key, v_val);
        IF octet_length(public.private_jsonb_compact_text(v_next)) > 8192 THEN
          v_truncated := true;
        ELSE
          v_custom := v_next;
        END IF;
      END LOOP;
    END IF;

    SELECT public.private_lead_webhook_custom_value(v)
    INTO v_title
    FROM jsonb_each(v_lead.custom_lead_data) AS t(k, v)
    WHERE lower(k) = 'title'
      AND public.private_lead_webhook_custom_value(v) IS NOT NULL
    LIMIT 1;

    IF v_title IS NULL THEN
      SELECT public.private_lead_webhook_custom_value(v)
      INTO v_title
      FROM jsonb_each(v_lead.custom_lead_data) AS t(k, v)
      WHERE lower(k) = 'job_title'
        AND public.private_lead_webhook_custom_value(v) IS NOT NULL
      LIMIT 1;
    END IF;
  END IF;

  RETURN jsonb_strip_nulls(jsonb_build_object(
    'campaign_id', p_campaign_id,
    'campaign_name', v_campaign_name,
    'lead_id', v_lead.id,
    'email', NULLIF(btrim(v_lead.email), ''),
    'mailbox_id', p_mailbox_id,
    'mailbox_email', v_mailbox_email,
    'first_name', NULLIF(btrim(v_lead.first_name), ''),
    'last_name', NULLIF(btrim(v_lead.last_name), ''),
    'full_name', NULLIF(btrim(v_lead.name), ''),
    'company_name', NULLIF(btrim(v_lead.company_name), ''),
    'title', v_title,
    'website', NULLIF(btrim(v_lead.website), ''),
    'linkedin_url', NULLIF(btrim(v_lead.linkedin_url), ''),
    'company_linkedin_url', NULLIF(btrim(v_lead.company_linkedin_url), ''),
    'phone_number', NULLIF(btrim(v_lead.phone_number), ''),
    'custom_fields', CASE WHEN v_custom = '{}'::jsonb THEN NULL ELSE v_custom END,
    'custom_fields_truncated', CASE WHEN v_truncated THEN true ELSE NULL END
  ));
END;
$$;

CREATE OR REPLACE FUNCTION public.furnace_emit_reply_categorized_webhook()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payload jsonb;
  v_identity jsonb;
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

  v_identity := public.private_lead_webhook_identity(
    NEW.lead_id,
    NEW.campaign_id,
    NEW.mailbox_id
  );

  v_payload := jsonb_strip_nulls(
    COALESCE(v_identity, '{}'::jsonb)
    || jsonb_build_object(
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
    )
  );

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

GRANT EXECUTE ON FUNCTION public.private_lead_webhook_custom_value(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.private_jsonb_compact_text(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.private_lead_webhook_identity(uuid, uuid, uuid) TO service_role;
