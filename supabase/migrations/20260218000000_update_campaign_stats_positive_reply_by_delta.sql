-- ============================================
-- Migration: Adjust campaign_stats.positive_reply_count by delta (for user category changes)
-- ============================================
-- When the user marks a thread as Interested / Not Interested, we sync to the replied
-- event and adjust positive_reply_count without touching replied_count.

CREATE OR REPLACE FUNCTION update_campaign_stats_positive_reply(p_campaign_id UUID, p_delta INT)
RETURNS void AS $$
BEGIN
  IF p_campaign_id IS NULL OR p_delta = 0 THEN
    RETURN;
  END IF;
  INSERT INTO campaign_stats (campaign_id, sent_count, replied_count, positive_reply_count, bounce_count, updated_at)
  VALUES (p_campaign_id, 0, 0, GREATEST(0, p_delta), 0, NOW())
  ON CONFLICT (campaign_id) DO UPDATE SET
    positive_reply_count = GREATEST(0, campaign_stats.positive_reply_count + p_delta),
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION update_campaign_stats_positive_reply IS 'Adjust positive_reply_count by delta (+1 or -1). Used when user sets/clears thread category to Interested.';

-- Update replied event's event_data.is_positive for a thread (by message_job_id + campaign_id).
CREATE OR REPLACE FUNCTION update_replied_event_is_positive(p_campaign_id UUID, p_message_job_id UUID, p_is_positive BOOLEAN)
RETURNS void AS $$
BEGIN
  IF p_campaign_id IS NULL OR p_message_job_id IS NULL THEN
    RETURN;
  END IF;
  UPDATE events
  SET event_data = event_data || jsonb_build_object('is_positive', p_is_positive)
  WHERE campaign_id = p_campaign_id
    AND message_job_id = p_message_job_id
    AND event_type = 'replied';
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION update_replied_event_is_positive IS 'Set event_data.is_positive on the replied event for a thread. Used when user sets thread category to Interested.';
