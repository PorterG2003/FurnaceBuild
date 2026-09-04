-- Multi-select category filter for Master Inbox.
-- p_category changes from text to text[] (OR match, including no-category sentinels).

DROP FUNCTION IF EXISTS public.list_account_inbox_threads(
  uuid,
  text,
  uuid,
  uuid[],
  boolean,
  timestamptz,
  timestamptz,
  uuid[],
  text,
  text,
  boolean,
  integer,
  integer,
  text
);

CREATE FUNCTION public.list_account_inbox_threads(
  p_account_id uuid,
  p_search text DEFAULT NULL,
  p_mailbox_id uuid DEFAULT NULL,
  p_campaign_ids uuid[] DEFAULT NULL,
  p_unread_only boolean DEFAULT false,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL,
  p_tag_ids uuid[] DEFAULT NULL,
  p_category text[] DEFAULT NULL,
  p_conversation_status text DEFAULT NULL,
  p_has_reply_only boolean DEFAULT true,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_sort text DEFAULT 'newest'
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
  last_inbound_at timestamptz,
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
#variable_conflict use_column
DECLARE
  v_query tsquery;
  v_search text := NULLIF(btrim(COALESCE(p_search, '')), '');
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_campaign_ids uuid[] := COALESCE(p_campaign_ids, ARRAY[]::uuid[]);
  v_tag_ids uuid[] := COALESCE(p_tag_ids, ARRAY[]::uuid[]);
  v_categories text[] := ARRAY(
    SELECT NULLIF(btrim(c), '')
    FROM unnest(COALESCE(p_category, ARRAY[]::text[])) AS c
    WHERE NULLIF(btrim(c), '') IS NOT NULL
  );
  v_named text[] := ARRAY(
    SELECT c
    FROM unnest(v_categories) AS c
    WHERE c NOT IN ('__no_category__', 'no_category')
  );
  v_no_category boolean := EXISTS (
    SELECT 1
    FROM unnest(v_categories) AS c
    WHERE c IN ('__no_category__', 'no_category')
  );
  v_sort text := lower(NULLIF(btrim(COALESCE(p_sort, '')), ''));
BEGIN
  IF v_sort IS NULL OR v_sort NOT IN ('open_first', 'newest', 'oldest', 'unread_first') THEN
    v_sort := 'newest';
  END IF;

  IF v_search IS NOT NULL THEN
    v_query := public.inbox_search_to_tsquery(v_search);
  END IF;

  RETURN QUERY
  WITH unread_thread_ids AS (
    SELECT DISTINCT m.thread_id
    FROM public.email_messages m
    JOIN public.email_threads ut ON ut.id = m.thread_id
    WHERE ut.account_id = p_account_id
      AND m.direction = 'received'
      AND m.read_at IS NULL
      AND (
        COALESCE(p_unread_only, false)
        OR v_sort = 'unread_first'
      )
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
      t.last_inbound_at,
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
      EXISTS (
        SELECT 1
        FROM unread_thread_ids u
        WHERE u.thread_id = t.id
      ) AS has_unread,
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
      AND (p_date_from IS NULL OR t.last_inbound_at >= p_date_from)
      AND (p_date_to IS NULL OR t.last_inbound_at <= p_date_to)
      AND (
        cardinality(v_categories) = 0
        OR (v_no_category AND t.category IS NULL)
        OR (cardinality(v_named) > 0 AND t.category = ANY (v_named))
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
    f.last_inbound_at,
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
    CASE WHEN v_sort = 'open_first' THEN f.conversation_status END DESC NULLS LAST,
    CASE WHEN v_sort = 'unread_first' THEN CASE WHEN f.has_unread THEN 1 ELSE 0 END END DESC NULLS LAST,
    CASE WHEN v_sort = 'oldest' THEN f.last_inbound_at END ASC NULLS LAST,
    CASE WHEN v_sort <> 'oldest' THEN f.last_inbound_at END DESC NULLS LAST,
    f.id ASC
  LIMIT v_limit
  OFFSET v_offset;
END;
$$;

COMMENT ON FUNCTION public.list_account_inbox_threads IS
  'List inbox threads with filters, optional FTS, and sort. Newest/Oldest and date filters use last_inbound_at (lead reply time). p_category is text[] (OR match; __no_category__/no_category include uncategorized).';

GRANT EXECUTE ON FUNCTION public.list_account_inbox_threads(
  uuid, text, uuid, uuid[], boolean, timestamptz, timestamptz, uuid[], text[], text, boolean, integer, integer, text
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_account_inbox_threads(
  uuid, text, uuid, uuid[], boolean, timestamptz, timestamptz, uuid[], text[], text, boolean, integer, integer, text
) TO service_role;
