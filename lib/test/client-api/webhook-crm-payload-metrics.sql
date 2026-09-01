-- Re-run a week after ship and compare to webhook-crm-payload-baseline.json.
-- Prod project: lrfonoslwzodzijzdyiy

select
  event_type,
  count(*) as events,
  count(*) filter (where payload ? 'email') as with_lead_email,
  count(*) filter (where payload ? 'from_email') as with_from_email,
  count(*) filter (where payload ? 'campaign_name') as with_campaign_name,
  count(*) filter (where payload ? 'mailbox_email') as with_mailbox_email,
  count(*) filter (where payload ? 'custom_fields') as with_custom_fields,
  count(*) filter (where payload ? 'custom_fields_truncated') as truncated,
  max(pg_column_size(payload)) as max_payload_bytes,
  percentile_disc(0.99) within group (order by pg_column_size(payload)) as p99_payload_bytes
from webhook_events
where created_at >= now() - interval '7 days'
  and event_type in (
    'email.sent',
    'reply.received',
    'reply.categorized',
    'bounce.detected',
    'unsubscribe.detected'
  )
group by 1
order by 1;

select
  event_type,
  count(*) as deliveries,
  count(*) filter (where status = 'delivered') as delivered,
  count(*) filter (where status = 'failed') as failed,
  round(100.0 * count(*) filter (where status = 'delivered') / nullif(count(*), 0), 2) as success_pct,
  percentile_disc(0.95) within group (
    order by extract(epoch from (coalesce(delivered_at, last_attempt_at) - created_at))
  ) as p95_latency_seconds
from webhook_deliveries
where created_at >= now() - interval '7 days'
  and event_type in (
    'email.sent',
    'reply.received',
    'reply.categorized',
    'bounce.detected',
    'unsubscribe.detected'
  )
group by 1
order by 1;
