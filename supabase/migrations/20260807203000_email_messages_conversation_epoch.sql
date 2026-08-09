-- Stored subject epoch for email_messages.
--
-- A thread can contain more than one client-side conversation: a campaign
-- follow-up with an explicit subject deliberately starts a fresh one, carrying
-- no inherited In-Reply-To/References. Until now that boundary was implicit, so
-- outbound header building and reply backfill both stitched ancestry across the
-- whole thread and fabricated links between unrelated conversations.
--
-- conversation_root_message_id names the epoch: the wire Message-ID of the first
-- message in it. Every message in an epoch carries the same value, so ancestry,
-- subject inheritance, and prior-outbound lookups can all be scoped by it.

ALTER TABLE public.email_messages
  ADD COLUMN IF NOT EXISTS conversation_root_message_id TEXT;

COMMENT ON COLUMN public.email_messages.conversation_root_message_id IS
  'Normalized wire Message-ID of the first message in this message''s subject epoch. Scopes References ancestry and subject inheritance within a thread.';

CREATE INDEX IF NOT EXISTS idx_email_messages_thread_conversation_root
  ON public.email_messages (thread_id, conversation_root_message_id, received_at)
  WHERE conversation_root_message_id IS NOT NULL;

-- Backfill existing rows. Idempotent: only touches rows with no epoch yet, so it
-- is safe to re-run if it is interrupted.
WITH base AS (
  SELECT
    em.id,
    em.thread_id,
    em.message_id,
    em.received_at,
    em.direction,
    mj.message_data
  FROM public.email_messages em
  LEFT JOIN public.message_jobs mj ON mj.id = em.message_job_id
  WHERE em.message_id IS NOT NULL
    AND em.thread_id IS NOT NULL
    AND em.conversation_root_message_id IS NULL
),
flagged AS (
  SELECT
    base.*,
    -- An outbound carrying a real subject on its own node opened a new epoch.
    -- Empty and the "(No subject)" placeholder both mean "continue the thread".
    (
      base.direction = 'sent'
      AND COALESCE(TRIM(base.message_data -> 'node_config' ->> 'subject'), '') <> ''
      AND LOWER(TRIM(base.message_data -> 'node_config' ->> 'subject')) <> '(no subject)'
    ) AS starts_epoch,
    ROW_NUMBER() OVER (PARTITION BY base.thread_id ORDER BY base.received_at, base.id) AS rn
  FROM base
),
epoched AS (
  SELECT
    flagged.*,
    SUM(CASE WHEN flagged.starts_epoch OR flagged.rn = 1 THEN 1 ELSE 0 END) OVER (
      PARTITION BY flagged.thread_id
      ORDER BY flagged.received_at, flagged.id
      ROWS UNBOUNDED PRECEDING
    ) AS epoch_no
  FROM flagged
),
roots AS (
  SELECT
    epoched.thread_id,
    epoched.epoch_no,
    (ARRAY_AGG(epoched.message_id ORDER BY epoched.received_at, epoched.id))[1] AS root_message_id
  FROM epoched
  GROUP BY epoched.thread_id, epoched.epoch_no
)
UPDATE public.email_messages em
SET conversation_root_message_id = roots.root_message_id
FROM epoched
JOIN roots
  ON roots.thread_id = epoched.thread_id
 AND roots.epoch_no = epoched.epoch_no
WHERE em.id = epoched.id
  AND roots.root_message_id IS NOT NULL;
