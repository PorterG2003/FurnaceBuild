-- Re-run after ship and compare to webhook-crm-payload-baseline.json
-- plus webhook-blocklist-metrics.json gates.
-- Prod project: lrfonoslwzodzijzdyiy
--
-- Gates:
--   leftover event_type = 'blocked' = 0
--   type=email events have payload.email = payload.value (100%)
--   new block_list inserts ≈ blocklist.entry_added
--   block_list deletes ≈ blocklist.entry_removed
--   hard-bounce block_list rows have both bounce.detected and entry_added
--   webhook_deliveries success ≥ 99% for the two blocklist types
--   p99 payload < 8192 bytes

select
  event_type,
  count(*) as events,
  count(*) filter (where payload ? 'email') as with_lead_email,
  count(*) filter (where payload ? 'from_email') as with_from_email,
  count(*) filter (where payload ? 'campaign_name') as with_campaign_name,
  count(*) filter (where payload ? 'mailbox_email') as with_mailbox_email,
  count(*) filter (where payload ? 'custom_fields') as with_custom_fields,
  count(*) filter (where payload ? 'custom_fields_truncated') as truncated,
  count(*) filter (where payload ? 'value') as with_value,
  count(*) filter (where payload ? 'type') as with_type,
  max(pg_column_size(payload)) as max_payload_bytes,
  percentile_disc(0.99) within group (order by pg_column_size(payload)) as p99_payload_bytes
from webhook_events
where created_at >= now() - interval '7 days'
  and event_type in (
    'email.sent',
    'reply.received',
    'reply.categorized',
    'bounce.detected',
    'blocklist.entry_added',
    'blocklist.entry_removed',
    'blocked'
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
    'blocklist.entry_added',
    'blocklist.entry_removed',
    'blocked'
  )
group by 1
order by 1;

-- Leftover blocked event (gate: 0)
select count(*) as leftover_blocked_events
from webhook_events
where created_at >= now() - interval '7 days'
  and event_type = 'blocked';

-- Reason / source breakdown
select
  event_type,
  payload->>'reason' as reason,
  payload->>'source' as source,
  count(*) as events
from webhook_events
where created_at >= now() - interval '7 days'
  and event_type in ('blocklist.entry_added', 'blocklist.entry_removed')
group by 1, 2, 3
order by 1, 4 desc;

-- Email present on email-type rows (gate: 100%)
select
  event_type,
  count(*) as email_type_events,
  count(*) filter (
    where payload->>'email' = payload->>'value'
  ) as email_equals_value
from webhook_events
where created_at >= now() - interval '7 days'
  and event_type in ('blocklist.entry_added', 'blocklist.entry_removed')
  and payload->>'type' = 'email'
group by 1
order by 1;

-- Coverage: new block_list rows vs entry_added
select
  (select count(*) from block_list where created_at >= now() - interval '7 days') as block_list_inserts,
  (
    select count(*)
    from webhook_events
    where created_at >= now() - interval '7 days'
      and event_type = 'blocklist.entry_added'
  ) as entry_added_events;

-- Dual-emit: bounced block_list rows should have bounce.detected + entry_added
select
  count(*) as bounced_block_rows,
  count(*) filter (
    where exists (
      select 1
      from webhook_events we
      where we.account_id = bl.account_id
        and we.event_type = 'bounce.detected'
        and we.created_at >= bl.created_at - interval '2 minutes'
        and we.created_at <= bl.created_at + interval '2 minutes'
        and we.payload->>'email' = bl.value
    )
    and exists (
      select 1
      from webhook_events we
      where we.account_id = bl.account_id
        and we.event_type = 'blocklist.entry_added'
        and we.created_at >= bl.created_at - interval '2 minutes'
        and we.created_at <= bl.created_at + interval '2 minutes'
        and we.payload->>'value' = bl.value
    )
  ) as dual_emit_rows
from block_list bl
where bl.created_at >= now() - interval '7 days'
  and bl.reason = 'bounced';
