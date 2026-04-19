CREATE OR REPLACE FUNCTION resume_campaign_and_reschedule_jobs(
  p_campaign_id UUID,
  p_pause_reason TEXT DEFAULT 'Campaign paused'
)
RETURNS TABLE (
  revived_jobs INTEGER,
  rescheduled_jobs INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign RECORD;
  v_anchor_interval_time TIMESTAMPTZ;
  v_jitter_percentage NUMERIC := 10.0;
  v_jitter_range_seconds NUMERIC := 0;
  v_min_scheduled_at TIMESTAMPTZ := NOW() + INTERVAL '30 seconds';
  v_revived_jobs INTEGER := 0;
  v_rescheduled_jobs INTEGER := 0;
BEGIN
  IF p_campaign_id IS NULL THEN
    RETURN QUERY SELECT 0, 0;
    RETURN;
  END IF;

  IF auth.uid() IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM campaigns c
      WHERE c.id = p_campaign_id
        AND c.account_id IN (SELECT account_id FROM account_users WHERE user_id = auth.uid())
    ) THEN
      RETURN QUERY SELECT 0, 0;
      RETURN;
    END IF;
  END IF;

  SELECT
    c.id,
    c.account_id,
    c.sending_interval_seconds,
    c.deleted_at,
    COALESCE(c.jitter_percentage, a.jitter_percentage, 10.0) AS effective_jitter_percentage
  INTO v_campaign
  FROM campaigns c
  LEFT JOIN accounts a ON a.id = c.account_id
  WHERE c.id = p_campaign_id
  FOR UPDATE OF c;

  IF NOT FOUND OR v_campaign.deleted_at IS NOT NULL THEN
    RETURN QUERY SELECT 0, 0;
    RETURN;
  END IF;

  SELECT ci.interval_time
  INTO v_anchor_interval_time
  FROM campaign_intervals ci
  WHERE ci.campaign_id = p_campaign_id
    AND ci.interval_time > NOW()
    AND ci.status IN ('available', 'scheduled')
  ORDER BY ci.interval_time ASC
  LIMIT 1;

  IF v_anchor_interval_time IS NULL THEN
    IF COALESCE(v_campaign.sending_interval_seconds, 0) > 0 THEN
      v_anchor_interval_time := NOW() + make_interval(secs => v_campaign.sending_interval_seconds);
    ELSE
      v_anchor_interval_time := NOW() + INTERVAL '5 minutes';
    END IF;
  END IF;

  v_jitter_percentage := COALESCE(v_campaign.effective_jitter_percentage, 10.0);
  v_jitter_range_seconds := GREATEST(
    COALESCE(v_campaign.sending_interval_seconds, 300) * (v_jitter_percentage / 100.0),
    0
  );

  UPDATE message_jobs mj
  SET
    status = 'pending',
    reserved_at = NULL,
    scheduled_at = GREATEST(
      v_min_scheduled_at,
      v_anchor_interval_time + make_interval(
        secs => ((RANDOM() * 2 - 1) * v_jitter_range_seconds)::DOUBLE PRECISION
      )
    ),
    error_message = NULL,
    updated_at = NOW()
  WHERE mj.campaign_id = p_campaign_id
    AND mj.status = 'cancelled'
    AND mj.error_message = COALESCE(NULLIF(TRIM(p_pause_reason), ''), 'Campaign paused')
    AND (mj.message_type = 'campaign' OR mj.message_type IS NULL)
    AND (mj.message_data->>'source' IS DISTINCT FROM 'inbox_reply')
    AND (mj.message_data->>'source' IS DISTINCT FROM 'inbox_forward')
    AND NOT EXISTS (
      SELECT 1
      FROM message_jobs existing
      WHERE existing.id <> mj.id
        AND existing.enrollment_id = mj.enrollment_id
        AND existing.node_id IS NOT DISTINCT FROM mj.node_id
        AND existing.status IN ('pending', 'reserved', 'sending', 'sent')
    );

  GET DIAGNOSTICS v_revived_jobs = ROW_COUNT;

  UPDATE message_jobs mj
  SET
    reserved_at = NULL,
    scheduled_at = GREATEST(
      v_min_scheduled_at,
      v_anchor_interval_time + make_interval(
        secs => ((RANDOM() * 2 - 1) * v_jitter_range_seconds)::DOUBLE PRECISION
      )
    ),
    updated_at = NOW()
  WHERE mj.campaign_id = p_campaign_id
    AND mj.status = 'pending'
    AND mj.scheduled_at < NOW()
    AND (mj.message_type = 'campaign' OR mj.message_type IS NULL)
    AND (mj.message_data->>'source' IS DISTINCT FROM 'inbox_reply')
    AND (mj.message_data->>'source' IS DISTINCT FROM 'inbox_forward');

  GET DIAGNOSTICS v_rescheduled_jobs = ROW_COUNT;

  UPDATE campaigns
  SET
    status = 'running',
    updated_at = NOW()
  WHERE id = p_campaign_id
    AND deleted_at IS NULL;

  RETURN QUERY SELECT v_revived_jobs, v_rescheduled_jobs;
END;
$$;

COMMENT ON FUNCTION resume_campaign_and_reschedule_jobs(UUID, TEXT) IS
  'Atomically resumes a campaign by reviving pause-cancelled campaign jobs and moving overdue pending campaign jobs onto the next future schedule anchor before setting campaign status to running.';

GRANT EXECUTE ON FUNCTION public.resume_campaign_and_reschedule_jobs(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resume_campaign_and_reschedule_jobs(UUID, TEXT) TO service_role;
