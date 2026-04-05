-- Client-side PostgREST filters on message_type / message_data->>source break or hit schema cache issues.
-- This RPC updates rows in SQL and excludes manual inbox jobs via message_data.source (same as inbox RPCs set).

CREATE OR REPLACE FUNCTION cancel_unsent_campaign_jobs(
  p_campaign_id UUID,
  p_reason TEXT DEFAULT 'Campaign paused'
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT;
BEGIN
  IF p_campaign_id IS NULL THEN
    RETURN 0;
  END IF;

  IF auth.uid() IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM campaigns c
      WHERE c.id = p_campaign_id
        AND c.account_id IN (SELECT account_id FROM account_users WHERE user_id = auth.uid())
    ) THEN
      RETURN 0;
    END IF;
  END IF;

  UPDATE message_jobs mj
  SET
    status = 'cancelled',
    error_message = COALESCE(NULLIF(TRIM(p_reason), ''), 'Cancelled'),
    updated_at = NOW()
  WHERE mj.campaign_id = p_campaign_id
    AND mj.status IN ('pending', 'reserved')
    AND (mj.message_data->>'source' IS DISTINCT FROM 'inbox_reply')
    AND (mj.message_data->>'source' IS DISTINCT FROM 'inbox_forward');

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION cancel_unsent_campaign_jobs(UUID, TEXT) IS
  'Sets pending/reserved message_jobs to cancelled for a campaign; skips manual inbox jobs (message_data.source inbox_reply/inbox_forward). Authenticated callers must belong to the campaign account; service role may cancel any.';

GRANT EXECUTE ON FUNCTION public.cancel_unsent_campaign_jobs(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_unsent_campaign_jobs(UUID, TEXT) TO service_role;
