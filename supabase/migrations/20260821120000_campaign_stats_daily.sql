-- Incremental UTC-day cache of events for metrics / campaign charts.
-- Source of truth remains public.events; this table is rebuilt by
-- rebuild_campaign_stats_daily / reconcile_campaign_stats.

CREATE TABLE IF NOT EXISTS public.campaign_stats_daily (
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  stat_date date NOT NULL,
  sent_count integer NOT NULL DEFAULT 0,
  replied_count integer NOT NULL DEFAULT 0,
  positive_reply_count integer NOT NULL DEFAULT 0,
  bounce_count integer NOT NULL DEFAULT 0,
  leads_first_contacted integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (campaign_id, stat_date)
);

CREATE INDEX IF NOT EXISTS idx_campaign_stats_daily_account_date
  ON public.campaign_stats_daily (account_id, stat_date);

COMMENT ON TABLE public.campaign_stats_daily IS
  'Cached per-UTC-day event counts for Furnace campaigns. Rebuilt from events; updated incrementally by record_* RPCs.';

ALTER TABLE public.campaign_stats_daily ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS campaign_stats_daily_select ON public.campaign_stats_daily;
CREATE POLICY campaign_stats_daily_select
  ON public.campaign_stats_daily
  FOR SELECT
  USING (
    account_id IN (SELECT account_id FROM public.account_users WHERE user_id = auth.uid())
  );

CREATE INDEX IF NOT EXISTS idx_events_account_type_created
  ON public.events (account_id, event_type, created_at)
  INCLUDE (lead_id, campaign_id, enrollment_id, message_job_id);

CREATE INDEX IF NOT EXISTS idx_enrollments_account_uncontacted_active
  ON public.enrollments (account_id, campaign_id)
  WHERE deleted_at IS NULL AND state = 'active' AND has_been_contacted = false;

