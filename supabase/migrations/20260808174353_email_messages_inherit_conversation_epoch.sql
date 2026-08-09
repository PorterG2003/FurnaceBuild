-- Keep conversation_root_message_id populated for rows written after the backfill.
--
-- The companion migration (20260807203000) added the column and backfilled history,
-- but only the outbound path stamps it: the inbox checker inserts inbound replies
-- with no epoch, so every newly ingested reply lands NULL. Send-time threading is
-- unaffected because the timeline recomputes epochs by walking the thread in order,
-- but the stored column is what groups a thread's conversations for reads, and a
-- column that is only sometimes right is worse than one that is always right.
--
-- Resolving this at insert keeps the invariant with the data rather than in one
-- worker, so no current or future writer can forget it. Application code may still
-- pass an explicit value; the trigger only fills the gap when none was supplied.

CREATE OR REPLACE FUNCTION public.email_messages_inherit_conversation_epoch()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  parent_epoch TEXT;
BEGIN
  IF NEW.conversation_root_message_id IS NOT NULL OR NEW.thread_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- A reply belongs to the epoch of whatever it answers. A parent that opened its
  -- own epoch carries the key; one predating the backfill is its own root.
  IF NEW.in_reply_to IS NOT NULL THEN
    SELECT COALESCE(em.conversation_root_message_id, em.message_id)
      INTO parent_epoch
      FROM public.email_messages em
     WHERE em.thread_id = NEW.thread_id
       AND em.message_id = NEW.in_reply_to
     LIMIT 1;
  END IF;

  -- Headers can name a parent we never stored (the lead replied from a client that
  -- rewrote them, or we matched the thread by participants). Continuing the most
  -- recent epoch matches how the timeline would place it.
  IF parent_epoch IS NULL THEN
    SELECT em.conversation_root_message_id
      INTO parent_epoch
      FROM public.email_messages em
     WHERE em.thread_id = NEW.thread_id
       AND em.conversation_root_message_id IS NOT NULL
     ORDER BY em.received_at DESC, em.id DESC
     LIMIT 1;
  END IF;

  -- The first message in a thread has no ancestor and roots its own epoch.
  NEW.conversation_root_message_id := COALESCE(parent_epoch, NEW.message_id);
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.email_messages_inherit_conversation_epoch() IS
  'Fills conversation_root_message_id on insert when the writer did not supply one, by inheriting the epoch of the in_reply_to parent.';

DROP TRIGGER IF EXISTS trg_email_messages_inherit_conversation_epoch ON public.email_messages;

CREATE TRIGGER trg_email_messages_inherit_conversation_epoch
  BEFORE INSERT ON public.email_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.email_messages_inherit_conversation_epoch();

-- Close the gap for inbound rows already ingested since the backfill.
UPDATE public.email_messages em
SET conversation_root_message_id = COALESCE(parent.conversation_root_message_id, parent.message_id)
FROM public.email_messages parent
WHERE em.conversation_root_message_id IS NULL
  AND em.thread_id IS NOT NULL
  AND em.in_reply_to IS NOT NULL
  AND parent.thread_id = em.thread_id
  AND parent.message_id = em.in_reply_to
  AND COALESCE(parent.conversation_root_message_id, parent.message_id) IS NOT NULL;
