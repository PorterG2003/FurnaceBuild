-- ============================================
-- Migration: Add account_id validation to client-callable SECURITY DEFINER RPCs
-- ============================================
-- Ensures RPCs that can be called with anon key only affect data in accounts
-- the caller (auth.uid()) is a member of.

-- Helper: raise if campaign is not in caller's accounts (for use in RPCs that take p_campaign_id)
-- Used inline below.

-- 1. get_campaign_contacted_counts: when caller is authenticated, only return counts for campaigns in caller's accounts; service role (auth.uid() IS NULL) sees all
CREATE OR REPLACE FUNCTION get_campaign_contacted_counts(p_campaign_ids UUID[])
RETURNS TABLE(campaign_id UUID, contacted_count INT) AS $$
BEGIN
  RETURN QUERY
    SELECT mj.campaign_id, COUNT(DISTINCT mj.enrollment_id)::int AS contacted_count
    FROM message_jobs mj
    INNER JOIN campaigns c ON c.id = mj.campaign_id
      AND (auth.uid() IS NULL OR c.account_id IN (SELECT account_id FROM account_users WHERE user_id = auth.uid()))
    WHERE mj.campaign_id = ANY(p_campaign_ids)
      AND mj.status = 'sent'
      AND (mj.message_type = 'campaign' OR mj.message_type IS NULL)
    GROUP BY mj.campaign_id;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

-- 2. reconcile_campaign_stats: when called with auth (anon key), only allow campaigns in caller's accounts; when auth.uid() IS NULL (service role), allow all
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
        AND (mj.message_type = 'campaign' OR mj.message_type IS NULL)
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

-- 3. update_campaign_stats_positive_reply: verify campaign in caller's account; include account_id in INSERT
CREATE OR REPLACE FUNCTION update_campaign_stats_positive_reply(p_campaign_id UUID, p_delta INT)
RETURNS void AS $$
DECLARE
  v_account_id UUID;
BEGIN
  IF p_campaign_id IS NULL OR p_delta = 0 THEN
    RETURN;
  END IF;
  SELECT c.account_id INTO v_account_id
  FROM campaigns c
  WHERE c.id = p_campaign_id
    AND c.account_id IN (SELECT account_id FROM account_users WHERE user_id = auth.uid());
  IF v_account_id IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO campaign_stats (campaign_id, account_id, sent_count, replied_count, positive_reply_count, bounce_count, updated_at)
  VALUES (p_campaign_id, v_account_id, 0, 0, GREATEST(0, p_delta), 0, NOW())
  ON CONFLICT (campaign_id) DO UPDATE SET
    positive_reply_count = GREATEST(0, campaign_stats.positive_reply_count + p_delta),
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 4. update_replied_event_is_positive: verify campaign in caller's account
CREATE OR REPLACE FUNCTION update_replied_event_is_positive(p_campaign_id UUID, p_message_job_id UUID, p_is_positive BOOLEAN)
RETURNS void AS $$
BEGIN
  IF p_campaign_id IS NULL OR p_message_job_id IS NULL THEN
    RETURN;
  END IF;
  UPDATE events e
  SET event_data = event_data || jsonb_build_object('is_positive', p_is_positive)
  FROM campaigns c
  WHERE e.campaign_id = p_campaign_id
    AND e.message_job_id = p_message_job_id
    AND e.event_type = 'replied'
    AND c.id = e.campaign_id
    AND c.account_id IN (SELECT account_id FROM account_users WHERE user_id = auth.uid());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
