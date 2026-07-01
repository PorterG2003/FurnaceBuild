-- Before empty webhook_enabled_events meant "all events". Empty now means none.
-- Preserve delivery for accounts that already configured a webhook URL with the legacy empty list.

UPDATE public.accounts
SET webhook_enabled_events = '[
  "lead.created",
  "lead.updated",
  "lead.deleted",
  "lead.bulk_import.completed",
  "lead.added_to_campaign.completed",
  "lead.removed_from_campaign.completed",
  "lead.removed_from_all_campaigns.completed",
  "enrollment.pause_completed",
  "enrollment.resume_completed",
  "campaign.paused",
  "campaign.resumed",
  "campaign.stopped",
  "email.sent",
  "reply.received",
  "reply.categorized",
  "bounce.detected"
]'::jsonb
WHERE webhook_url IS NOT NULL
  AND btrim(webhook_url) <> ''
  AND webhook_enabled_events = '[]'::jsonb;
