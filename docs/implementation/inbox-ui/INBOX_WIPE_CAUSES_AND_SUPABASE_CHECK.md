# Inbox wipe: remaining causes (by elimination) and checking in Supabase

Assuming **no campaigns** and **no mailboxes** were deleted, these are the remaining ways `email_threads` / `email_messages` could have been wiped, and what Supabase can tell you.

---

## 1. Remaining causes (by elimination)

| Cause | How it wipes threads | In our app? |
|-------|----------------------|-------------|
| **Account deleted** | `email_threads.account_id` → `ON DELETE CASCADE`; deleting the account deletes all its threads. | No UI in repo deletes accounts. Could be Dashboard, API, or another tool. |
| **Lead(s) deleted** | `email_threads.lead_id` and `enrollment_id` CASCADE. Deleting a lead deletes its enrollments → those message_jobs → and (before the fix) threads for that lead. | `hardDeleteLead` exists in `lib/supabase/services/leads.ts` but is **never called** anywhere. So only if something outside the app (Dashboard, script, other service) deleted leads. |
| **Database reset** | `supabase db reset` or similar runs all migrations from scratch; tables are recreated empty. | Manual / CI. |
| **Restore from backup** | Restoring an older backup can bring back DB state from before threads existed (or from when they were empty). | Dashboard or support. |
| **Manual SQL** | Someone runs `DELETE FROM campaigns` or `DELETE FROM leads` (or similar) in SQL Editor or another client; CASCADE wipes threads. | Dashboard, script, or external tool. |

So by elimination, if it wasn’t campaign or mailbox delete, it was one of: **account delete**, **lead delete** (from outside the app), **db reset**, **restore**, or **manual DELETE in SQL**.

---

## 2. Can Supabase tell you what happened?

### 2.1 Postgres logs (Logs Explorer)

- **Where:** Dashboard → **Logs** → **Postgres** (or Logs Explorer).
- **What’s in there:** Query-related metadata: `parsed.query`, `parsed.command_tag`, `parsed.user_name`, `parsed.application_name`, etc.
- **Important:** By default Postgres logs **only failed queries**. Successful `DELETE`/`UPDATE` statements are **not** logged unless you changed that or use PGAudit.
- So for a **past** wipe, you only see something if:
  - The delete **failed** (then it may appear as an error), or
  - You had already enabled **PGAudit** (or similar) for write operations **before** the wipe.

**If you want to search anyway (e.g. for errors or PGAudit):**

- Logs Explorer uses a `postgres_logs`-style table; you can filter by time and by content.
- Example idea: filter by timeframe when the inbox was wiped and look for `DELETE` or `email_threads` in `event_message` or in parsed metadata (e.g. `parsed.query` if available). You’ll only get hits if those queries were actually logged (PGAudit or custom logging).

### 2.2 PGAudit extension (for future, or if already enabled)

- **What:** Logs specific operations (e.g. `write` = INSERT/DELETE/UPDATE/TRUNCATE) by role or object.
- **Where:** Dashboard → **Database** → **Extensions** → enable `pgaudit`.
- **Catch:** It only logs **from when it’s enabled**. If it wasn’t enabled before the wipe, you won’t see past deletes.
- **Use for later:** Enable it and set e.g. `ALTER ROLE postgres SET pgaudit.log = 'write';` (or a custom role for API) so future deletes are logged. Then in Logs Explorer you can filter for `event_message LIKE 'AUDIT%DELETE%'` or similar.

Docs: [PGAudit | Supabase](https://supabase.com/docs/guides/database/extensions/pgaudit).

### 2.3 Account / project audit (Dashboard)

- **Where:** Supabase Dashboard → **Account** → **Audit** (or project-level audit if available).
- **What:** Usually high-level project/account actions (e.g. project deleted, settings changed), not per-row deletes in `email_threads`. So it’s useful for “was the project/account reset or deleted?” but not for “who ran DELETE on campaigns?”.

### 2.4 Point-in-time recovery (PITR) – Pro plan

- If the project is on a plan that supports **point-in-time recovery**, you can restore to a moment **before** the wipe and compare:
  - Counts: `SELECT COUNT(*) FROM email_threads` before vs after.
  - Or inspect what rows existed before (e.g. `campaign_id`, `account_id`) to infer what was deleted.
- That doesn’t log “who ran what”, but it **proves** state before/after and can narrow down the time of the wipe.

### 2.5 SQL Editor history

- The Supabase SQL Editor may keep a **local** history of queries you ran in the browser. It is not a full audit log and usually doesn’t show who ran what from the app or from other tools. So it’s only useful if the wipe might have been from a query you ran manually in the Editor.

---

## 3. Practical checklist

1. **Rough time window**  
   When did you last see the inbox full? Use that as the “after this, something wiped it” window.

2. **Postgres logs**  
   In Logs Explorer, filter by that time range and search for:
   - `DELETE`, `email_threads`, `campaigns`, `leads`, `enrollments`, `message_jobs`
   - Any `ERROR`/`FATAL` that might be a failed delete.
   Remember: without PGAudit, successful deletes usually aren’t there.

3. **PGAudit**  
   Check if it’s enabled (Extensions). If it was enabled before the wipe, search logs for `AUDIT` and `DELETE` in that window.

4. **Account / project audit**  
   Check for project/account deletions or restores in the same window.

5. **PITR (if available)**  
   Restore to a time before the wipe and compare `email_threads` / `email_messages` (and optionally `campaigns`, `leads`) to narrow down what disappeared.

6. **Going forward**  
   Enable PGAudit (or similar) for `write` on the roles that can delete campaigns/leads/accounts so the next time something is deleted you have a log.

---

## 4. Summary

- **Remaining causes** (once campaign/mailbox delete are ruled out): account delete, lead delete (from outside the app), database reset, restore from backup, or manual SQL DELETE.
- **Can Supabase tell you?** Only if:
  - The delete **failed** (then it may show in Postgres logs), or
  - **PGAudit** (or equivalent) was already enabled for writes, or
  - You use **PITR** to compare state before/after the wipe.
- Enabling **PGAudit** (and optionally targeting the `postgres` or API role) is the way to have a clear record of future deletes so you can answer “what caused the wipe?” next time.
