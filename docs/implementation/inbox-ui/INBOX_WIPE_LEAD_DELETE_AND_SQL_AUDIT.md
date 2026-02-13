# Lead deletion paths + SQL-from-conversation audit

Audit: (1) every way a lead can be deleted in this repo, and (2) every SQL query given in the inbox-wipe conversation — to confirm none of that SQL could have deleted leads or wiped threads.

---

## 1. Every way a lead can be deleted

### 1.1 Direct row delete (hard delete)

| Location | Function | What it does | Who calls it? |
|----------|----------|--------------|----------------|
| `lib/supabase/services/leads.ts` | `hardDeleteLead(id)` | `supabase.from('leads').delete().eq('id', id)` | **Nobody.** No imports or references anywhere in app, workers, or scripts. |

So the only function that actually deletes a lead row is **never called**.

### 1.2 Soft delete (does not remove row)

| Location | Function | What it does | Effect on threads |
|----------|----------|--------------|-------------------|
| `lib/supabase/services/leads.ts` | `deleteLead(id)` | `supabase.from('leads').update({ status: 'removed' }).eq('id', id)` | None. Row stays; no CASCADE. |

`deleteLead` is a status update only. It is not used in the app (grep found no caller in `app/`). Even if it were, it would not delete the row or wipe threads.

### 1.3 CASCADE when another row is deleted

| Parent delete | Effect on leads | Effect on threads (before migration) |
|---------------|-----------------|--------------------------------------|
| **Campaign** deleted | All leads with `campaign_id` = that campaign are CASCADE-deleted. | All threads for that campaign are CASCADE-deleted (via campaign_id, and via message_jobs/enrollments/leads). |

You confirmed no campaign was deleted, so this path is ruled out.

### 1.4 Documented example code (not in app)

In **`docs/implementation/testing/TEST_SYSTEM_FIXES.md`** there is a **proposed** cleanup that includes:

```ts
await supabase.from('message_jobs').delete().eq('enrollment_id', enrollmentId);
await supabase.from('enrollments').delete().eq('id', enrollmentId);
// ...
await supabase.from('leads').delete().eq('id', leadId);
```

That doc says to add this to `app/(main)/test/scheduler.tsx`. **That file does not exist** in the repo, so this code is not part of the app. It would only run if someone copy-pasted it into the SQL Editor or a script. It does not run from the codebase.

---

## 2. SQL given in the inbox-wipe conversation

Every SQL file or snippet provided during this conversation:

### 2.1 `scripts/diagnose-inbox-wipe.sql`

- **Purpose:** Diagnose inbox wipe (thread/message counts, recent campaigns).
- **Statements:** Only **SELECT**. No DELETE, UPDATE, TRUNCATE, or DROP.
- **Conclusion:** Cannot delete leads or wipe threads.

### 2.2 `supabase/migrations/20260212100000_email_threads_survive_campaign_delete.sql`

- **Purpose:** Change `email_threads` FKs from CASCADE to SET NULL so deleting campaign/mailbox/lead/enrollment/message_job no longer wipes threads.
- **Statements:** Only **ALTER TABLE** (DROP CONSTRAINT, ALTER COLUMN, ADD CONSTRAINT) and COMMENT. No DELETE, UPDATE, TRUNCATE, or DROP on `leads`, `email_threads`, or `email_messages`.
- **Conclusion:** Cannot delete leads or wipe threads.

### 2.3 No other SQL

No one-off “run this in the SQL Editor” snippet was given that performs DELETE (or any write) on leads, campaigns, mailboxes, enrollments, message_jobs, email_threads, or email_messages.

---

## 3. Summary

- **Lead deletion in code:** Only `hardDeleteLead` deletes lead rows, and it is **never called**. The only other path is CASCADE when a **campaign** is deleted (ruled out).
- **SQL from this conversation:** Only read-only diagnostic SELECTs and a migration that only alters constraints. **None of it can delete leads or wipe threads.**

So the wipe could not have been caused by:
- lead delete from this codebase (no caller for hard delete; soft delete doesn’t remove rows), or  
- any SQL provided in this conversation.

If you ever ran the TEST_SYSTEM_FIXES.md cleanup snippet manually (e.g. in SQL Editor or a script), that *would* delete leads and could have wiped threads; that snippet was not given in this conversation and is not part of the app.
