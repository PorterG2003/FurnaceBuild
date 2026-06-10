-- ============================================
-- Migration: allow service-role callers in category stats-sync RPCs
-- ============================================
-- update_campaign_stats_positive_reply and update_replied_event_is_positive
-- were written for authenticated app callers and resolve the campaign through
-- the caller's account membership (auth.uid()). The scheduler worker's AI
-- categorizer now calls them with the service role, where auth.uid() IS NULL
-- and the membership subquery silently matches nothing - making the sync a
-- no-op. Mirror reconcile_campaign_stats: service role (auth.uid() IS NULL)
-- bypasses the membership check; authenticated callers keep it.

CREATE OR REPLACE FUNCTION update_campaign_stats_positive_reply(p_campaign_id UUID, p_delta INT)
RETURNS void AS $$
DECLARE
  v_account_id UUID;
BEGIN
  IF p_campaign_id IS NULL OR p_delta = 0 THEN
    RETURN;
  END IF;

  IF auth.uid() IS NOT NULL THEN
    SELECT c.account_id INTO v_account_id
    FROM campaigns c
    WHERE c.id = p_campaign_id
      AND c.account_id IN (SELECT account_id FROM account_users WHERE user_id = auth.uid());
  ELSE
    SELECT c.account_id INTO v_account_id
    FROM campaigns c
    WHERE c.id = p_campaign_id;
  END IF;

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

COMMENT ON FUNCTION update_campaign_stats_positive_reply(UUID, INT) IS
  'Adjusts positive_reply_count by delta. Authenticated callers must belong to the campaign account; service role (auth.uid() NULL) is allowed for worker-side AI categorization.';

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
    AND (
      auth.uid() IS NULL
      OR c.account_id IN (SELECT account_id FROM account_users WHERE user_id = auth.uid())
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

COMMENT ON FUNCTION update_replied_event_is_positive(UUID, UUID, BOOLEAN) IS
  'Syncs is_positive onto the replied event. Authenticated callers must belong to the campaign account; service role (auth.uid() NULL) is allowed for worker-side AI categorization.';
