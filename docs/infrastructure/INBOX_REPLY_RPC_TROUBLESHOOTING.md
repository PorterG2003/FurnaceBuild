# Troubleshooting: create_inbox_reply_job not in schema cache

**Error**: `Could not find the function public.create_inbox_reply_job(...) in the schema cache`

This means the RPC exists in your repo migrations but **hasn’t been applied** to the database (or branch) your app is using.

## Fixes

### 1. CLI on the wrong branch — link to the branch your app uses

The Supabase CLI is linked to **one project ref** at a time. Dev and main use **different project refs** (e.g. `xxx-dev` vs `xxx`). If your app uses the **dev** branch URL but the CLI is linked to **main**, `supabase db push` applies to main and the dev branch never gets the function.

**Switch the CLI to the same branch as your app:**

1. **Get the project ref for the branch your app uses**
   - From your app’s Supabase URL: `https://<project-ref>.supabase.co` → the **project ref** is the hostname prefix (e.g. `d1jtp0rz0l9mcn-dev` for dev).
   - Or: Dashboard → switch to that branch → Settings → General → Reference ID (or use the ref from the API URL).

2. **Link the CLI to that branch and push**
   ```bash
   cd /path/to/FurnaceBuild
   supabase link --project-ref <project-ref>
   supabase db push
   ```
   Use the **dev** project ref if your app’s `EXPO_PUBLIC_SUPABASE_URL` / `SUPABASE_URL` is the dev branch URL; use the **main** project ref if it’s prod.

3. **If you use `infra/workers/.env.local`** (with `DEV_SUPABASE_URL` / `PROD_SUPABASE_URL`), you can run the apply script and it will link to dev then push:
   ```bash
   bash infra/workers/scripts/apply-migrations.sh
   ```
   Or to sync dev from main then push to dev:
   ```bash
   bash infra/workers/scripts/sync-dev-from-main.sh
   ```

### 2. Apply migrations on the DB you’re using

- **Linked project**: After linking to the correct branch (above), `supabase db push` (or `supabase db push --include-all`) applies migrations to that branch.
- **Branch**: The function must exist on the **same** branch as the app’s `SUPABASE_URL`.

### 2. Confirm the function exists

In Supabase **SQL Editor** (for the project/branch you’re using):

```sql
SELECT routine_name
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name = 'create_inbox_reply_job';
```

If this returns no rows, the migration wasn’t applied.

### 3. Apply the inbox-reply migrations manually (if needed)

If you can’t run full migration history, apply these in order on the target DB:

1. `supabase/migrations/20260129000000_add_message_type_for_inbox_reply.sql`
2. `supabase/migrations/20260129000001_claim_manual_message_jobs_and_filter_campaign.sql`
3. `supabase/migrations/20260129000002_create_inbox_reply_job_rpc.sql`
4. `supabase/migrations/20260129000003_add_cc_to_email_messages.sql`

Or run **only** the RPC (if `message_type` and related schema already exist):

- Run the contents of `supabase/migrations/20260129000002_create_inbox_reply_job_rpc.sql` in SQL Editor.

### 4. Reload schema cache (optional)

After applying migrations, Supabase may need to reload the schema cache:

- **Dashboard**: Project → Settings → API → “Reload schema cache” (if available).
- Or wait a short time and retry; the API can take a moment to see new functions.

## Summary

Use the **same database (and branch)** for migrations and for the app’s `SUPABASE_URL`, and ensure the four migrations above have been applied there.
