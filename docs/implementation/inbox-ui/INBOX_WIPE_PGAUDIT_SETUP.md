# See what deletes data next time (audit setup)

So that the next time something wipes the inbox (or deletes campaigns/mailboxes/leads), you can see what happened.

You have **two options**. Use the **trigger-based audit** (no extension) if `pgaudit` is not available.

---

## Option A: Trigger-based audit (no extension) — **use this if pgaudit isn’t available**

Runs with standard Postgres; no extensions.

**Access:** The audit table is for **ops/debug only**. Do not expose it via the app API. Query it from the Supabase Dashboard (SQL Editor) or with the service role. If you ever expose it (e.g. admin UI), enable RLS and restrict SELECT to service role or a dedicated audit-reader role.

### Tables tracked

Only **DELETE** is audited by default (row-level). **TRUNCATE** does not fire row triggers, so a plain TRUNCATE would leave no per-row audit entries. Avoid TRUNCATE on these tables if you need a row-level trail; use DELETE instead. If you run the optional migration **`20260213100003_audit_deletes_index_and_truncate.sql`**, AFTER TRUNCATE triggers are added so TRUNCATE events are logged as one audit row per table (with `deleted_row = '{"truncate": true}'`, no row payload).

BEFORE DELETE is logged (and the full row stored) for:

| Table | Why |
|-------|-----|
| **email_threads** | Inbox threads; cascade deletes wipe the inbox |
| **email_messages** | Inbox messages |
| **campaigns** | Deleting a campaign cascades to enrollments, message_jobs, then threads/messages |
| **mailboxes** | Can cascade to threads/messages |
| **leads** | Can cascade to enrollments, threads, etc. |
| **enrollments** | Per-lead campaign enrollment |
| **message_jobs** | Scheduled send jobs; cascade can remove thread links |

### What it does

- Creates **`audit_delete_log`** and **BEFORE DELETE** triggers on the tables above.
- Each delete inserts one row with:
  - **table_name**, **record_id**, **deleted_at**, **deleted_by**
  - **deleted_row** (JSONB): full row at delete time so you can **recover** it (see below).

**PII and retention:** `deleted_row` stores the full row, which may include PII (emails, names, body content, custom_lead_data, etc.). Audit rows are retained for 7 days (see prune below). Ensure this aligns with your privacy/compliance.

**Who is logged:** `deleted_by` is the **Postgres role** only (e.g. `authenticator`, `postgres`). You do not get application user id or API key; for app-level attribution you would need the app to set a session variable before deletes.

**Deletes on the audit table:** Deletes or TRUNCATE on `audit_delete_log` itself are **not** audited (to avoid recursion).

**Bulk deletes:** One campaign delete can cascade to many enrollments, message_jobs, threads, and messages. Each row causes one INSERT into the audit table. For typical “inbox wipe” scale this is acceptable; if you see performance issues, consider batching only if proven necessary.

**Primary key assumption:** The trigger supports only tables with a single column `id` of type UUID. All seven tracked tables match. If you add another table with a different PK (e.g. composite or bigint), you must generalize the trigger or use a table-specific trigger.

### Apply it

1. Run **`20260213100001_audit_deletes_trigger.sql`**.
2. Run **`20260213100002_audit_deletes_store_row_and_prune.sql`** (adds `deleted_row` and prune function).
3. Run **`20260213100003_audit_deletes_index_and_truncate.sql`** (adds index on `deleted_at` for prune performance and TRUNCATE auditing).
4. Optional: Run **`20260213100004_audit_delete_log_pgcron_schedule.sql`** to schedule the 7-day prune daily at 03:00 UTC via pg_cron. If the pg_cron extension is not installed, the migration does nothing.

### 7-day retention (auto-delete old audit rows)

**To enforce 7-day retention you must schedule the prune.** The migration runs it once; after that, nothing runs it again unless you schedule it.

Audit rows are kept for **7 days** by default. To prune older rows:

- **Run manually:**  
  `SELECT audit_delete_log_prune(7);`  
  (use a different number for more/fewer days).

- **Run daily with pg_cron** (if the extension is enabled):  
  Either run the optional migration **`20260213100004_audit_delete_log_pgcron_schedule.sql`** (it no-ops if pg_cron is missing), or in SQL Editor run once:  
  `SELECT cron.schedule('audit-prune', '0 3 * * *', 'SELECT audit_delete_log_prune(7)');`  
  (3:00 UTC every day).

