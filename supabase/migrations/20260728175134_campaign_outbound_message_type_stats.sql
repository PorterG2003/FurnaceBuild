-- Canonical campaign-outbound message-type helpers + rewrite drifted stats/contacted RPCs.
-- Aligns SQL with send-worker isCampaignMessageJob / isPriorityCampaignJob.

CREATE OR REPLACE FUNCTION public.is_campaign_outbound_message_type(t text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT t IS NULL OR t NOT IN ('inbox_reply', 'inbox_forward');
$$;

COMMENT ON FUNCTION public.is_campaign_outbound_message_type(text) IS
  'True for paced campaign and priority/auto-reply sends; false for inbox_reply/inbox_forward. Matches send-worker isCampaignMessageJob.';

CREATE OR REPLACE FUNCTION public.is_paced_campaign_message_type(t text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT t IS NULL OR t = 'campaign';
$$;

COMMENT ON FUNCTION public.is_paced_campaign_message_type(text) IS
  'True for scheduler-paced campaign sends only (not campaign_priority / campaign_reply). Used for reply/interested attribution on variant stats.';

REVOKE ALL ON FUNCTION public.is_campaign_outbound_message_type(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_campaign_outbound_message_type(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_campaign_outbound_message_type(text) TO service_role;

REVOKE ALL ON FUNCTION public.is_paced_campaign_message_type(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_paced_campaign_message_type(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_paced_campaign_message_type(text) TO service_role;

-- ---------------------------------------------------------------------------
-- Variant stats: sent/bounce = outbound; replied/positive = paced only
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_campaign_variant_stats(p_campaign_id UUID)
RETURNS TABLE (
  node_id UUID,
  variant_id UUID,
  sent_count BIGINT,
  replied_count BIGINT,
  positive_reply_count BIGINT,
  bounce_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  WITH sent AS (
    SELECT mj.node_id, mj.variant_id, COUNT(*)::BIGINT AS c
    FROM message_jobs mj
    WHERE mj.campaign_id = p_campaign_id
      AND mj.status = 'sent'
      AND public.is_campaign_outbound_message_type(mj.message_type)
      AND mj.variant_id IS NOT NULL
    GROUP BY mj.node_id, mj.variant_id
  ),
  replied AS (
    SELECT mj.node_id, mj.variant_id, COUNT(*)::BIGINT AS c
    FROM events e
    INNER JOIN message_jobs mj ON mj.id = e.message_job_id
    WHERE e.campaign_id = p_campaign_id
      AND e.event_type = 'replied'
      AND mj.variant_id IS NOT NULL
      AND public.is_paced_campaign_message_type(mj.message_type)
    GROUP BY mj.node_id, mj.variant_id
  ),
  pos AS (
    SELECT mj.node_id, mj.variant_id, COUNT(*)::BIGINT AS c
    FROM events e
    INNER JOIN message_jobs mj ON mj.id = e.message_job_id
    WHERE e.campaign_id = p_campaign_id
      AND e.event_type = 'replied'
      AND COALESCE((e.event_data->>'is_positive')::boolean, false) = true
      AND mj.variant_id IS NOT NULL
      AND public.is_paced_campaign_message_type(mj.message_type)
    GROUP BY mj.node_id, mj.variant_id
  ),
  bnc AS (
    SELECT mj.node_id, mj.variant_id, COUNT(*)::BIGINT AS c
    FROM events e
    INNER JOIN message_jobs mj ON mj.id = e.message_job_id
    WHERE e.campaign_id = p_campaign_id
      AND e.event_type = 'bounced'
      AND mj.variant_id IS NOT NULL
      AND public.is_campaign_outbound_message_type(mj.message_type)
    GROUP BY mj.node_id, mj.variant_id
  ),
  keys AS (
    SELECT s.node_id, s.variant_id FROM sent s
    UNION
    SELECT r.node_id, r.variant_id FROM replied r
    UNION
    SELECT p.node_id, p.variant_id FROM pos p
    UNION
    SELECT b.node_id, b.variant_id FROM bnc b
  )
  SELECT
    k.node_id,
    k.variant_id,
    COALESCE(s.c, 0::BIGINT),
    COALESCE(r.c, 0::BIGINT),
    COALESCE(p.c, 0::BIGINT),
    COALESCE(b.c, 0::BIGINT)
  FROM keys k
  LEFT JOIN sent s ON s.node_id = k.node_id AND s.variant_id = k.variant_id
  LEFT JOIN replied r ON r.node_id = k.node_id AND r.variant_id = k.variant_id
  LEFT JOIN pos p ON p.node_id = k.node_id AND p.variant_id = k.variant_id
  LEFT JOIN bnc b ON b.node_id = k.node_id AND b.variant_id = k.variant_id;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_campaign_variant_stats IS
  'Per node/variant: sent+bounce from outbound jobs (incl. priority); replied+positive from paced campaign jobs only (pre-categorizer attribution).';

-- ---------------------------------------------------------------------------
-- Reconcile: sent must include priority or live totals drift downward
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION reconcile_campaign_stats(p_campaign_id UUID DEFAULT NULL)
RETURNS INT AS $$
DECLARE
  v_updated INT;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    IF p_campaign_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM campaigns c
      WHERE c.id = p_campaign_id
        AND c.account_id IN (SELECT account_id FROM account_users WHERE user_id = auth.uid())
    ) THEN
      RETURN 0;
    END IF;
  END IF;

  UPDATE campaign_stats cs
  SET
    sent_count = COALESCE((
      SELECT COUNT(*)::int
      FROM message_jobs mj
      WHERE mj.campaign_id = cs.campaign_id
        AND mj.status = 'sent'
        AND public.is_campaign_outbound_message_type(mj.message_type)
    ), 0),
    replied_count = COALESCE((
      SELECT COUNT(*)::int
      FROM email_threads et
      WHERE et.campaign_id = cs.campaign_id
        AND et.has_reply = true
    ), 0),
    positive_reply_count = COALESCE((
      SELECT COUNT(*)::int
      FROM email_threads et
      WHERE et.campaign_id = cs.campaign_id
        AND et.has_reply = true
        AND et.category = 'Interested'
    ), 0),
    bounce_count = COALESCE((
      SELECT COUNT(*)::int
      FROM events e
      WHERE e.campaign_id = cs.campaign_id
        AND e.event_type = 'bounced'
    ), 0),
    last_bounce_at = (
      SELECT MAX(e.created_at)
      FROM events e
      WHERE e.campaign_id = cs.campaign_id
        AND e.event_type = 'bounced'
    ),
    updated_at = NOW()
  WHERE (p_campaign_id IS NULL OR cs.campaign_id = p_campaign_id)
    AND (auth.uid() IS NULL OR cs.account_id IN (SELECT account_id FROM account_users WHERE user_id = auth.uid()));

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

COMMENT ON FUNCTION reconcile_campaign_stats IS
  'Recompute campaign_stats from message_jobs (outbound sent incl. priority), email_threads (replied/positive), events (bounce).';

-- ---------------------------------------------------------------------------
-- Contacted counts / lead ids / progress: outbound includes priority
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_campaign_contacted_counts(p_campaign_ids UUID[])
RETURNS TABLE(campaign_id UUID, contacted_count INT) AS $$
BEGIN
  RETURN QUERY
    SELECT mj.campaign_id, COUNT(DISTINCT mj.enrollment_id)::int AS contacted_count
    FROM message_jobs mj
    INNER JOIN campaigns c
      ON c.id = mj.campaign_id
     AND c.deleted_at IS NULL
     AND (auth.uid() IS NULL OR c.account_id IN (SELECT account_id FROM account_users WHERE user_id = auth.uid()))
    INNER JOIN enrollments e
      ON e.id = mj.enrollment_id
     AND e.deleted_at IS NULL
    WHERE mj.campaign_id = ANY(p_campaign_ids)
      AND mj.status = 'sent'
      AND public.is_campaign_outbound_message_type(mj.message_type)
    GROUP BY mj.campaign_id;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

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
          AND public.is_campaign_outbound_message_type(mj.message_type)
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
  'Mark up to p_limit enrollments has_been_contacted when they have a sent outbound campaign message_job (incl. priority). Optional p_campaign_id scopes the batch.';

CREATE OR REPLACE FUNCTION public.enrollment_progress_state(
  p_enrollment_state text,
  p_enrollment_id uuid
) RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_enrollment_state IS NULL THEN 'not_started'
    WHEN p_enrollment_state IN ('paused', 'completed', 'stopped') THEN p_enrollment_state
    WHEN p_enrollment_state = 'active' AND EXISTS (
      SELECT 1
      FROM public.message_jobs mj
      INNER JOIN public.enrollments e
        ON e.id = mj.enrollment_id
       AND e.deleted_at IS NULL
      WHERE mj.enrollment_id = p_enrollment_id
        AND mj.status = 'sent'
        AND public.is_campaign_outbound_message_type(mj.message_type)
    ) THEN 'active'
    WHEN p_enrollment_state = 'active' THEN 'not_started'
    ELSE 'not_started'
  END;
$$;

COMMENT ON FUNCTION public.enrollment_progress_state(text, uuid) IS
  'User-facing enrollment progress bucket: active without sent outbound campaign email is not_started.';

CREATE OR REPLACE FUNCTION public.get_campaign_contacted_lead_ids(p_campaign_id uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(DISTINCT e.lead_id), ARRAY[]::uuid[])
  FROM public.enrollments e
  INNER JOIN public.campaigns c ON c.id = e.campaign_id
  INNER JOIN public.message_jobs mj
    ON mj.enrollment_id = e.id
   AND mj.status = 'sent'
   AND public.is_campaign_outbound_message_type(mj.message_type)
  WHERE e.campaign_id = p_campaign_id
    AND e.deleted_at IS NULL
    AND e.lead_id IS NOT NULL
    AND c.deleted_at IS NULL
    AND (
      auth.uid() IS NULL
      OR c.account_id IN (SELECT account_id FROM public.account_users WHERE user_id = auth.uid())
    );
$$;

COMMENT ON FUNCTION public.get_campaign_contacted_lead_ids(uuid) IS
  'Lead ids with at least one sent outbound campaign email (incl. priority) for filter scoping on campaign detail.';
