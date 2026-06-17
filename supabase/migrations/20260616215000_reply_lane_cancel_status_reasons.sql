-- Allow inbox cancel RPCs to set paired status_reason values on cancelled jobs.
CREATE OR REPLACE FUNCTION public.message_job_status_reason_is_valid(
  p_status TEXT,
  p_status_reason TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  CASE p_status
    WHEN 'queued' THEN
      RETURN p_status_reason IS NULL;
    WHEN 'reserved' THEN
      RETURN p_status_reason IS NULL;
    WHEN 'sending' THEN
      RETURN p_status_reason IS NULL;
    WHEN 'held' THEN
      RETURN p_status_reason IS NULL;
    WHEN 'sent' THEN
      RETURN p_status_reason = 'sent_successfully';
    WHEN 'deferred' THEN
      RETURN p_status_reason IN (
        'daily_throttle_limit',
        'hourly_throttle_limit',
        'min_gap_not_met',
        'campaign_paused',
        'enrollment_paused',
        'transient_read_error'
      );
    WHEN 'failed' THEN
      RETURN p_status_reason IN (
        'provider_error',
        'template_render_error',
        'uncertain_send_state'
      );
    WHEN 'cancelled' THEN
      RETURN p_status_reason IN (
        'campaign_deleted',
        'mailbox_deleted',
        'lead_deleted',
        'enrollment_deleted',
        'node_deleted',
        'enrollment_not_active',
        'manually_cancelled',
        'reply_received',
        'inbox_user_cancelled',
        'inbox_manual_override'
      );
    WHEN 'blocked' THEN
      RETURN p_status_reason IN (
        'lead_blocked',
        'mailbox_blocked'
      );
    ELSE
      RETURN FALSE;
  END CASE;
END;
$$;

COMMENT ON FUNCTION public.message_job_status_reason_is_valid(TEXT, TEXT) IS
  'Validates status/status_reason pairs for message_jobs, including inbox cancel reasons inbox_user_cancelled and inbox_manual_override.';
