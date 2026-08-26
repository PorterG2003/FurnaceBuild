-- Campaign details: flag-based progress RPCs + increment-on-write variant stats cache.
-- Reads never scan message_jobs/events. Rebuilds are migrate/ops only.

-- ---------------------------------------------------------------------------
-- Progress: has_been_contacted, not EXISTS on message_jobs
-- ---------------------------------------------------------------------------
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
      FROM public.enrollments e
      WHERE e.id = p_enrollment_id
        AND e.deleted_at IS NULL
        AND e.has_been_contacted
    ) THEN 'active'
    WHEN p_enrollment_state = 'active' THEN 'not_started'
    ELSE 'not_started'
  END;
$$;

COMMENT ON FUNCTION public.enrollment_progress_state(text, uuid) IS
  'User-facing enrollment progress bucket: active without has_been_contacted is not_started.';

CREATE OR REPLACE FUNCTION public.get_campaign_lead_progress_buckets(p_campaign_id uuid)
RETURNS TABLE (
  total_leads int,
  not_started int,
  in_progress int,
  paused int,
  completed int,
  stopped int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH campaign_leads AS (
    SELECT l.id AS lead_id
    FROM public.leads l
    INNER JOIN public.campaigns c ON c.id = l.campaign_id
    WHERE l.campaign_id = p_campaign_id
      AND l.deleted_at IS NULL
      AND c.deleted_at IS NULL
      AND (
        auth.uid() IS NULL
        OR c.account_id IN (SELECT account_id FROM public.account_users WHERE user_id = auth.uid())
      )
  ),
  lead_buckets AS (
    SELECT
      CASE
        WHEN e.id IS NULL THEN 'not_started'
        WHEN e.state IN ('paused', 'completed', 'stopped') THEN e.state
        WHEN e.state = 'active' AND e.has_been_contacted THEN 'active'
        ELSE 'not_started'
      END AS bucket
    FROM campaign_leads cl
    LEFT JOIN public.enrollments e
      ON e.lead_id = cl.lead_id
     AND e.campaign_id = p_campaign_id
     AND e.deleted_at IS NULL
  )
  SELECT
    COUNT(*)::int AS total_leads,
    COUNT(*) FILTER (WHERE bucket = 'not_started')::int AS not_started,
    COUNT(*) FILTER (WHERE bucket = 'active')::int AS in_progress,
    COUNT(*) FILTER (WHERE bucket = 'paused')::int AS paused,
    COUNT(*) FILTER (WHERE bucket = 'completed')::int AS completed,
    COUNT(*) FILTER (WHERE bucket = 'stopped')::int AS stopped
  FROM lead_buckets;
$$;

COMMENT ON FUNCTION public.get_campaign_lead_progress_buckets(uuid) IS
  'Campaign detail lead progress dial; set-based on enrollments.state + has_been_contacted.';

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
  WHERE e.campaign_id = p_campaign_id
    AND e.deleted_at IS NULL
    AND e.has_been_contacted
    AND e.lead_id IS NOT NULL
    AND c.deleted_at IS NULL
    AND (
      auth.uid() IS NULL
      OR c.account_id IN (SELECT account_id FROM public.account_users WHERE user_id = auth.uid())
    );
$$;

COMMENT ON FUNCTION public.get_campaign_contacted_lead_ids(uuid) IS
  'Lead ids with enrollments.has_been_contacted for campaign-detail filter scoping.';

-- ---------------------------------------------------------------------------
-- Daily activity range (chart bootstrap)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.campaign_stats_daily_activity_range(p_campaign_id uuid)
RETURNS TABLE (
  start_date date,
  end_date date
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_campaign_id IS NULL THEN
    RAISE EXCEPTION 'p_campaign_id is required';
  END IF;

  IF auth.uid() IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.campaigns c
      INNER JOIN public.account_users au
        ON au.account_id = c.account_id AND au.user_id = auth.uid()
      WHERE c.id = p_campaign_id
        AND c.deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    MIN(d.stat_date),
    MAX(d.stat_date)
  FROM public.campaign_stats_daily d
  WHERE d.campaign_id = p_campaign_id
    AND (
      d.sent_count > 0
      OR d.replied_count > 0
      OR d.positive_reply_count > 0
      OR d.bounce_count > 0
      OR d.leads_first_contacted > 0
    );
END;
$$;

COMMENT ON FUNCTION public.campaign_stats_daily_activity_range(uuid) IS
  'First and last UTC days with any campaign_stats_daily activity. Nulls when the cache has no activity.';

REVOKE ALL ON FUNCTION public.campaign_stats_daily_activity_range(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.campaign_stats_daily_activity_range(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.campaign_stats_daily_activity_range(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- Variant stats cache
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.campaign_variant_stats (
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  node_id uuid NOT NULL,
  variant_id uuid NOT NULL,
  sent_count integer NOT NULL DEFAULT 0,
  replied_count integer NOT NULL DEFAULT 0,
  positive_reply_count integer NOT NULL DEFAULT 0,
  bounce_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (campaign_id, node_id, variant_id)
);

CREATE INDEX IF NOT EXISTS idx_campaign_variant_stats_campaign
  ON public.campaign_variant_stats (campaign_id);

COMMENT ON TABLE public.campaign_variant_stats IS
  'Lifetime per-node/variant counts for campaign details. Incremented by record_* RPCs; rebuilt from jobs/events.';

ALTER TABLE public.campaign_variant_stats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS campaign_variant_stats_select ON public.campaign_variant_stats;
CREATE POLICY campaign_variant_stats_select
  ON public.campaign_variant_stats
  FOR SELECT
  USING (
    account_id IN (SELECT account_id FROM public.account_users WHERE user_id = auth.uid())
  );

GRANT SELECT ON public.campaign_variant_stats TO authenticated;
GRANT ALL ON public.campaign_variant_stats TO service_role;

CREATE OR REPLACE FUNCTION public.increment_campaign_variant_stats(
  p_campaign_id uuid,
  p_account_id uuid,
  p_node_id uuid,
  p_variant_id uuid,
  p_sent integer DEFAULT 0,
  p_replied integer DEFAULT 0,
  p_positive integer DEFAULT 0,
  p_bounce integer DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF p_campaign_id IS NULL OR p_account_id IS NULL OR p_node_id IS NULL OR p_variant_id IS NULL THEN
    RETURN;
  END IF;
  IF COALESCE(p_sent, 0) = 0
     AND COALESCE(p_replied, 0) = 0
     AND COALESCE(p_positive, 0) = 0
     AND COALESCE(p_bounce, 0) = 0 THEN
    RETURN;
  END IF;

  INSERT INTO public.campaign_variant_stats (
    campaign_id,
    account_id,
    node_id,
    variant_id,
    sent_count,
    replied_count,
    positive_reply_count,
    bounce_count,
    updated_at
  )
  VALUES (
    p_campaign_id,
    p_account_id,
    p_node_id,
    p_variant_id,
    GREATEST(0, COALESCE(p_sent, 0)),
    GREATEST(0, COALESCE(p_replied, 0)),
    GREATEST(0, COALESCE(p_positive, 0)),
    GREATEST(0, COALESCE(p_bounce, 0)),
    NOW()
  )
  ON CONFLICT (campaign_id, node_id, variant_id) DO UPDATE SET
    sent_count = GREATEST(0, public.campaign_variant_stats.sent_count + COALESCE(p_sent, 0)),
    replied_count = GREATEST(0, public.campaign_variant_stats.replied_count + COALESCE(p_replied, 0)),
    positive_reply_count = GREATEST(0, public.campaign_variant_stats.positive_reply_count + COALESCE(p_positive, 0)),
    bounce_count = GREATEST(0, public.campaign_variant_stats.bounce_count + COALESCE(p_bounce, 0)),
    updated_at = NOW();
END;
$$;

COMMENT ON FUNCTION public.increment_campaign_variant_stats(uuid, uuid, uuid, uuid, integer, integer, integer, integer) IS
  'Upsert deltas onto campaign_variant_stats. Used by record_* stats RPCs.';

REVOKE ALL ON FUNCTION public.increment_campaign_variant_stats(uuid, uuid, uuid, uuid, integer, integer, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_campaign_variant_stats(uuid, uuid, uuid, uuid, integer, integer, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.increment_campaign_variant_stats(uuid, uuid, uuid, uuid, integer, integer, integer, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.increment_campaign_variant_stats_for_job(
  p_campaign_id uuid,
  p_account_id uuid,
  p_message_job_id uuid,
  p_sent integer DEFAULT 0,
  p_replied integer DEFAULT 0,
  p_positive integer DEFAULT 0,
  p_bounce integer DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_node_id uuid;
  v_variant_id uuid;
  v_message_type text;
  v_sent integer;
  v_replied integer;
  v_positive integer;
  v_bounce integer;
BEGIN
  IF p_message_job_id IS NULL THEN
    RETURN;
  END IF;

  SELECT mj.node_id, mj.variant_id, mj.message_type
  INTO v_node_id, v_variant_id, v_message_type
  FROM public.message_jobs mj
  WHERE mj.id = p_message_job_id;

  IF v_node_id IS NULL OR v_variant_id IS NULL THEN
    RETURN;
  END IF;

  v_sent := CASE
    WHEN public.is_campaign_outbound_message_type(v_message_type) THEN COALESCE(p_sent, 0)
    ELSE 0
  END;
  v_bounce := CASE
    WHEN public.is_campaign_outbound_message_type(v_message_type) THEN COALESCE(p_bounce, 0)
    ELSE 0
  END;
  v_replied := CASE
    WHEN public.is_paced_campaign_message_type(v_message_type) THEN COALESCE(p_replied, 0)
    ELSE 0
  END;
  v_positive := CASE
    WHEN public.is_paced_campaign_message_type(v_message_type) THEN COALESCE(p_positive, 0)
    ELSE 0
  END;

  PERFORM public.increment_campaign_variant_stats(
    p_campaign_id,
    p_account_id,
    v_node_id,
    v_variant_id,
    v_sent,
    v_replied,
    v_positive,
    v_bounce
  );
END;
$$;

COMMENT ON FUNCTION public.increment_campaign_variant_stats_for_job(uuid, uuid, uuid, integer, integer, integer, integer) IS
  'Resolve job node/variant/message_type and apply paced vs outbound filters before incrementing campaign_variant_stats.';

REVOKE ALL ON FUNCTION public.increment_campaign_variant_stats_for_job(uuid, uuid, uuid, integer, integer, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_campaign_variant_stats_for_job(uuid, uuid, uuid, integer, integer, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.increment_campaign_variant_stats_for_job(uuid, uuid, uuid, integer, integer, integer, integer) TO service_role;

-- ---------------------------------------------------------------------------
-- Writers
-- ---------------------------------------------------------------------------
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
  v_created_at TIMESTAMPTZ;
  v_first_contacted INT := 0;
BEGIN
  SELECT account_id INTO v_account_id FROM public.campaigns WHERE id = p_campaign_id;
  IF v_account_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.events (campaign_id, account_id, lead_id, enrollment_id, message_job_id, event_type, event_data)
  VALUES (p_campaign_id, v_account_id, p_lead_id, p_enrollment_id, p_message_job_id, 'sent', COALESCE(p_event_data, '{}'))
  RETURNING created_at INTO v_created_at;

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
    IF FOUND THEN
      v_first_contacted := 1;
    END IF;
  END IF;

  PERFORM public.increment_campaign_stats_daily(
    p_campaign_id,
    v_account_id,
    (v_created_at AT TIME ZONE 'UTC')::date,
    1, 0, 0, 0, v_first_contacted
  );

  PERFORM public.increment_campaign_variant_stats_for_job(
    p_campaign_id,
    v_account_id,
    p_message_job_id,
    1, 0, 0, 0
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.record_sent_event_and_increment(uuid, uuid, uuid, uuid, jsonb) IS
  'Insert sent event; increment campaign_stats, campaign_stats_daily, and campaign_variant_stats; set has_been_contacted once.';

CREATE OR REPLACE FUNCTION record_replied_event_and_increment(
  p_campaign_id UUID,
  p_lead_id UUID,
  p_enrollment_id UUID,
  p_message_job_id UUID,
  p_event_data JSONB DEFAULT '{}',
  p_is_positive BOOLEAN DEFAULT false
)
RETURNS BOOLEAN AS $$
DECLARE
  v_account_id UUID;
  v_created_at TIMESTAMPTZ;
BEGIN
  SELECT account_id INTO v_account_id FROM campaigns WHERE id = p_campaign_id;
  IF v_account_id IS NULL THEN
    RETURN false;
  END IF;

  INSERT INTO events (campaign_id, account_id, lead_id, enrollment_id, message_job_id, event_type, event_data)
  VALUES (
    p_campaign_id,
    v_account_id,
    p_lead_id,
    p_enrollment_id,
    p_message_job_id,
    'replied',
    COALESCE(p_event_data, '{}'::jsonb) || jsonb_build_object('is_positive', p_is_positive)
  )
  ON CONFLICT (campaign_id, message_job_id, event_type) WHERE (event_type = 'replied') DO NOTHING
  RETURNING created_at INTO v_created_at;

  IF v_created_at IS NULL THEN
    RETURN false;
  END IF;

  INSERT INTO campaign_stats (campaign_id, account_id, sent_count, replied_count, positive_reply_count, bounce_count, updated_at)
  VALUES (p_campaign_id, v_account_id, 0, 1, CASE WHEN p_is_positive THEN 1 ELSE 0 END, 0, NOW())
  ON CONFLICT (campaign_id) DO UPDATE SET
    replied_count = campaign_stats.replied_count + 1,
    positive_reply_count = campaign_stats.positive_reply_count + CASE WHEN p_is_positive THEN 1 ELSE 0 END,
    updated_at = NOW();

  PERFORM public.increment_campaign_stats_daily(
    p_campaign_id,
    v_account_id,
    (v_created_at AT TIME ZONE 'UTC')::date,
    0, 1, CASE WHEN p_is_positive THEN 1 ELSE 0 END, 0, 0
  );

  PERFORM public.increment_campaign_variant_stats_for_job(
    p_campaign_id,
    v_account_id,
    p_message_job_id,
    0, 1, CASE WHEN p_is_positive THEN 1 ELSE 0 END, 0
  );

  RETURN true;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION record_replied_event_and_increment IS
  'Insert replied event (idempotent); increment campaign_stats, campaign_stats_daily, and campaign_variant_stats when inserted.';

CREATE OR REPLACE FUNCTION record_bounced_event_and_increment(
  p_campaign_id UUID,
  p_lead_id UUID,
  p_enrollment_id UUID,
  p_message_job_id UUID,
  p_mailbox_id UUID,
  p_event_data JSONB DEFAULT '{}'
)
RETURNS BOOLEAN AS $$
DECLARE
  v_account_id UUID;
  v_created_at TIMESTAMPTZ;
  v_bounce_message_id TEXT;
  v_bounce_uid TEXT;
  v_bounce_dedupe_key TEXT;
BEGIN
  SELECT account_id INTO v_account_id FROM campaigns WHERE id = p_campaign_id;
  IF v_account_id IS NULL THEN
    RETURN false;
  END IF;

  v_bounce_message_id := NULLIF(
    regexp_replace(
      lower(trim(COALESCE(p_event_data->>'bounce_message_id', ''))),
      '(^<|>$)',
      '',
      'g'
    ),
    ''
  );
  v_bounce_uid := NULLIF(trim(COALESCE(p_event_data->>'bounce_uid', '')), '');
  v_bounce_dedupe_key := COALESCE(
    CASE WHEN v_bounce_message_id IS NOT NULL THEN 'mid:' || v_bounce_message_id END,
    CASE WHEN v_bounce_uid IS NOT NULL THEN 'uid:' || v_bounce_uid END
  );

  INSERT INTO events (
    campaign_id,
    account_id,
    lead_id,
    enrollment_id,
    message_job_id,
    mailbox_id,
    event_type,
    event_data,
    bounce_dedupe_key
  )
  VALUES (
    p_campaign_id,
    v_account_id,
    p_lead_id,
    p_enrollment_id,
    p_message_job_id,
    p_mailbox_id,
    'bounced',
    COALESCE(p_event_data, '{}'),
    v_bounce_dedupe_key
  )
  ON CONFLICT (mailbox_id, bounce_dedupe_key, event_type)
    WHERE (event_type = 'bounced' AND bounce_dedupe_key IS NOT NULL)
  DO NOTHING
  RETURNING created_at INTO v_created_at;

  IF v_created_at IS NULL THEN
    RETURN false;
  END IF;

  INSERT INTO campaign_stats (
    campaign_id,
    account_id,
    sent_count,
    replied_count,
    positive_reply_count,
    bounce_count,
    last_bounce_at,
    updated_at
  )
  VALUES (p_campaign_id, v_account_id, 0, 0, 0, 1, NOW(), NOW())
  ON CONFLICT (campaign_id) DO UPDATE SET
    bounce_count = campaign_stats.bounce_count + 1,
    last_bounce_at = GREATEST(COALESCE(campaign_stats.last_bounce_at, TIMESTAMPTZ '1970-01-01'), NOW()),
    updated_at = NOW();

  PERFORM public.increment_campaign_stats_daily(
    p_campaign_id,
    v_account_id,
    (v_created_at AT TIME ZONE 'UTC')::date,
    0, 0, 0, 1, 0
  );

  PERFORM public.increment_campaign_variant_stats_for_job(
    p_campaign_id,
    v_account_id,
    p_message_job_id,
    0, 0, 0, 1
  );

  RETURN true;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION record_bounced_event_and_increment IS
  'Insert a bounced event once per mailbox-scoped physical bounce; increment campaign_stats, daily, and variant caches when inserted.';

CREATE OR REPLACE FUNCTION update_replied_event_is_positive(
  p_campaign_id UUID,
  p_message_job_id UUID,
  p_is_positive BOOLEAN
)
RETURNS void AS $$
DECLARE
  v_account_id UUID;
  v_created_at TIMESTAMPTZ;
  v_old BOOLEAN;
  v_new BOOLEAN := COALESCE(p_is_positive, false);
BEGIN
  IF p_campaign_id IS NULL OR p_message_job_id IS NULL THEN
    RETURN;
  END IF;

  SELECT e.account_id, e.created_at, COALESCE((e.event_data->>'is_positive')::boolean, false)
  INTO v_account_id, v_created_at, v_old
  FROM events e
  INNER JOIN campaigns c ON c.id = e.campaign_id
  WHERE e.campaign_id = p_campaign_id
    AND e.message_job_id = p_message_job_id
    AND e.event_type = 'replied'
    AND (
      auth.uid() IS NULL
      OR c.account_id IN (SELECT account_id FROM account_users WHERE user_id = auth.uid())
    );

  IF v_created_at IS NULL THEN
    RETURN;
  END IF;

  UPDATE events e
  SET event_data = event_data || jsonb_build_object('is_positive', v_new)
  FROM campaigns c
  WHERE e.campaign_id = p_campaign_id
    AND e.message_job_id = p_message_job_id
    AND e.event_type = 'replied'
    AND c.id = e.campaign_id
    AND (
      auth.uid() IS NULL
      OR c.account_id IN (SELECT account_id FROM account_users WHERE user_id = auth.uid())
    );

  IF v_old IS DISTINCT FROM v_new THEN
    PERFORM public.increment_campaign_stats_daily(
      p_campaign_id,
      v_account_id,
      (v_created_at AT TIME ZONE 'UTC')::date,
      0, 0, CASE WHEN v_new THEN 1 ELSE -1 END, 0, 0
    );
    PERFORM public.increment_campaign_variant_stats_for_job(
      p_campaign_id,
      v_account_id,
      p_message_job_id,
      0, 0, CASE WHEN v_new THEN 1 ELSE -1 END, 0
    );
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

COMMENT ON FUNCTION update_replied_event_is_positive(UUID, UUID, BOOLEAN) IS
  'Syncs is_positive onto the replied event and adjusts campaign_stats_daily and campaign_variant_stats.';

-- ---------------------------------------------------------------------------
-- Rebuild variant cache from jobs + events (same definition as the former live RPC)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rebuild_campaign_variant_stats(
  p_campaign_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted integer;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    IF p_campaign_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM public.campaigns c
      WHERE c.id = p_campaign_id
        AND c.account_id IN (SELECT account_id FROM public.account_users WHERE user_id = auth.uid())
    ) THEN
      RETURN 0;
    END IF;
  END IF;

  DELETE FROM public.campaign_variant_stats d
  WHERE (p_campaign_id IS NULL OR d.campaign_id = p_campaign_id)
    AND EXISTS (
      SELECT 1
      FROM public.campaigns c
      WHERE c.id = d.campaign_id
        AND (auth.uid() IS NULL OR c.account_id IN (
          SELECT account_id FROM public.account_users WHERE user_id = auth.uid()
        ))
    );
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  INSERT INTO public.campaign_variant_stats (
    campaign_id,
    account_id,
    node_id,
    variant_id,
    sent_count,
    replied_count,
    positive_reply_count,
    bounce_count,
    updated_at
  )
  WITH scoped AS (
    SELECT c.id, c.account_id
    FROM public.campaigns c
    WHERE (p_campaign_id IS NULL OR c.id = p_campaign_id)
      AND (auth.uid() IS NULL OR c.account_id IN (
        SELECT account_id FROM public.account_users WHERE user_id = auth.uid()
      ))
  ),
  sent AS (
    SELECT mj.campaign_id, sc.account_id, mj.node_id, mj.variant_id, COUNT(*)::integer AS c
    FROM public.message_jobs mj
    INNER JOIN scoped sc ON sc.id = mj.campaign_id
    WHERE mj.status = 'sent'
      AND public.is_campaign_outbound_message_type(mj.message_type)
      AND mj.node_id IS NOT NULL
      AND mj.variant_id IS NOT NULL
    GROUP BY mj.campaign_id, sc.account_id, mj.node_id, mj.variant_id
  ),
  replied AS (
    SELECT mj.campaign_id, sc.account_id, mj.node_id, mj.variant_id, COUNT(*)::integer AS c
    FROM public.events e
    INNER JOIN public.message_jobs mj ON mj.id = e.message_job_id
    INNER JOIN scoped sc ON sc.id = mj.campaign_id
    WHERE e.event_type = 'replied'
      AND mj.variant_id IS NOT NULL
      AND mj.node_id IS NOT NULL
      AND public.is_paced_campaign_message_type(mj.message_type)
    GROUP BY mj.campaign_id, sc.account_id, mj.node_id, mj.variant_id
  ),
  pos AS (
    SELECT mj.campaign_id, sc.account_id, mj.node_id, mj.variant_id, COUNT(*)::integer AS c
    FROM public.events e
    INNER JOIN public.message_jobs mj ON mj.id = e.message_job_id
    INNER JOIN scoped sc ON sc.id = mj.campaign_id
    WHERE e.event_type = 'replied'
      AND COALESCE((e.event_data->>'is_positive')::boolean, false) = true
      AND mj.variant_id IS NOT NULL
      AND mj.node_id IS NOT NULL
      AND public.is_paced_campaign_message_type(mj.message_type)
    GROUP BY mj.campaign_id, sc.account_id, mj.node_id, mj.variant_id
  ),
  bnc AS (
    SELECT mj.campaign_id, sc.account_id, mj.node_id, mj.variant_id, COUNT(*)::integer AS c
    FROM public.events e
    INNER JOIN public.message_jobs mj ON mj.id = e.message_job_id
    INNER JOIN scoped sc ON sc.id = mj.campaign_id
    WHERE e.event_type = 'bounced'
      AND mj.variant_id IS NOT NULL
      AND mj.node_id IS NOT NULL
      AND public.is_campaign_outbound_message_type(mj.message_type)
    GROUP BY mj.campaign_id, sc.account_id, mj.node_id, mj.variant_id
  ),
  keys AS (
    SELECT s.campaign_id, s.account_id, s.node_id, s.variant_id FROM sent s
    UNION
    SELECT r.campaign_id, r.account_id, r.node_id, r.variant_id FROM replied r
    UNION
    SELECT p.campaign_id, p.account_id, p.node_id, p.variant_id FROM pos p
    UNION
    SELECT b.campaign_id, b.account_id, b.node_id, b.variant_id FROM bnc b
  )
  SELECT
    k.campaign_id,
    k.account_id,
    k.node_id,
    k.variant_id,
    COALESCE(s.c, 0),
    COALESCE(r.c, 0),
    COALESCE(p.c, 0),
    COALESCE(b.c, 0),
    NOW()
  FROM keys k
  LEFT JOIN sent s
    ON s.campaign_id = k.campaign_id AND s.node_id = k.node_id AND s.variant_id = k.variant_id
  LEFT JOIN replied r
    ON r.campaign_id = k.campaign_id AND r.node_id = k.node_id AND r.variant_id = k.variant_id
  LEFT JOIN pos p
    ON p.campaign_id = k.campaign_id AND p.node_id = k.node_id AND p.variant_id = k.variant_id
  LEFT JOIN bnc b
    ON b.campaign_id = k.campaign_id AND b.node_id = k.node_id AND b.variant_id = k.variant_id;

  RETURN v_deleted;
END;
$$;

COMMENT ON FUNCTION public.rebuild_campaign_variant_stats(uuid) IS
  'Delete-and-rebuild campaign_variant_stats from message_jobs (sent) and events (replied/positive/bounce).';

REVOKE ALL ON FUNCTION public.rebuild_campaign_variant_stats(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rebuild_campaign_variant_stats(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rebuild_campaign_variant_stats(uuid) TO service_role;

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
  IF p_campaign_id IS NULL THEN
    RAISE EXCEPTION 'p_campaign_id is required';
  END IF;

  IF auth.uid() IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.campaigns c
      INNER JOIN public.account_users au
        ON au.account_id = c.account_id AND au.user_id = auth.uid()
      WHERE c.id = p_campaign_id
        AND c.deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    v.node_id,
    v.variant_id,
    v.sent_count::bigint,
    v.replied_count::bigint,
    v.positive_reply_count::bigint,
    v.bounce_count::bigint
  FROM public.campaign_variant_stats v
  WHERE v.campaign_id = p_campaign_id;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

COMMENT ON FUNCTION get_campaign_variant_stats IS
  'Per node/variant lifetime counts from campaign_variant_stats (sent+bounce outbound; replied+positive paced).';

-- ---------------------------------------------------------------------------
-- Reconcile also rebuilds the variant cache
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

  PERFORM public.rebuild_campaign_stats_daily(p_campaign_id);
  PERFORM public.rebuild_campaign_variant_stats(p_campaign_id);

  RETURN v_updated;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

COMMENT ON FUNCTION reconcile_campaign_stats IS
  'Recompute campaign_stats; rebuild campaign_stats_daily and campaign_variant_stats.';

SET statement_timeout = '30s';
SELECT public.rebuild_campaign_variant_stats(NULL);

NOTIFY pgrst, 'reload schema';
