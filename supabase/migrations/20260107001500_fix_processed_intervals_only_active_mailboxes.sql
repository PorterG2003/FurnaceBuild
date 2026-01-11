-- ============================================
-- Migration: Fix processed interval check to count only active/eligible mailboxes
-- ============================================
-- Problem:
--   check_and_update_processed_intervals() previously required ALL campaign_mailboxes
--   to have completed jobs (sent/failed) for an interval to be marked completed.
--   However, the scheduler only creates jobs for eligible mailboxes (e.g. connected + smtp_status='active').
--   If a campaign has inactive mailboxes still present in campaign_mailboxes, intervals will never be "processed".
--
-- Fix:
--   Count only eligible mailboxes:
--     - mailboxes.status = 'connected'
--     - mailboxes.smtp_status = 'active'
--   And require completion across only those eligible mailboxes.

CREATE OR REPLACE FUNCTION check_and_update_processed_intervals(
  p_campaign_id UUID DEFAULT NULL -- NULL = check all campaigns
)
RETURNS INTEGER AS $$
DECLARE
  v_updated_count INTEGER := 0;
  v_campaign_record RECORD;
  v_interval_record RECORD;
  v_total_mailboxes INTEGER;
BEGIN
  -- Loop through campaigns
  FOR v_campaign_record IN
    SELECT DISTINCT c.id, c.last_processed_interval_end
    FROM campaigns c
    WHERE (p_campaign_id IS NULL OR c.id = p_campaign_id)
      AND EXISTS (
        SELECT 1 FROM campaign_intervals ci WHERE ci.campaign_id = c.id
      )
  LOOP
    -- Count only eligible mailboxes for this campaign
    SELECT COUNT(*) INTO v_total_mailboxes
    FROM campaign_mailboxes cm
    JOIN mailboxes m ON m.id = cm.mailbox_id
    WHERE cm.campaign_id = v_campaign_record.id
      AND m.status = 'connected'
      AND m.smtp_status = 'active';

    -- If no eligible mailboxes, skip
    IF v_total_mailboxes = 0 THEN
      CONTINUE;
    END IF;

    -- Find intervals where all ELIGIBLE mailboxes have a completed job (sent/failed)
    FOR v_interval_record IN
      SELECT
        ci.id,
        ci.interval_time,
        COUNT(DISTINCT cm.mailbox_id) FILTER (
          WHERE mj.status IN ('sent', 'failed')
        ) AS completed_mailboxes
      FROM campaign_intervals ci
      JOIN message_jobs mj ON mj.interval_id = ci.id
      JOIN campaign_mailboxes cm ON cm.campaign_id = ci.campaign_id AND cm.mailbox_id = mj.mailbox_id
      JOIN mailboxes m ON m.id = cm.mailbox_id
      WHERE ci.campaign_id = v_campaign_record.id
        AND ci.status = 'scheduled'
        AND m.status = 'connected'
        AND m.smtp_status = 'active'
        AND (
          v_campaign_record.last_processed_interval_end IS NULL
          OR ci.interval_time > v_campaign_record.last_processed_interval_end
        )
      GROUP BY ci.id, ci.interval_time
      HAVING COUNT(DISTINCT cm.mailbox_id) FILTER (
        WHERE mj.status IN ('sent', 'failed')
      ) = v_total_mailboxes
      ORDER BY ci.interval_time ASC
    LOOP
      -- Advance campaign pointer
      UPDATE campaigns
      SET last_processed_interval_end = v_interval_record.interval_time
      WHERE id = v_campaign_record.id
        AND (
          last_processed_interval_end IS NULL
          OR last_processed_interval_end < v_interval_record.interval_time
        );

      -- Mark interval as completed
      UPDATE campaign_intervals
      SET status = 'completed'
      WHERE id = v_interval_record.id;

      v_updated_count := v_updated_count + 1;
    END LOOP;
  END LOOP;

  RETURN v_updated_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION check_and_update_processed_intervals IS
  'Marks intervals completed when all ELIGIBLE campaign mailboxes (connected + smtp_status=active) have jobs in sent/failed. Updates campaigns.last_processed_interval_end to interval_time.';


