-- Add a dedicated dedupe key for bounced events so new rows can be made
-- idempotent without first rewriting legacy duplicate data.

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS bounce_dedupe_key TEXT;

COMMENT ON COLUMN public.events.bounce_dedupe_key IS
  'Mailbox-scoped physical bounce identity for bounced events (normalized message-id or IMAP uid). Used for idempotent bounce recording.';

WITH normalized_bounces AS (
  SELECT
    e.id,
    e.mailbox_id,
    COALESCE(
      CASE
        WHEN NULLIF(
          regexp_replace(
            lower(trim(COALESCE(e.event_data->>'bounce_message_id', ''))),
            '(^<|>$)',
            '',
            'g'
          ),
          ''
        ) IS NOT NULL
          THEN 'mid:' || NULLIF(
            regexp_replace(
              lower(trim(COALESCE(e.event_data->>'bounce_message_id', ''))),
              '(^<|>$)',
              '',
              'g'
            ),
            ''
          )
      END,
      CASE
        WHEN NULLIF(trim(COALESCE(e.event_data->>'bounce_uid', '')), '') IS NOT NULL
          THEN 'uid:' || NULLIF(trim(COALESCE(e.event_data->>'bounce_uid', '')), '')
      END
    ) AS dedupe_key
  FROM public.events e
  WHERE e.event_type = 'bounced'
    AND e.bounce_dedupe_key IS NULL
),
unique_bounces AS (
  SELECT mailbox_id, dedupe_key
  FROM normalized_bounces
  WHERE dedupe_key IS NOT NULL
  GROUP BY mailbox_id, dedupe_key
  HAVING COUNT(*) = 1
)
UPDATE public.events e
SET bounce_dedupe_key = nb.dedupe_key
FROM normalized_bounces nb
INNER JOIN unique_bounces ub
  ON ub.mailbox_id = nb.mailbox_id
 AND ub.dedupe_key = nb.dedupe_key
WHERE e.id = nb.id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_events_unique_bounced_mailbox_dedupe
  ON public.events (mailbox_id, bounce_dedupe_key, event_type)
  WHERE event_type = 'bounced' AND bounce_dedupe_key IS NOT NULL;

DROP FUNCTION IF EXISTS record_bounced_event_and_increment(UUID, UUID, UUID, UUID, UUID, JSONB);

CREATE OR REPLACE FUNCTION record_bounced_event_and_increment(
  p_campaign_id UUID,
  p_lead_id UUID,
  p_enrollment_id UUID,
  p_message_job_id UUID,
  p_mailbox_id UUID,
  p_event_data JSONB DEFAULT '{}'
)
RETURNS BOOLEAN AS $$
DECLARE
  v_account_id UUID;
  v_rows_inserted INT;
  v_bounce_message_id TEXT;
  v_bounce_uid TEXT;
  v_bounce_dedupe_key TEXT;
BEGIN
  SELECT account_id INTO v_account_id FROM campaigns WHERE id = p_campaign_id;
  IF v_account_id IS NULL THEN
    RETURN false;
  END IF;

  v_bounce_message_id := NULLIF(
    regexp_replace(
      lower(trim(COALESCE(p_event_data->>'bounce_message_id', ''))),
      '(^<|>$)',
      '',
      'g'
    ),
    ''
  );
  v_bounce_uid := NULLIF(trim(COALESCE(p_event_data->>'bounce_uid', '')), '');
  v_bounce_dedupe_key := COALESCE(
    CASE WHEN v_bounce_message_id IS NOT NULL THEN 'mid:' || v_bounce_message_id END,
    CASE WHEN v_bounce_uid IS NOT NULL THEN 'uid:' || v_bounce_uid END
  );

  INSERT INTO events (
    campaign_id,
    account_id,
    lead_id,
    enrollment_id,
    message_job_id,
    mailbox_id,
    event_type,
    event_data,
    bounce_dedupe_key
  )
  VALUES (
    p_campaign_id,
    v_account_id,
    p_lead_id,
    p_enrollment_id,
    p_message_job_id,
    p_mailbox_id,
    'bounced',
    COALESCE(p_event_data, '{}'),
    v_bounce_dedupe_key
  )
  ON CONFLICT (mailbox_id, bounce_dedupe_key, event_type)
    WHERE (event_type = 'bounced' AND bounce_dedupe_key IS NOT NULL)
  DO NOTHING;

  GET DIAGNOSTICS v_rows_inserted = ROW_COUNT;

  IF v_rows_inserted > 0 THEN
    INSERT INTO campaign_stats (
      campaign_id,
      account_id,
      sent_count,
      replied_count,
      positive_reply_count,
      bounce_count,
      last_bounce_at,
      updated_at
    )
    VALUES (p_campaign_id, v_account_id, 0, 0, 0, 1, NOW(), NOW())
    ON CONFLICT (campaign_id) DO UPDATE SET
      bounce_count = campaign_stats.bounce_count + 1,
      last_bounce_at = GREATEST(COALESCE(campaign_stats.last_bounce_at, TIMESTAMPTZ '1970-01-01'), NOW()),
      updated_at = NOW();
  END IF;

  RETURN v_rows_inserted > 0;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION record_bounced_event_and_increment IS
  'Insert a bounced event once per mailbox-scoped physical bounce and increment campaign_stats only when a new row was inserted.';
