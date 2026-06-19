-- Smartlead inbox threads are imported history and should start closed by default.
UPDATE public.email_threads
SET
  conversation_status = 'closed',
  conversation_status_source = 'system'
WHERE conversation_status <> 'closed'
  AND smartlead_lead_id IS NOT NULL;
