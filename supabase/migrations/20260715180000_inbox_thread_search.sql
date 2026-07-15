-- Inbox thread search: FTS vectors + unified list RPC
-- Matches subject, participants, lead identity/company, message bodies, thread tags, campaign name.

-- ---------------------------------------------------------------------------
-- 1. Query helper: whitespace-split prefix tsquery (simple config)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.inbox_search_to_tsquery(p_search text)
RETURNS tsquery
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_token text;
  v_escaped text;
  v_parts text := '';
BEGIN
  IF p_search IS NULL OR btrim(p_search) = '' THEN
    RETURN NULL;
  END IF;

  FOR v_token IN
    SELECT t
    FROM unnest(regexp_split_to_array(btrim(p_search), '\s+')) AS t
    WHERE length(t) > 0
  LOOP
    -- Escape tsquery special characters, then force prefix match.
    v_escaped := regexp_replace(v_token, '([\\&\|!\(\):\*''])', '\\\1', 'g');
    IF v_parts <> '' THEN
      v_parts := v_parts || ' & ';
    END IF;
    v_parts := v_parts || v_escaped || ':*';
  END LOOP;

  IF v_parts = '' THEN
    RETURN NULL;
  END IF;

  BEGIN
    RETURN to_tsquery('simple', v_parts);
  EXCEPTION
    WHEN OTHERS THEN
      RETURN NULL;
  END;
END;
$$;

COMMENT ON FUNCTION public.inbox_search_to_tsquery(text) IS
  'Build a simple-config prefix tsquery from free-text inbox search.';