- **Without pg_cron:** Call the same SQL from an external cron or a scheduled Supabase Edge Function.

The second migration runs `audit_delete_log_prune(7)` once; after that, you must schedule it as above or retention will not be enforced.

### How to use it next time (investigation)

After a wipe, run in SQL Editor:

```sql
SELECT id, table_name, record_id, deleted_at, deleted_by
FROM audit_delete_log
ORDER BY deleted_at DESC
LIMIT 100;
```

Or filter by table and time:

```sql
SELECT * FROM audit_delete_log
WHERE table_name IN ('email_threads', 'email_messages', 'campaigns', 'mailboxes', 'leads')
  AND deleted_at > NOW() - INTERVAL '7 days'
ORDER BY deleted_at DESC;
```

You’ll see which table, which record id, when, and which role (`postgres` = Dashboard, `authenticator` or anon/authenticated = API/app).

### Recovering deleted data

Each row in `audit_delete_log` has **`deleted_row`** (JSONB) with the full row at delete time.

**Recovery order:** Restore parents before children to satisfy foreign keys. Suggested order: **campaigns** → **mailboxes**, **leads** → **enrollments** → **message_jobs** → **email_threads** → **email_messages**. The column list in your INSERT must match the table definition (use `information_schema.columns` or the Table Editor to get the exact list).

**Example — inspect then restore one row:**

```sql
-- Inspect what was deleted
SELECT table_name, record_id, deleted_at, deleted_row
FROM audit_delete_log
WHERE table_name = 'email_threads'
ORDER BY deleted_at DESC
LIMIT 10;

-- Restore one row: list all columns for the target table and map from deleted_row
INSERT INTO email_threads (id, account_id, campaign_id, lead_id, enrollment_id, message_job_id, mailbox_id, subject, participants, last_message_at, message_count, has_reply, created_at, updated_at)
SELECT (deleted_row->>'id')::uuid,
       (deleted_row->>'account_id')::uuid,
       (deleted_row->>'campaign_id')::uuid,
       (deleted_row->>'lead_id')::uuid,
       (deleted_row->>'enrollment_id')::uuid,
       (deleted_row->>'message_job_id')::uuid,
       (deleted_row->>'mailbox_id')::uuid,
       deleted_row->>'subject',
       ARRAY(SELECT jsonb_array_elements_text(deleted_row->'participants')),
       (deleted_row->>'last_message_at')::timestamptz,
       (deleted_row->>'message_count')::int,
       (deleted_row->>'has_reply')::boolean,
       (deleted_row->>'created_at')::timestamptz,
       (deleted_row->>'updated_at')::timestamptz
FROM audit_delete_log
WHERE id = '<audit_delete_log.id of the row you want to restore>';
```

For bulk recovery, insert many rows from `deleted_row` in dependency order; handle unique conflicts if a row was re-created. Each table has a different column set — use a script or one INSERT shape per table.

---

## Option B: PGAudit (Postgres logs)

Uses the **pgaudit** extension so that DELETE (and other writes) are written to **Postgres logs**.

### 1. Enable the extension

- **Dashboard:** Database → Extensions → search **`pgaudit`** (or filter by **Audit**) → Enable.  
- If it’s **not in the list**, try in the **SQL Editor**:  
  `CREATE EXTENSION IF NOT EXISTS pgaudit;`  
  If that fails, use **Option A** (trigger-based audit) instead.

### 2. Turn on write logging

Run the migration **`20260213100000_enable_pgaudit_write_logging.sql`**. It sets `pgaudit.log = 'write'` for the `authenticator` and `postgres` roles. If the extension isn’t enabled, this migration will fail — in that case use Option A.

### 3. What you’ll see

In **Dashboard → Logs → Postgres Logs** you’ll see lines like:

```text
AUDIT: SESSION,...,WRITE,DELETE,TABLE,public.campaigns,delete from campaigns where ...
```

Search for **`AUDIT`** and **`DELETE`** (or table names like **`email_threads`**, **`campaigns`**).

---

## Summary

| If… | Do this |
|-----|--------|
| **pgaudit is not in Extensions** | Use **Option A** only: run migrations `20260213100001`, `20260213100002`, and `20260213100003`. Query **`audit_delete_log`** after a wipe. |
| **pgaudit is available** | Enable it (Dashboard or `CREATE EXTENSION pgaudit`), then run the Option A migrations too. You get both the table and Postgres log lines. |

The trigger-based audit (Option A) works in all Supabase projects and does not depend on any extension.
