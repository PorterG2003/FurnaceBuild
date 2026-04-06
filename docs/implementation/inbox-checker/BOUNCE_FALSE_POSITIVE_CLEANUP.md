# Cleaning up a false-positive bounce (legacy best-guess)

Older inbox-checker versions could record a `bounced` event and stop an enrollment when a bounce **did not** match a Furnace send (`event_data.matched = false`). Current behavior only records bounces after a **positive recipient match**; unmatched bounces are logged with `tag: bounce_unmatched` only.

Use this runbook if you need to fix campaign data after such a mistake.

## 1. Find the bad row(s)

In Supabase SQL editor (or `psql`), scoped by campaign:

```sql
SELECT id, created_at, lead_id, enrollment_id, message_job_id, event_data
FROM events
WHERE campaign_id = '<CAMPAIGN_UUID>'
  AND event_type = 'bounced'
  AND (event_data->>'matched') = 'false';
```

If `matched` is absent, also inspect recent `bounced` rows and compare to the bounce email / enrollment that was wrongly stopped.

## 2. Delete the incorrect `events` row(s)

```sql
DELETE FROM events
WHERE id = '<EVENT_UUID>';
```

Deleting the row removes the idempotency guard for that bounce `Message-ID` / UID. After deploying the fixed worker, the same stale bounce in the mailbox will **not** create a new event (unmatched path). If you ever rolled back the fix, the bounce could be processed again.

## 3. Fix the enrollment

If the lead should continue in the campaign, set state back to `active` (or the correct state) and clear bounce stop fields:

```sql
UPDATE enrollments
SET state = 'active',
    stopped_reason = NULL,
    stopped_at = NULL,
    updated_at = NOW()
WHERE id = '<ENROLLMENT_UUID>'
  AND deleted_at IS NULL;
```

Adjust `state` if the enrollment should be `paused` instead.

## 4. Optional: remove an auto block

Hard bounces could upsert `block_list` with `reason = 'bounced'`. Remove the row if it was for the mis-attributed lead:

```sql
DELETE FROM block_list
WHERE account_id = '<ACCOUNT_UUID>'
  AND type = 'email'
  AND LOWER(value) = LOWER('<lead_email>')
  AND reason = 'bounced';
```

## 5. Reconcile `campaign_stats`

Recompute `bounce_count` and `last_bounce_at` from remaining `events`:

- Run `reconcile_campaign_stats` for that campaign (see [CAMPAIGN_STATS_CALCULATIONS.md](../campaign-stats/CAMPAIGN_STATS_CALCULATIONS.md) reconciliation section), or:

```bash
CAMPAIGN_ID=<CAMPAIGN_UUID> npx tsx scripts/reconcile-campaign-stats.ts
```

## 6. Verify in the app

- Campaign bounce total and chart should drop after reconcile.
- Lead row should no longer show **Stopped (Bounced)** once the enrollment is updated.

## Example (notification tester campaign)

For the known false positive (`campaign_id` `d61fb611-3d82-4793-aead-20bdb2608f71`, `event_data.matched = false`), use the IDs from your `events` / `enrollments` query in the steps above, then reconcile that campaign.
