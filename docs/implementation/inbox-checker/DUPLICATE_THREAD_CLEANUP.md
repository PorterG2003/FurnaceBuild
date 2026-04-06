# Duplicate Inbox Thread Cleanup

Use this playbook before applying `20260411160000_add_inbox_thread_message_uniqueness.sql` in any environment that may already contain duplicate inbox threads or duplicate `message_id` rows.

## Audit

Run these queries first.

```sql
SELECT
  message_job_id,
  COUNT(*) AS thread_count,
  ARRAY_AGG(id ORDER BY created_at) AS thread_ids
FROM email_threads
WHERE message_job_id IS NOT NULL
GROUP BY message_job_id
HAVING COUNT(*) > 1
ORDER BY thread_count DESC, message_job_id;
```

```sql
SELECT
  account_id,
  message_id,
  COUNT(*) AS message_count,
  ARRAY_AGG(id ORDER BY created_at) AS email_message_ids
FROM email_messages
WHERE message_id IS NOT NULL
GROUP BY account_id, message_id
HAVING COUNT(*) > 1
ORDER BY message_count DESC, account_id, message_id;
```

```sql
SELECT
  LOWER(TRIM(email_address)) AS normalized_email,
  COUNT(*) AS mailbox_count,
  ARRAY_AGG(id ORDER BY created_at) AS mailbox_ids,
  ARRAY_AGG(account_id ORDER BY created_at) AS account_ids
FROM mailboxes
WHERE deleted_at IS NULL
  AND status = 'connected'
GROUP BY LOWER(TRIM(email_address))
HAVING COUNT(*) > 1
ORDER BY mailbox_count DESC, normalized_email;
```

## Canonical Thread Rule

When multiple `email_threads` share the same `message_job_id`, keep the earliest-created thread as canonical.

Tie-breakers:

1. Earliest `email_threads.created_at`
2. Earliest `email_threads.id`

This matches the worker fallback logic and keeps future reply-to-reply matching deterministic.

## Merge Steps

Run the merge inside a transaction in the SQL editor or a controlled script.

1. Pick a single duplicate group by `message_job_id`.
2. Record the canonical thread ID and the duplicate thread IDs.
3. Delete duplicate `email_messages` rows that would violate the upcoming `(account_id, message_id)` unique index.
4. Re-point remaining `email_messages.thread_id` rows from duplicate threads to the canonical thread.
5. Re-point `thread_tag_assignments.thread_id` rows from duplicate threads to the canonical thread.
6. Recompute the canonical thread metadata from the surviving `email_messages`.
7. Delete the duplicate `email_threads` rows.
8. Re-run the audit queries until they return zero rows.

## Recommended SQL Skeleton

Replace the IDs in the CTE before running.

```sql
BEGIN;

WITH thread_map AS (
  SELECT
    'canonical-thread-id'::uuid AS canonical_thread_id,
    unnest(ARRAY[
      'duplicate-thread-id-1'::uuid,
      'duplicate-thread-id-2'::uuid
    ]) AS duplicate_thread_id
),
dedupe_messages AS (
  SELECT em.id
  FROM (
    SELECT
      em.id,
      ROW_NUMBER() OVER (
        PARTITION BY em.account_id, em.message_id
        ORDER BY et.created_at ASC, em.created_at ASC, em.id ASC
      ) AS rn
    FROM email_messages em
    JOIN email_threads et ON et.id = em.thread_id
    WHERE em.thread_id IN (
      SELECT canonical_thread_id FROM thread_map
      UNION
      SELECT duplicate_thread_id FROM thread_map
    )
      AND em.message_id IS NOT NULL
  ) em
  WHERE em.rn > 1
)
DELETE FROM email_messages
WHERE id IN (SELECT id FROM dedupe_messages);

WITH thread_map AS (
  SELECT
    'canonical-thread-id'::uuid AS canonical_thread_id,
    unnest(ARRAY[
      'duplicate-thread-id-1'::uuid,
      'duplicate-thread-id-2'::uuid
    ]) AS duplicate_thread_id
)
UPDATE email_messages em
SET thread_id = tm.canonical_thread_id
FROM thread_map tm
WHERE em.thread_id = tm.duplicate_thread_id;

WITH thread_map AS (
  SELECT
    'canonical-thread-id'::uuid AS canonical_thread_id,
    unnest(ARRAY[
      'duplicate-thread-id-1'::uuid,
      'duplicate-thread-id-2'::uuid
    ]) AS duplicate_thread_id
)
UPDATE thread_tag_assignments tta
SET thread_id = tm.canonical_thread_id
FROM thread_map tm
WHERE tta.thread_id = tm.duplicate_thread_id;

UPDATE email_threads et
SET
  has_reply = EXISTS (
    SELECT 1
    FROM email_messages em
    WHERE em.thread_id = et.id
      AND em.direction = 'received'
  ),
  last_message_at = (
    SELECT MAX(em.received_at)
    FROM email_messages em
    WHERE em.thread_id = et.id
  ),
  message_count = (
    SELECT COUNT(*)
    FROM email_messages em
    WHERE em.thread_id = et.id
  ),
  participants = COALESCE((
    SELECT ARRAY(
      SELECT DISTINCT email_value
      FROM (
        SELECT em.from_email AS email_value
        FROM email_messages em
        WHERE em.thread_id = et.id
        UNION ALL
        SELECT em.to_email AS email_value
        FROM email_messages em
        WHERE em.thread_id = et.id
      ) participants
      WHERE email_value IS NOT NULL AND email_value <> ''
      ORDER BY email_value
    )
  ), '{}'),
  updated_at = NOW()
WHERE et.id = 'canonical-thread-id'::uuid;

DELETE FROM email_threads
WHERE id IN (
  'duplicate-thread-id-1'::uuid,
  'duplicate-thread-id-2'::uuid
);

COMMIT;
```

## Validation

After cleanup, confirm:

```sql
SELECT 1
FROM email_threads
WHERE message_job_id IS NOT NULL
GROUP BY message_job_id
HAVING COUNT(*) > 1;
```

```sql
SELECT 1
FROM email_messages
WHERE message_id IS NOT NULL
GROUP BY account_id, message_id
HAVING COUNT(*) > 1;
```

Only apply the uniqueness migration after both queries return zero rows.
