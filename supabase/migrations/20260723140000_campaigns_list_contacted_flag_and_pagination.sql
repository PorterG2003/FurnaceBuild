-- ============================================
-- Campaigns list performance:
-- 1) enrollments.has_been_contacted (set-once on first campaign send)
-- 2) backfill_enrollment_has_been_contacted_batch
-- 3) rewrite campaigns_list_summary (flag-based contacted + filters + keyset page)
-- ============================================

-- 1. Contacted flag on enrollments
ALTER TABLE public.enrollments
  ADD COLUMN IF NOT EXISTS has_been_contacted boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.enrollments.has_been_contacted IS
  'True once this enrollment has had at least one sent campaign email. Set-once; used by campaigns_list_summary completion dial.';

-- 2. Set flag on first campaign send (same txn as sent event + sent_count)
CREATE OR REPLACE FUNCTION public.record_sent_event_and_increment(
  p_campaign_id UUID,
  p_lead_id UUID,
  p_enrollment_id UUID,
  p_message_job_id UUID,
  p_event_data JSONB DEFAULT '{}'
)
RETURNS void AS $$
DECLARE
  v_account_id UUID;
BEGIN
  SELECT account_id INTO v_account_id FROM public.campaigns WHERE id = p_campaign_id;
  IF v_account_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.events (campaign_id, account_id, lead_id, enrollment_id, message_job_id, event_type, event_data)
  VALUES (p_campaign_id, v_account_id, p_lead_id, p_enrollment_id, p_message_job_id, 'sent', COALESCE(p_event_data, '{}'));

  INSERT INTO public.campaign_stats (campaign_id, account_id, sent_count, replied_count, positive_reply_count, bounce_count, updated_at)
  VALUES (p_campaign_id, v_account_id, 1, 0, 0, 0, NOW())
  ON CONFLICT (campaign_id) DO UPDATE SET
    sent_count = public.campaign_stats.sent_count + 1,
    updated_at = NOW();

  IF p_enrollment_id IS NOT NULL THEN
    UPDATE public.enrollments
    SET has_been_contacted = true
    WHERE id = p_enrollment_id
      AND has_been_contacted = false;
  END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.record_sent_event_and_increment(uuid, uuid, uuid, uuid, jsonb) IS
  'Insert sent event, increment campaign_stats.sent_count, and set enrollments.has_been_contacted once. Used by send worker.';

-- 3. Batched backfill matching get_campaign_contacted_counts definition
DROP FUNCTION IF EXISTS public.backfill_enrollment_has_been_contacted_batch(int);
CREATE OR REPLACE FUNCTION public.backfill_enrollment_has_been_contacted_batch(
  p_limit int DEFAULT 500,
  p_campaign_id uuid DEFAULT NULL
)
RETURNS int
LANGUAGE plpgsql
AS $$
DECLARE
  v_updated int;
  v_limit int := GREATEST(COALESCE(p_limit, 500), 1);
BEGIN
  WITH to_update AS (
    SELECT e.id
    FROM public.enrollments e
    WHERE e.has_been_contacted = false
      AND (p_campaign_id IS NULL OR e.campaign_id = p_campaign_id)
      AND EXISTS (
        SELECT 1
        FROM public.message_jobs mj
        WHERE mj.enrollment_id = e.id
          AND mj.status = 'sent'
          AND (mj.message_type = 'campaign' OR mj.message_type IS NULL)
      )
    LIMIT v_limit
  )
  UPDATE public.enrollments e
  SET has_been_contacted = true
  FROM to_update t
  WHERE e.id = t.id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

COMMENT ON FUNCTION public.backfill_enrollment_has_been_contacted_batch(int, uuid) IS
  'Mark up to p_limit enrollments has_been_contacted when they have a sent campaign message_job. Optional p_campaign_id scopes the batch. Idempotent; used by backfill script.';