-- ---------------------------------------------------------------------------
-- Increment helper (event UTC day, never NOW())
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.increment_campaign_stats_daily(
  p_campaign_id uuid,
  p_account_id uuid,
  p_stat_date date,
  p_sent integer DEFAULT 0,
  p_replied integer DEFAULT 0,
  p_positive integer DEFAULT 0,
  p_bounce integer DEFAULT 0,
  p_first_contacted integer DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF p_campaign_id IS NULL OR p_account_id IS NULL OR p_stat_date IS NULL THEN
    RETURN;
  END IF;
  IF COALESCE(p_sent, 0) = 0
     AND COALESCE(p_replied, 0) = 0
     AND COALESCE(p_positive, 0) = 0
     AND COALESCE(p_bounce, 0) = 0
     AND COALESCE(p_first_contacted, 0) = 0 THEN
    RETURN;
  END IF;

  INSERT INTO public.campaign_stats_daily (
    campaign_id,
    account_id,
    stat_date,
    sent_count,
    replied_count,
    positive_reply_count,
    bounce_count,
    leads_first_contacted,
    updated_at
  )
  VALUES (
    p_campaign_id,
    p_account_id,
    p_stat_date,
    GREATEST(0, COALESCE(p_sent, 0)),
    GREATEST(0, COALESCE(p_replied, 0)),
    GREATEST(0, COALESCE(p_positive, 0)),
    GREATEST(0, COALESCE(p_bounce, 0)),
    GREATEST(0, COALESCE(p_first_contacted, 0)),
    NOW()
  )
  ON CONFLICT (campaign_id, stat_date) DO UPDATE SET
    sent_count = GREATEST(0, public.campaign_stats_daily.sent_count + COALESCE(p_sent, 0)),
    replied_count = GREATEST(0, public.campaign_stats_daily.replied_count + COALESCE(p_replied, 0)),
    positive_reply_count = GREATEST(0, public.campaign_stats_daily.positive_reply_count + COALESCE(p_positive, 0)),
    bounce_count = GREATEST(0, public.campaign_stats_daily.bounce_count + COALESCE(p_bounce, 0)),
    leads_first_contacted = GREATEST(0, public.campaign_stats_daily.leads_first_contacted + COALESCE(p_first_contacted, 0)),
    updated_at = NOW();
END;
$$;

COMMENT ON FUNCTION public.increment_campaign_stats_daily(uuid, uuid, date, integer, integer, integer, integer, integer) IS
  'Upsert deltas onto campaign_stats_daily for a UTC calendar day. Used by record_* stats RPCs.';

REVOKE ALL ON FUNCTION public.increment_campaign_stats_daily(uuid, uuid, date, integer, integer, integer, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_campaign_stats_daily(uuid, uuid, date, integer, integer, integer, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.increment_campaign_stats_daily(uuid, uuid, date, integer, integer, integer, integer, integer) TO service_role;

-- ---------------------------------------------------------------------------
-- Rebuild daily cache from events
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rebuild_campaign_stats_daily(
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

  DELETE FROM public.campaign_stats_daily d
  WHERE (p_campaign_id IS NULL OR d.campaign_id = p_campaign_id)
    AND EXISTS (
      SELECT 1
      FROM public.campaigns c
      WHERE c.id = d.campaign_id
        AND c.source IS DISTINCT FROM 'smartlead'
        AND (auth.uid() IS NULL OR c.account_id IN (
          SELECT account_id FROM public.account_users WHERE user_id = auth.uid()
        ))
    );
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  INSERT INTO public.campaign_stats_daily (
    campaign_id,
    account_id,
    stat_date,
    sent_count,
    replied_count,
    positive_reply_count,
    bounce_count,
    leads_first_contacted,
    updated_at
  )
  WITH scoped AS (
    SELECT c.id, c.account_id
    FROM public.campaigns c
    WHERE c.source IS DISTINCT FROM 'smartlead'
      AND (p_campaign_id IS NULL OR c.id = p_campaign_id)
      AND (auth.uid() IS NULL OR c.account_id IN (
        SELECT account_id FROM public.account_users WHERE user_id = auth.uid()
      ))
  ),
  event_days AS (
    SELECT
      ev.campaign_id,
      sc.account_id,
      (ev.created_at AT TIME ZONE 'UTC')::date AS stat_date,
      COUNT(*) FILTER (WHERE ev.event_type = 'sent')::integer AS sent_count,
      COUNT(*) FILTER (WHERE ev.event_type = 'replied')::integer AS replied_count,
      COUNT(*) FILTER (
        WHERE ev.event_type = 'replied'
          AND (ev.event_data->>'is_positive') = 'true'
      )::integer AS positive_reply_count,
      COUNT(*) FILTER (WHERE ev.event_type = 'bounced')::integer AS bounce_count
    FROM public.events ev
    INNER JOIN scoped sc ON sc.id = ev.campaign_id
    WHERE ev.event_type IN ('sent', 'replied', 'bounced')
    GROUP BY ev.campaign_id, sc.account_id, (ev.created_at AT TIME ZONE 'UTC')::date
  ),
  first_contact AS (
    SELECT
      x.campaign_id,
      x.account_id,
      (x.first_sent_at AT TIME ZONE 'UTC')::date AS stat_date,
      COUNT(*)::integer AS leads_first_contacted
    FROM (
      SELECT
        ev.campaign_id,
        sc.account_id,
        COALESCE(ev.lead_id, en.lead_id) AS lead_id,
        MIN(ev.created_at) AS first_sent_at
      FROM public.events ev
      INNER JOIN scoped sc ON sc.id = ev.campaign_id
      LEFT JOIN public.enrollments en
        ON en.id = ev.enrollment_id
       AND en.deleted_at IS NULL
      WHERE ev.event_type = 'sent'
        AND COALESCE(ev.lead_id, en.lead_id) IS NOT NULL
      GROUP BY ev.campaign_id, sc.account_id, COALESCE(ev.lead_id, en.lead_id)
    ) x
    GROUP BY x.campaign_id, x.account_id, (x.first_sent_at AT TIME ZONE 'UTC')::date
  )
  SELECT
    COALESCE(e.campaign_id, f.campaign_id),
    COALESCE(e.account_id, f.account_id),
    COALESCE(e.stat_date, f.stat_date),
    COALESCE(e.sent_count, 0),
    COALESCE(e.replied_count, 0),
    COALESCE(e.positive_reply_count, 0),
    COALESCE(e.bounce_count, 0),
    COALESCE(f.leads_first_contacted, 0),
    NOW()
  FROM event_days e
  FULL OUTER JOIN first_contact f
    ON f.campaign_id = e.campaign_id
   AND f.stat_date = e.stat_date;

  RETURN v_deleted;
END;
$$;

COMMENT ON FUNCTION public.rebuild_campaign_stats_daily(uuid) IS
  'Delete-and-rebuild campaign_stats_daily from events for one Furnace campaign or all. Used after backdated event timestamps and by reconcile.';

REVOKE ALL ON FUNCTION public.rebuild_campaign_stats_daily(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rebuild_campaign_stats_daily(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rebuild_campaign_stats_daily(uuid) TO service_role;

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
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.record_sent_event_and_increment(uuid, uuid, uuid, uuid, jsonb) IS
  'Insert sent event, increment campaign_stats.sent_count and campaign_stats_daily, and set enrollments.has_been_contacted once. Used by send worker.';

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

  RETURN true;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION record_replied_event_and_increment IS
  'Insert replied event (idempotent) with event_data.is_positive; increment campaign_stats and campaign_stats_daily when inserted.';

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

  RETURN true;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION record_bounced_event_and_increment IS
  'Insert a bounced event once per mailbox-scoped physical bounce and increment campaign_stats and campaign_stats_daily only when a new row was inserted.';

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
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

COMMENT ON FUNCTION update_replied_event_is_positive(UUID, UUID, BOOLEAN) IS
  'Syncs is_positive onto the replied event and adjusts campaign_stats_daily on that event UTC day. Authenticated callers must belong to the campaign account; service role (auth.uid() NULL) is allowed for worker-side AI categorization.';

-- ---------------------------------------------------------------------------
-- Reconcile: lifetime totals + daily rebuild
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

  RETURN v_updated;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

COMMENT ON FUNCTION reconcile_campaign_stats IS
  'Recompute campaign_stats from message_jobs (outbound sent incl. priority), email_threads (replied/positive), events (bounce); rebuild campaign_stats_daily from events.';

-- ---------------------------------------------------------------------------
-- Health report: daily vs events
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.campaign_stats_daily_health_report(
  p_account_id uuid DEFAULT NULL,
  p_campaign_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    IF p_account_id IS NOT NULL THEN
      PERFORM private_assert_account_member(p_account_id);
    ELSIF p_campaign_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1
        FROM public.campaigns c
        WHERE c.id = p_campaign_id
          AND c.account_id IN (SELECT account_id FROM public.account_users WHERE user_id = auth.uid())
      ) THEN
        RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
      END IF;
    ELSE
      RAISE EXCEPTION 'p_account_id or p_campaign_id is required';
    END IF;
  END IF;

  WITH scoped AS (
    SELECT c.id, c.account_id
    FROM public.campaigns c
    WHERE c.deleted_at IS NULL
      AND c.source IS DISTINCT FROM 'smartlead'
      AND (p_campaign_id IS NULL OR c.id = p_campaign_id)
      AND (p_account_id IS NULL OR c.account_id = p_account_id)
      AND (
        auth.uid() IS NULL
        OR c.account_id IN (SELECT account_id FROM public.account_users WHERE user_id = auth.uid())
      )
  ),
  event_days AS (
    SELECT
      ev.campaign_id,
      (ev.created_at AT TIME ZONE 'UTC')::date AS stat_date,
      COUNT(*) FILTER (WHERE ev.event_type = 'sent')::integer AS sent_count,
      COUNT(*) FILTER (WHERE ev.event_type = 'replied')::integer AS replied_count,
      COUNT(*) FILTER (
        WHERE ev.event_type = 'replied'
          AND (ev.event_data->>'is_positive') = 'true'
      )::integer AS positive_reply_count,
      COUNT(*) FILTER (WHERE ev.event_type = 'bounced')::integer AS bounce_count
    FROM public.events ev
    INNER JOIN scoped sc ON sc.id = ev.campaign_id
    WHERE ev.event_type IN ('sent', 'replied', 'bounced')
    GROUP BY ev.campaign_id, (ev.created_at AT TIME ZONE 'UTC')::date
  ),
  first_contact AS (
    SELECT
      x.campaign_id,
      (x.first_sent_at AT TIME ZONE 'UTC')::date AS stat_date,
      COUNT(*)::integer AS leads_first_contacted
    FROM (
      SELECT
        ev.campaign_id,
        COALESCE(ev.lead_id, en.lead_id) AS lead_id,
        MIN(ev.created_at) AS first_sent_at
      FROM public.events ev
      INNER JOIN scoped sc ON sc.id = ev.campaign_id
      LEFT JOIN public.enrollments en
        ON en.id = ev.enrollment_id
       AND en.deleted_at IS NULL
      WHERE ev.event_type = 'sent'
        AND COALESCE(ev.lead_id, en.lead_id) IS NOT NULL
      GROUP BY ev.campaign_id, COALESCE(ev.lead_id, en.lead_id)
    ) x
    GROUP BY x.campaign_id, (x.first_sent_at AT TIME ZONE 'UTC')::date
  ),
  expected AS (
    SELECT
      COALESCE(e.campaign_id, f.campaign_id) AS campaign_id,
      COALESCE(e.stat_date, f.stat_date) AS stat_date,
      COALESCE(e.sent_count, 0) AS sent_count,
      COALESCE(e.replied_count, 0) AS replied_count,
      COALESCE(e.positive_reply_count, 0) AS positive_reply_count,
      COALESCE(e.bounce_count, 0) AS bounce_count,
      COALESCE(f.leads_first_contacted, 0) AS leads_first_contacted
    FROM event_days e
    FULL OUTER JOIN first_contact f
      ON f.campaign_id = e.campaign_id
     AND f.stat_date = e.stat_date
  ),
  actual AS (
    SELECT
      d.campaign_id,
      d.stat_date,
      d.sent_count,
      d.replied_count,
      d.positive_reply_count,
      d.bounce_count,
      d.leads_first_contacted
    FROM public.campaign_stats_daily d
    INNER JOIN scoped sc ON sc.id = d.campaign_id
  ),
  joined AS (
    SELECT
      COALESCE(e.campaign_id, a.campaign_id) AS campaign_id,
      COALESCE(e.stat_date, a.stat_date) AS stat_date,
      COALESCE(e.sent_count, 0) AS events_sent,
      COALESCE(a.sent_count, 0) AS daily_sent,
      COALESCE(e.replied_count, 0) AS events_replied,
      COALESCE(a.replied_count, 0) AS daily_replied,
      COALESCE(e.positive_reply_count, 0) AS events_positive,
      COALESCE(a.positive_reply_count, 0) AS daily_positive,
      COALESCE(e.bounce_count, 0) AS events_bounce,
      COALESCE(a.bounce_count, 0) AS daily_bounce,
      COALESCE(e.leads_first_contacted, 0) AS events_first,
      COALESCE(a.leads_first_contacted, 0) AS daily_first
    FROM expected e
    FULL OUTER JOIN actual a
      ON a.campaign_id = e.campaign_id
     AND a.stat_date = e.stat_date
  ),
  mismatches AS (
    SELECT *
    FROM joined j
    WHERE j.events_sent IS DISTINCT FROM j.daily_sent
       OR j.events_replied IS DISTINCT FROM j.daily_replied
       OR j.events_positive IS DISTINCT FROM j.daily_positive
       OR j.events_bounce IS DISTINCT FROM j.daily_bounce
       OR j.events_first IS DISTINCT FROM j.daily_first
  ),
  sample AS (
    SELECT jsonb_agg(row_payload ORDER BY campaign_id, stat_date, metric)
    FROM (
      SELECT
        m.campaign_id,
        m.stat_date,
        x.metric,
        x.daily_value,
        x.events_value,
        jsonb_build_object(
          'campaign_id', m.campaign_id,
          'stat_date', m.stat_date,
          'metric', x.metric,
          'daily_value', x.daily_value,
          'events_value', x.events_value
        ) AS row_payload
      FROM mismatches m
      CROSS JOIN LATERAL (
        VALUES
          ('sent', m.daily_sent, m.events_sent),
          ('replied', m.daily_replied, m.events_replied),
          ('positive_reply', m.daily_positive, m.events_positive),
          ('bounce', m.daily_bounce, m.events_bounce),
          ('leads_first_contacted', m.daily_first, m.events_first)
      ) AS x(metric, daily_value, events_value)
      WHERE x.daily_value IS DISTINCT FROM x.events_value
      LIMIT 20
    ) s
  )
  SELECT jsonb_build_object(
    'campaignsChecked', (SELECT COUNT(*) FROM scoped),
    'daysMismatched', (SELECT COUNT(*) FROM mismatches),
    'sentDelta', COALESCE((SELECT SUM(ABS(events_sent - daily_sent)) FROM mismatches), 0),
    'repliedDelta', COALESCE((SELECT SUM(ABS(events_replied - daily_replied)) FROM mismatches), 0),
    'positiveDelta', COALESCE((SELECT SUM(ABS(events_positive - daily_positive)) FROM mismatches), 0),
    'bounceDelta', COALESCE((SELECT SUM(ABS(events_bounce - daily_bounce)) FROM mismatches), 0),
    'firstContactDelta', COALESCE((SELECT SUM(ABS(events_first - daily_first)) FROM mismatches), 0),
    'sample', COALESCE((SELECT * FROM sample), '[]'::jsonb)
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.campaign_stats_daily_health_report(uuid, uuid) IS
  'Compare campaign_stats_daily to events by UTC day. Zero daysMismatched means the cache matches events.';

REVOKE ALL ON FUNCTION public.campaign_stats_daily_health_report(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.campaign_stats_daily_health_report(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.campaign_stats_daily_health_report(uuid, uuid) TO service_role;

-- Initial backfill from events (Furnace campaigns only).
SELECT public.rebuild_campaign_stats_daily(NULL);

GRANT SELECT ON public.campaign_stats_daily TO authenticated;
GRANT ALL ON public.campaign_stats_daily TO service_role;

NOTIFY pgrst, 'reload schema';
