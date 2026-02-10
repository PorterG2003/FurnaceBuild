# Email Parsing Backfill Runbook

Use this runbook to repair already-ingested received emails that still contain
quoted-printable artifacts (for example `=C2=A0`, `=E2=80=AF`, `&am= p;`, `<= /div>`).

## 1) Apply Migration

Apply migration:

- `supabase/migrations/20260210000000_add_parse_version_to_email_messages.sql`

This adds `email_messages.parse_version` for idempotent reparsing:

- `1` = original parse
- `2+` = reparsed/backfilled

## 2) Candidate SQL (Inspect First)

Run in Supabase SQL editor:

```sql
SELECT
  em.id,
  em.thread_id,
  em.imap_uid,
  em.parse_version,
  em.received_at,
  LEFT(COALESCE(em.body_text, ''), 180) AS body_text_sample
FROM email_messages em
WHERE em.direction = 'received'
  AND em.imap_uid IS NOT NULL
  AND em.parse_version < 2
  AND (
    COALESCE(em.body_text, '') ~ '=([A-Fa-f0-9]{2})'
    OR COALESCE(em.body_html, '') ~ '=([A-Fa-f0-9]{2})'
    OR COALESCE(em.body_text, '') ILIKE '%&am= p;%'
    OR COALESCE(em.body_html, '') ILIKE '%<= /%'
    OR COALESCE(em.body_text, '') ~ '([A-Za-z0-9])=\\s+([A-Za-z0-9<])'
  )
ORDER BY em.received_at DESC
LIMIT 200;
```

## 3) Dry Run Backfill

From repo root:

```bash
cd workers/inbox-checker-worker
DRY_RUN=true BATCH_SIZE=100 SUPABASE_URL=... SUPABASE_SECRET_KEY=... npm run backfill:reparse
```

## 4) Real Backfill

```bash
cd workers/inbox-checker-worker
DRY_RUN=false BATCH_SIZE=100 SUPABASE_URL=... SUPABASE_SECRET_KEY=... npm run backfill:reparse
```

The script reparses by `imap_uid` and updates:

- `body_text`
- `body_html`
- `parse_version = 2`

## 5) Post-Run Verification

```sql
SELECT
  COUNT(*) FILTER (WHERE direction = 'received' AND parse_version >= 2) AS reparsed_count,
  COUNT(*) FILTER (
    WHERE direction = 'received'
      AND (
        COALESCE(body_text, '') ~ '=([A-Fa-f0-9]{2})'
        OR COALESCE(body_html, '') ~ '=([A-Fa-f0-9]{2})'
      )
  ) AS still_artifact_like
FROM email_messages;
```

If `still_artifact_like` is non-zero, inspect those rows for malformed source email or IMAP retrieval issues.

## 6) Attachment Metadata Compatibility Check

Run:

- `supabase/verify_attachment_part_compatibility.sql`

This verifies that `attachments[]` entries still carry both:

- `part`
- `imapUid`

so `fetchEmailAttachment` can continue using IMAP part-based download.