REVOKE ALL ON FUNCTION public.backfill_enrollment_has_been_contacted_batch(int, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.backfill_enrollment_has_been_contacted_batch(int, uuid) TO service_role;

-- 4. Rewrite list RPC: enrollment-flag contacted + server filters + keyset pagination
DROP FUNCTION IF EXISTS public.campaigns_list_summary(uuid);

CREATE OR REPLACE FUNCTION public.campaigns_list_summary(
  p_account_id uuid,
  p_search text DEFAULT NULL,
  p_statuses text[] DEFAULT NULL,
  p_tag_ids uuid[] DEFAULT NULL,
  p_limit int DEFAULT NULL,
  p_cursor_created_at timestamptz DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  name text,
  status text,
  created_at timestamptz,
  source text,
  has_flow boolean,
  sent_count int,
  replied_count int,
  positive_reply_count int,
  bounce_count int,
  enrollment_count int,
  terminal_enrollment_count int,
  contacted_enrollment_count int
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_search text := NULLIF(btrim(COALESCE(p_search, '')), '');
BEGIN
  IF p_account_id IS NULL THEN
    RAISE EXCEPTION 'p_account_id is required';
  END IF;

  IF auth.uid() IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.account_users au
      WHERE au.user_id = auth.uid()
        AND au.account_id = p_account_id
    ) THEN
      RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT
      c.id,
      c.name,
      c.status,
      c.created_at,
      c.source,
      (
        c.flow_data IS NOT NULL
        AND jsonb_typeof((c.flow_data)::jsonb -> 'nodes') = 'array'
        AND jsonb_array_length((c.flow_data)::jsonb -> 'nodes') > 0
      ) AS has_flow
    FROM public.campaigns c
    WHERE c.account_id = p_account_id
      AND c.deleted_at IS NULL
      AND (v_search IS NULL OR c.name ILIKE '%' || v_search || '%')
      AND (
        p_statuses IS NULL
        OR cardinality(p_statuses) = 0
        OR c.status::text = ANY (p_statuses)
      )
      AND (
        p_tag_ids IS NULL
        OR cardinality(p_tag_ids) = 0
        OR EXISTS (
          SELECT 1
          FROM public.campaign_tag_assignments a
          WHERE a.campaign_id = c.id
            AND a.tag_id = ANY (p_tag_ids)
        )
      )
      AND (
        p_cursor_created_at IS NULL
        OR p_cursor_id IS NULL
        OR (c.created_at, c.id) < (p_cursor_created_at, p_cursor_id)
      )
    ORDER BY c.created_at DESC, c.id DESC
    LIMIT CASE WHEN p_limit IS NULL THEN NULL ELSE GREATEST(p_limit, 0) END
  ),
  enrollment_agg AS (
    SELECT
      e.campaign_id,
      COUNT(*)::int AS enrollment_count,
      COUNT(*) FILTER (WHERE e.state IN ('stopped', 'completed'))::int AS terminal_enrollment_count,
      COUNT(*) FILTER (WHERE e.has_been_contacted)::int AS contacted_enrollment_count
    FROM public.enrollments e
    INNER JOIN base b ON b.id = e.campaign_id
    WHERE e.deleted_at IS NULL
    GROUP BY e.campaign_id
  )
  SELECT
    b.id,
    b.name,
    b.status::text,
    b.created_at,
    b.source::text,
    b.has_flow,
    COALESCE(cs.sent_count, 0)::int,
    COALESCE(cs.replied_count, 0)::int,
    COALESCE(cs.positive_reply_count, 0)::int,
    COALESCE(cs.bounce_count, 0)::int,
    COALESCE(ea.enrollment_count, 0)::int,
    COALESCE(ea.terminal_enrollment_count, 0)::int,
    COALESCE(ea.contacted_enrollment_count, 0)::int
  FROM base b
  LEFT JOIN public.campaign_stats cs ON cs.campaign_id = b.id
  LEFT JOIN enrollment_agg ea ON ea.campaign_id = b.id
  ORDER BY b.created_at DESC, b.id DESC;
END;
$$;

COMMENT ON FUNCTION public.campaigns_list_summary(uuid, text, text[], uuid[], int, timestamptz, uuid) IS
  'Campaigns list: filtered/paginated rows with list columns and aggregates. Contacted uses enrollments.has_been_contacted (no message_jobs scan). p_limit NULL = all matching rows.';

REVOKE ALL ON FUNCTION public.campaigns_list_summary(uuid, text, text[], uuid[], int, timestamptz, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.campaigns_list_summary(uuid, text, text[], uuid[], int, timestamptz, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.campaigns_list_summary(uuid, text, text[], uuid[], int, timestamptz, uuid) TO service_role;
