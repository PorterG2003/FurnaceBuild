# Smart Handling Backfill

Use this runbook to preview or backfill smart handling for historical inbox
threads that are still open but never entered the classify pipeline.

## 1) Candidate SQL (Inspect First)

Run in the Supabase SQL editor:

```sql
WITH latest_received AS (
  SELECT DISTINCT ON (em.thread_id)
    em.thread_id,
    em.id AS email_message_id,
    em.from_email,
    em.subject,
    em.received_at
  FROM email_messages em
  WHERE em.direction = 'received'
  ORDER BY em.thread_id, em.received_at DESC NULLS LAST, em.created_at DESC
)
SELECT
  t.id AS thread_id,
  t.account_id,
  t.campaign_id,
  t.enrollment_id,
  t.last_message_at,
  t.category,
  t.category_source,
  lr.email_message_id,
  lr.from_email,
  lr.subject,
  lr.received_at
FROM email_threads t
JOIN latest_received lr
  ON lr.thread_id = t.id
WHERE t.conversation_status = 'open'
  AND t.classification_status = 'none'
  AND t.has_reply IS TRUE
ORDER BY t.last_message_at DESC NULLS LAST
LIMIT 200;
```

## 2) Dry Run

From repo root:

```bash
npx tsx scripts/backfill-smart-handling-open-threads.ts
```

Useful scoping examples:

```bash
ACCOUNT_ID=<account-id> LIMIT=25 npx tsx scripts/backfill-smart-handling-open-threads.ts
CAMPAIGN_ID=<campaign-id> LIMIT=50 npx tsx scripts/backfill-smart-handling-open-threads.ts
SELF_RECOVERY_TARGET_ENV=prod LIMIT=100 npx tsx scripts/backfill-smart-handling-open-threads.ts
```

The script prints:

- total matching open threads in scope
- preview rows with the latest received message per thread
- whether each thread would run in manual or AI categorizer mode

## 3) Limited Production Apply

Start with a narrow scope first:

```bash
SELF_RECOVERY_TARGET_ENV=prod ACCOUNT_ID=<account-id> LIMIT=10 BATCH_SIZE=5 APPLY=true npx tsx scripts/backfill-smart-handling-open-threads.ts
```

For a campaign-scoped run:

```bash
SELF_RECOVERY_TARGET_ENV=prod CAMPAIGN_ID=<campaign-id> LIMIT=25 BATCH_SIZE=5 APPLY=true npx tsx scripts/backfill-smart-handling-open-threads.ts
```

Notes:

- `APPLY=true` is required for writes.
- The script marks each claimed thread `classification_status = 'pending'` before invoking the existing classify logic.
- Threads that change out of `classification_status = 'none'` before claim are skipped.
- AI-categorizer campaign threads intentionally reuse live classify side effects, including category updates and `wake_enrollment_for_thread_category`.

## 4) Broad Production Apply

After a limited run looks correct:

```bash
SELF_RECOVERY_TARGET_ENV=prod LIMIT=250 BATCH_SIZE=25 APPLY=true npx tsx scripts/backfill-smart-handling-open-threads.ts
```

If the current worker environment is not already loaded, make sure the command
has access to:

- `OPENROUTER_API_KEY`
- Supabase service-role credentials, either directly or through the existing
  SSM-based self-recovery env resolution

## 5) Post-Run Verification

Check overall state:

```sql
SELECT
  COUNT(*) FILTER (
    WHERE conversation_status = 'open'
      AND classification_status = 'none'
      AND has_reply IS TRUE
  ) AS open_unclassified_threads,
  COUNT(*) FILTER (
    WHERE conversation_status = 'open'
      AND classification_status = 'complete'
      AND handling_metadata IS NOT NULL
  ) AS open_classified_threads,
  COUNT(*) FILTER (
    WHERE conversation_status = 'open'
      AND classification_status = 'failed'
  ) AS open_failed_threads
FROM email_threads;
```

Inspect any failures:

```sql
SELECT
  id,
  account_id,
  campaign_id,
  enrollment_id,
  category,
  category_source,
  classification_requested_at,
  classification_completed_at,
  last_message_at
FROM email_threads
WHERE conversation_status = 'open'
  AND classification_status = 'failed'
ORDER BY classification_completed_at DESC NULLS LAST
LIMIT 100;
```

Confirm the backfilled UI payload exists:

```sql
SELECT
  id,
  classification_status,
  handling_metadata
FROM email_threads
WHERE conversation_status = 'open'
  AND classification_status = 'complete'
  AND handling_metadata IS NOT NULL
ORDER BY classification_completed_at DESC NULLS LAST
LIMIT 20;
```