GRANT EXECUTE ON FUNCTION public.inbox_search_to_tsquery(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.inbox_search_to_tsquery(text) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. email_messages.search_vector (trigger-maintained; to_tsvector is not IMMUTABLE)
-- ---------------------------------------------------------------------------
ALTER TABLE public.email_messages
  ADD COLUMN IF NOT EXISTS search_vector tsvector;

CREATE OR REPLACE FUNCTION public.build_email_message_search_vector(
  p_subject text,
  p_from_email text,
  p_from_name text,
  p_to_email text,
  p_to_name text,
  p_cc text[],
  p_body_text text
)
RETURNS tsvector
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    setweight(to_tsvector('simple', coalesce(p_subject, '')), 'A')
    || setweight(
      to_tsvector(
        'simple',
        coalesce(p_from_email, '') || ' ' ||
        coalesce(p_from_name, '') || ' ' ||
        coalesce(p_to_email, '') || ' ' ||
        coalesce(p_to_name, '') || ' ' ||
        coalesce(array_to_string(p_cc, ' '), '')
      ),
      'B'
    )
    || setweight(to_tsvector('simple', coalesce(left(p_body_text, 50000), '')), 'D');
$$;

CREATE OR REPLACE FUNCTION public.trg_email_messages_refresh_search_vector()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.search_vector := public.build_email_message_search_vector(
    NEW.subject,
    NEW.from_email,
    NEW.from_name,
    NEW.to_email,
    NEW.to_name,
    NEW.cc,
    NEW.body_text
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_email_messages_search_vector_before ON public.email_messages;
CREATE TRIGGER trg_email_messages_search_vector_before
  BEFORE INSERT OR UPDATE OF subject, from_email, from_name, to_email, to_name, cc, body_text
  ON public.email_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_email_messages_refresh_search_vector();

UPDATE public.email_messages
SET search_vector = public.build_email_message_search_vector(
  subject, from_email, from_name, to_email, to_name, cc, body_text
)
WHERE search_vector IS NULL;

CREATE INDEX IF NOT EXISTS idx_email_messages_search_vector
  ON public.email_messages
  USING gin (search_vector);

COMMENT ON COLUMN public.email_messages.search_vector IS
  'FTS document for message subject, addresses, and body_text (HTML excluded).';

GRANT EXECUTE ON FUNCTION public.build_email_message_search_vector(text, text, text, text, text, text[], text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.build_email_message_search_vector(text, text, text, text, text, text[], text) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. email_threads.search_vector (trigger-maintained; joins lead/campaign/tags)
-- ---------------------------------------------------------------------------
ALTER TABLE public.email_threads
  ADD COLUMN IF NOT EXISTS search_vector tsvector;

CREATE INDEX IF NOT EXISTS idx_email_threads_search_vector
  ON public.email_threads
  USING gin (search_vector);

COMMENT ON COLUMN public.email_threads.search_vector IS
  'FTS document for subject, participants, lead identity/company, campaign name, thread tags.';

CREATE OR REPLACE FUNCTION public.build_email_thread_search_vector(p_thread_id uuid)
RETURNS tsvector
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    setweight(to_tsvector('simple', coalesce(t.subject, '')), 'A')
    || setweight(
      to_tsvector(
        'simple',
        coalesce(l.name, '') || ' ' ||
        coalesce(l.first_name, '') || ' ' ||
        coalesce(l.last_name, '')
      ),
      'A'
    )
    || setweight(
      to_tsvector(
        'simple',
        coalesce(l.email, '') || ' ' ||
        coalesce(array_to_string(t.participants, ' '), '') || ' ' ||
        coalesce(l.company_name, '')
      ),
      'B'
    )
    || setweight(
      to_tsvector(
        'simple',
        coalesce(c.name, '') || ' ' ||
        coalesce(
          (
            SELECT string_agg(tt.name, ' ')
            FROM public.thread_tag_assignments tta
            JOIN public.thread_tags tt ON tt.id = tta.tag_id
            WHERE tta.thread_id = t.id
          ),
          ''
        )
      ),
      'C'
    )
  FROM public.email_threads t
  LEFT JOIN public.leads l ON l.id = t.lead_id
  LEFT JOIN public.campaigns c ON c.id = t.campaign_id
  WHERE t.id = p_thread_id;
$$;

CREATE OR REPLACE FUNCTION public.refresh_email_thread_search_vector(p_thread_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.email_threads
  SET search_vector = public.build_email_thread_search_vector(p_thread_id)
  WHERE id = p_thread_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.build_email_thread_search_vector(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.build_email_thread_search_vector(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_email_thread_search_vector(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_email_thread_search_vector(uuid) TO service_role;

-- After insert/update of searchable thread fields: refresh vector from committed row.
CREATE OR REPLACE FUNCTION public.trg_email_threads_refresh_search_vector_after()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.refresh_email_thread_search_vector(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_email_threads_search_vector_before ON public.email_threads;
DROP TRIGGER IF EXISTS trg_email_threads_search_vector_after_insert ON public.email_threads;
DROP TRIGGER IF EXISTS trg_email_threads_search_vector_after ON public.email_threads;
CREATE TRIGGER trg_email_threads_search_vector_after
  AFTER INSERT OR UPDATE OF subject, participants, lead_id, campaign_id
  ON public.email_threads
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_email_threads_refresh_search_vector_after();

-- Lead identity changes → refresh linked threads
CREATE OR REPLACE FUNCTION public.trg_leads_refresh_thread_search_vectors()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND (
       NEW.name IS DISTINCT FROM OLD.name
       OR NEW.first_name IS DISTINCT FROM OLD.first_name
       OR NEW.last_name IS DISTINCT FROM OLD.last_name
       OR NEW.email IS DISTINCT FROM OLD.email
       OR NEW.company_name IS DISTINCT FROM OLD.company_name
     )
  THEN
    UPDATE public.email_threads t
    SET search_vector = public.build_email_thread_search_vector(t.id)
    WHERE t.lead_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_leads_thread_search_vector ON public.leads;
CREATE TRIGGER trg_leads_thread_search_vector
  AFTER UPDATE OF name, first_name, last_name, email, company_name
  ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_leads_refresh_thread_search_vectors();

-- Campaign rename → refresh threads
CREATE OR REPLACE FUNCTION public.trg_campaigns_refresh_thread_search_vectors()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE public.email_threads t
    SET search_vector = public.build_email_thread_search_vector(t.id)
    WHERE t.campaign_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_campaigns_thread_search_vector ON public.campaigns;
CREATE TRIGGER trg_campaigns_thread_search_vector
  AFTER UPDATE OF name
  ON public.campaigns
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_campaigns_refresh_thread_search_vectors();

-- Thread tag assign/unassign
CREATE OR REPLACE FUNCTION public.trg_thread_tag_assignments_refresh_search_vector()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_thread_id uuid;
BEGIN
  v_thread_id := COALESCE(NEW.thread_id, OLD.thread_id);
  PERFORM public.refresh_email_thread_search_vector(v_thread_id);
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_thread_tag_assignments_search_vector ON public.thread_tag_assignments;
CREATE TRIGGER trg_thread_tag_assignments_search_vector
  AFTER INSERT OR DELETE ON public.thread_tag_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_thread_tag_assignments_refresh_search_vector();

-- Thread tag rename
CREATE OR REPLACE FUNCTION public.trg_thread_tags_refresh_search_vectors()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE public.email_threads t
    SET search_vector = public.build_email_thread_search_vector(t.id)
    WHERE t.id IN (
      SELECT tta.thread_id
      FROM public.thread_tag_assignments tta
      WHERE tta.tag_id = NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_thread_tags_search_vector ON public.thread_tags;
CREATE TRIGGER trg_thread_tags_search_vector
  AFTER UPDATE OF name
  ON public.thread_tags
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_thread_tags_refresh_search_vectors();

-- ---------------------------------------------------------------------------
-- 4. Backfill thread search vectors
-- ---------------------------------------------------------------------------
UPDATE public.email_threads t
SET search_vector = public.build_email_thread_search_vector(t.id)
WHERE t.search_vector IS NULL;

-- ---------------------------------------------------------------------------
-- 5. list_account_inbox_threads
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_account_inbox_threads(
  p_account_id uuid,
  p_search text DEFAULT NULL,
  p_mailbox_id uuid DEFAULT NULL,
  p_campaign_ids uuid[] DEFAULT NULL,
  p_unread_only boolean DEFAULT false,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL,
  p_tag_ids uuid[] DEFAULT NULL,
  p_category text DEFAULT NULL,
  p_conversation_status text DEFAULT NULL,
  p_has_reply_only boolean DEFAULT true,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  account_id uuid,
  campaign_id uuid,
  lead_id uuid,
  enrollment_id uuid,
  message_job_id uuid,
  mailbox_id uuid,
  smartlead_lead_id bigint,
  subject text,
  participants text[],
  last_message_at timestamptz,
  message_count integer,
  has_reply boolean,
  category text,
  category_source text,
  conversation_status text,
  conversation_status_source text,
  classification_status text,
  classification_requested_at timestamptz,
  classification_completed_at timestamptz,
  handling_metadata jsonb,
  out_of_office boolean,
  ooo_resume_requested boolean,
  ooo_resume_at timestamptz,
  ooo_resume_processed_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  total_count bigint,
  search_rank real
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_query tsquery;
  v_search text := NULLIF(btrim(COALESCE(p_search, '')), '');
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_campaign_ids uuid[] := COALESCE(p_campaign_ids, ARRAY[]::uuid[]);
  v_tag_ids uuid[] := COALESCE(p_tag_ids, ARRAY[]::uuid[]);
  v_no_category boolean := p_category IN ('__no_category__', 'no_category');
BEGIN
  IF v_search IS NOT NULL THEN
    v_query := public.inbox_search_to_tsquery(v_search);
  END IF;

  RETURN QUERY
  WITH unread_thread_ids AS (
    SELECT DISTINCT m.thread_id
    FROM public.email_messages m
    JOIN public.email_threads ut ON ut.id = m.thread_id
    WHERE COALESCE(p_unread_only, false)
      AND ut.account_id = p_account_id
      AND m.direction = 'received'
      AND m.read_at IS NULL
  ),
  tag_thread_ids AS (
    SELECT DISTINCT tta.thread_id
    FROM public.thread_tag_assignments tta
    WHERE cardinality(v_tag_ids) > 0
      AND tta.tag_id = ANY (v_tag_ids)
  ),
  filtered AS (
    SELECT
      t.id,
      t.account_id,
      t.campaign_id,
      t.lead_id,
      t.enrollment_id,
      t.message_job_id,
      t.mailbox_id,
      t.smartlead_lead_id,
      t.subject,
      t.participants,
      t.last_message_at,
      t.message_count,
      t.has_reply,
      t.category,
      t.category_source,
      t.conversation_status,
      t.conversation_status_source,
      t.classification_status,
      t.classification_requested_at,
      t.classification_completed_at,
      t.handling_metadata,
      t.out_of_office,
      t.ooo_resume_requested,
      t.ooo_resume_at,
      t.ooo_resume_processed_at,
      t.created_at,
      t.updated_at,
      CASE
        WHEN v_query IS NULL THEN 0::real
        ELSE GREATEST(
          coalesce(ts_rank_cd(t.search_vector, v_query), 0::real),
          coalesce(
            (
              SELECT max(ts_rank_cd(m.search_vector, v_query))
              FROM public.email_messages m
              WHERE m.thread_id = t.id
                AND m.search_vector @@ v_query
            ),
            0::real
          )
        )
      END AS rank
    FROM public.email_threads t
    WHERE t.account_id = p_account_id
      AND (NOT COALESCE(p_has_reply_only, true) OR t.has_reply = true)
      AND (p_mailbox_id IS NULL OR t.mailbox_id = p_mailbox_id)
      AND (cardinality(v_campaign_ids) = 0 OR t.campaign_id = ANY (v_campaign_ids))
      AND (
        p_conversation_status IS NULL
        OR p_conversation_status = 'all'
        OR t.conversation_status = p_conversation_status
      )
      AND (p_date_from IS NULL OR t.last_message_at >= p_date_from)
      AND (p_date_to IS NULL OR t.last_message_at <= p_date_to)
      AND (
        NOT v_no_category
        OR t.category IS NULL
      )
      AND (
        v_no_category
        OR p_category IS NULL
        OR t.category = p_category
      )
      AND (
        NOT COALESCE(p_unread_only, false)
        OR t.id IN (SELECT thread_id FROM unread_thread_ids)
      )
      AND (
        cardinality(v_tag_ids) = 0
        OR t.id IN (SELECT thread_id FROM tag_thread_ids)
      )
      AND (
        v_query IS NULL
        OR t.search_vector @@ v_query
        OR EXISTS (
          SELECT 1
          FROM public.email_messages m
          WHERE m.thread_id = t.id
            AND m.search_vector @@ v_query
        )
      )
  )
  SELECT
    f.id,
    f.account_id,
    f.campaign_id,
    f.lead_id,
    f.enrollment_id,
    f.message_job_id,
    f.mailbox_id,
    f.smartlead_lead_id,
    f.subject,
    f.participants,
    f.last_message_at,
    f.message_count,
    f.has_reply,
    f.category,
    f.category_source,
    f.conversation_status,
    f.conversation_status_source,
    f.classification_status,
    f.classification_requested_at,
    f.classification_completed_at,
    f.handling_metadata,
    f.out_of_office,
    f.ooo_resume_requested,
    f.ooo_resume_at,
    f.ooo_resume_processed_at,
    f.created_at,
    f.updated_at,
    count(*) OVER ()::bigint AS total_count,
    f.rank AS search_rank
  FROM filtered f
  ORDER BY
    CASE WHEN v_query IS NOT NULL THEN f.rank ELSE NULL END DESC NULLS LAST,
    f.conversation_status DESC,
    f.last_message_at DESC
  LIMIT v_limit
  OFFSET v_offset;
END;
$$;

COMMENT ON FUNCTION public.list_account_inbox_threads IS
  'List inbox threads with filters and optional FTS across subject, participants, lead, campaign, tags, and message bodies.';

GRANT EXECUTE ON FUNCTION public.list_account_inbox_threads(
  uuid, text, uuid, uuid[], boolean, timestamptz, timestamptz, uuid[], text, text, boolean, integer, integer
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_account_inbox_threads(
  uuid, text, uuid, uuid[], boolean, timestamptz, timestamptz, uuid[], text, text, boolean, integer, integer
) TO service_role;
