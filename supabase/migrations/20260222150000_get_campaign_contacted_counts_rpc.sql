-- ============================================
-- Migration: RPC for contacted enrollment counts + supporting index
-- ============================================
-- Returns the number of distinct enrollments per campaign that have at least
-- one sent campaign email. Used by the campaign list completion dial.

-- Partial index: speeds up the COUNT(DISTINCT enrollment_id) query for sent campaign jobs.
CREATE INDEX IF NOT EXISTS idx_message_jobs_campaign_sent_enrollment
  ON message_jobs (campaign_id, enrollment_id)
  WHERE status = 'sent' AND (message_type = 'campaign' OR message_type IS NULL);

-- RPC: get contacted enrollment counts for a batch of campaigns in one round-trip.
CREATE OR REPLACE FUNCTION get_campaign_contacted_counts(p_campaign_ids UUID[])
RETURNS TABLE(campaign_id UUID, contacted_count INT) AS $$
BEGIN
  RETURN QUERY
    SELECT mj.campaign_id, COUNT(DISTINCT mj.enrollment_id)::int AS contacted_count
    FROM message_jobs mj
    WHERE mj.campaign_id = ANY(p_campaign_ids)
      AND mj.status = 'sent'
      AND (mj.message_type = 'campaign' OR mj.message_type IS NULL)
    GROUP BY mj.campaign_id;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_campaign_contacted_counts IS 'Return per-campaign count of distinct enrollments with at least one sent campaign email. Used for campaign list completion dial.';
