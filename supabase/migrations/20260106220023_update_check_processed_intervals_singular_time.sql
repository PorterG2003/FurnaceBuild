-- ============================================
-- Migration: Update check_and_update_processed_intervals for singular time
-- ============================================
-- Changes to use interval_time instead of interval_end

CREATE OR REPLACE FUNCTION check_and_update_processed_intervals(
  p_campaign_id UUID DEFAULT NULL -- NULL = check all campaigns
)
RETURNS INTEGER AS $$
DECLARE
  v_updated_count INTEGER := 0;
  v_campaign_record RECORD;
  v_interval_record RECORD;
  v_total_mailboxes INTEGER;
  v_completed_jobs INTEGER;
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
    -- Get total mailboxes for this campaign
    SELECT COUNT(*) INTO v_total_mailboxes
    FROM campaign_mailboxes
    WHERE campaign_id = v_campaign_record.id;
    
    -- If no mailboxes, skip
    IF v_total_mailboxes = 0 THEN
      CONTINUE;
    END IF;
    
    -- Find intervals where all jobs are 'sent' or 'failed'
    -- and interval_time > last_processed_interval_end
    FOR v_interval_record IN
      SELECT 
        ci.id,
        ci.interval_time,
        COUNT(DISTINCT mj.mailbox_id) FILTER (
          WHERE mj.status IN ('sent', 'failed')
        ) as completed_mailboxes
      FROM campaign_intervals ci
      INNER JOIN message_jobs mj ON mj.interval_id = ci.id
      WHERE ci.campaign_id = v_campaign_record.id
        AND ci.status = 'scheduled'
        AND (
          v_campaign_record.last_processed_interval_end IS NULL
          OR ci.interval_time > v_campaign_record.last_processed_interval_end
        )
      GROUP BY ci.id, ci.interval_time
      HAVING COUNT(DISTINCT mj.mailbox_id) FILTER (
        WHERE mj.status IN ('sent', 'failed')
      ) = v_total_mailboxes
      ORDER BY ci.interval_time ASC
    LOOP
      -- Update last_processed_interval_end to this interval's time
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

COMMENT ON FUNCTION check_and_update_processed_intervals IS 'Checks intervals where all jobs are sent/failed and updates last_processed_interval_end using interval_time. Should be called periodically or after job status updates.';

