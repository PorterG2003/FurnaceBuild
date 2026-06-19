-- Master Inbox redesign: open/closed state + smart handling metadata.

ALTER TABLE public.email_threads
  ADD COLUMN IF NOT EXISTS conversation_status TEXT NOT NULL DEFAULT 'open'
    CHECK (conversation_status IN ('open', 'closed')),
  ADD COLUMN IF NOT EXISTS conversation_status_source TEXT NOT NULL DEFAULT 'system'
    CHECK (conversation_status_source IN ('user', 'system')),
  ADD COLUMN IF NOT EXISTS classification_status TEXT NOT NULL DEFAULT 'none'
    CHECK (classification_status IN ('none', 'pending', 'complete', 'failed')),
  ADD COLUMN IF NOT EXISTS classification_requested_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS classification_completed_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS handling_metadata JSONB NULL;

CREATE INDEX IF NOT EXISTS idx_email_threads_account_has_reply_status_last_message
  ON public.email_threads(account_id, has_reply, conversation_status, last_message_at DESC);

COMMENT ON COLUMN public.email_threads.conversation_status IS
  'Inbox triage state: open threads sort to the top, closed threads reopen on new inbound.';
COMMENT ON COLUMN public.email_threads.conversation_status_source IS
  'Who last set conversation_status: user or system.';
COMMENT ON COLUMN public.email_threads.classification_status IS
  'Smart handling classify pipeline state: none, pending, complete, or failed.';
COMMENT ON COLUMN public.email_threads.classification_requested_at IS
  'When async smart handling classification was requested.';
COMMENT ON COLUMN public.email_threads.classification_completed_at IS
  'When async smart handling classification completed.';
COMMENT ON COLUMN public.email_threads.handling_metadata IS
  'Smart handling UI payload: primary_message, primary, alternatives, follow_ups, return_date, suggested_reply, etc.';

-- 1. Out-of-office threads become closed Auto Reply threads.
UPDATE public.email_threads
SET
  category = COALESCE(category, 'Auto Reply'),
  category_source = CASE
    WHEN category IS NULL AND category_source IS NULL THEN 'system'
    ELSE category_source
  END,
  conversation_status = 'closed',
  conversation_status_source = 'system'
WHERE out_of_office IS TRUE;

-- 2. Best-effort backfill: user-categorized threads with no unread inbound
--    are treated as already triaged.
WITH unread_threads AS (
  SELECT DISTINCT em.thread_id
  FROM public.email_messages em
  WHERE em.direction = 'received'
    AND em.read_at IS NULL
)
UPDATE public.email_threads t
SET
  conversation_status = 'closed',
  conversation_status_source = 'system'
WHERE t.conversation_status <> 'closed'
  AND t.category IS NOT NULL
  AND t.category_source = 'user'
  AND NOT EXISTS (
    SELECT 1
    FROM unread_threads ut
    WHERE ut.thread_id = t.id
  );
