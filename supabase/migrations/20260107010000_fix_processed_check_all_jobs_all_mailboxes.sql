-- ============================================
-- Migration: Fix processed check - ALL jobs must be completed
-- ============================================
-- The issue: Previous version only checked eligible mailboxes, but jobs for
-- ineligible mailboxes could still be pending, causing intervals to be marked
-- as processed prematurely.
--
-- New logic:
-- 1) Each eligible mailbox must have at least one job in the interval
-- 2) ALL jobs in the interval (for any mailbox) must be 'sent' or 'failed'
--    (no pending/reserved/sending jobs allowed)

CREATE OR REPLACE FUNCTION check_and_update_processed_intervals(
  p_campaign_id UUID DEFAULT NULL -- NULL = check all campaigns
)
RETURNS INTEGER AS $$
DECLARE
  v_updated_count INTEGER := 0;
  v_campaign_record RECORD;
  v_interval_record RECORD;
  v_total_eligible_mailboxes INTEGER;
BEGIN
  FOR v_campaign_record IN
    SELECT DISTINCT c.id, c.last_processed_interval_end
    FROM campaigns c
    WHERE (p_campaign_id IS NULL OR c.id = p_campaign_id)
      AND EXISTS (SELECT 1 FROM campaign_intervals ci WHERE ci.campaign_id = c.id)
  LOOP
    -- Count eligible mailboxes for this campaign
    SELECT COUNT(*) INTO v_total_eligible_mailboxes
    FROM campaign_mailboxes cm
    JOIN mailboxes m ON m.id = cm.mailbox_id
    WHERE cm.campaign_id = v_campaign_record.id
      AND m.status = 'connected'
      AND m.smtp_status = 'active';

    IF v_total_eligible_mailboxes = 0 THEN
      CONTINUE;
    END IF;

    -- Intervals are processed only if:
    -- 1) Each eligible mailbox has at least one job in the interval
    -- 2) ALL jobs in the interval (for ANY mailbox) are 'sent' or 'failed'
    --    (no pending/reserved/sending jobs allowed)
    FOR v_interval_record IN
      SELECT
        ci.id,
        ci.interval_time
      FROM campaign_intervals ci
      WHERE ci.campaign_id = v_campaign_record.id
        AND ci.status = 'scheduled'
        AND (
          v_campaign_record.last_processed_interval_end IS NULL
          OR ci.interval_time > v_campaign_record.last_processed_interval_end
        )
        -- 1) Ensure each eligible mailbox has at least one job in this interval
        AND (
          SELECT COUNT(DISTINCT cm.mailbox_id)
          FROM campaign_mailboxes cm
          JOIN mailboxes m ON m.id = cm.mailbox_id
          JOIN message_jobs mj ON mj.mailbox_id = cm.mailbox_id AND mj.interval_id = ci.id
          WHERE cm.campaign_id = ci.campaign_id
            AND m.status = 'connected'
            AND m.smtp_status = 'active'
        ) = v_total_eligible_mailboxes
        -- 2) Ensure ALL jobs in the interval are completed (sent/failed)
        --    This checks ALL jobs, not just eligible mailboxes
        AND NOT EXISTS (
          SELECT 1
          FROM message_jobs mj
          WHERE mj.interval_id = ci.id
            AND mj.status NOT IN ('sent', 'failed')
        )
      ORDER BY ci.interval_time ASC
    LOOP
      -- Advance pointer
      UPDATE campaigns
      SET last_processed_interval_end = v_interval_record.interval_time
      WHERE id = v_campaign_record.id
        AND (
          last_processed_interval_end IS NULL
          OR last_processed_interval_end < v_interval_record.interval_time
        );

      -- Mark interval completed
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
  'Marks interval completed only when: (1) every eligible mailbox (connected + smtp_status=active) has at least one job in the interval, and (2) ALL jobs in the interval (for any mailbox) are sent/failed (no pending/reserved/sending jobs). Updates last_processed_interval_end to interval_time.';

