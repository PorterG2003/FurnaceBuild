# User migration for production

One-time steps to run the **Cognito → Supabase Auth** user migration against the **production** Supabase branch.

## Prerequisites

- Production Supabase project **URL** and **service role key** (Dashboard → Project settings → API; use the **main** branch).
- Pending SQL migrations applied to the **production** branch (see below).

---

## Step 1: Apply SQL migrations to production

The user migration script creates `auth.users` with the same `id` as `public.users`. The trigger `handle_new_user` must use `ON CONFLICT (id) DO NOTHING` so it doesn’t fail when the row already exists. That’s done in:

**`supabase/migrations/20260302000000_fix_handle_new_user_upsert.sql`**

Apply all pending migrations to the **production** branch:

- **Option A – Supabase Dashboard**  
  1. Open your project → **SQL Editor**.  
  2. Switch to the **main** (production) branch if your project uses branches.  
  3. Run each pending migration file in order (oldest first). Start with `20260302000000_fix_handle_new_user_upsert.sql` if that’s the only one not yet applied.

- **Option B – Supabase CLI**  
  Link to the project and push to the production branch (replace `main` if your prod branch has another name):

  ```bash
  supabase link --project-ref <production-project-ref>
  supabase db push --branch main
  ```

Confirm the migration ran, e.g. in SQL Editor:

```sql
SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'handle_new_user';
```

You should see `ON CONFLICT (id) DO NOTHING` in the function body.

---

## Step 2: Run the user migration script (production)

The script creates `auth.users` for every `public.users` row that has `external_id` set (Cognito migrants), reusing the same `id`. Users will need to use **Forgot password** to set a password (Cognito hashes are not exportable).

1. **Dry run (recommended first)**  
   See which users would be migrated, without writing:

   ```bash
   DRY_RUN=1 SUPABASE_URL=https://<project-ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<service-role-key> npx tsx scripts/migrate-cognito-users-to-supabase-auth.ts
   ```

   Or with an env file (do not commit production keys):

   ```bash
   # .env.production.local (gitignored)
   SUPABASE_URL=https://<project-ref>.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
   ```

   ```bash
   DRY_RUN=1 set -a && source .env.production.local && set +a && npx tsx scripts/migrate-cognito-users-to-supabase-auth.ts
   ```

2. **Actual run**  
   Omit `DRY_RUN=1` and use the same `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` for production:

   ```bash
   SUPABASE_URL=https://<project-ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<service-role-key> npx tsx scripts/migrate-cognito-users-to-supabase-auth.ts
   ```

   Or with npm:

   ```bash
   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run migrate:users
   ```

The script skips users that already exist in `auth.users` and logs created/skipped/failed.

---

## After migration

- Users must use **Forgot password** on the app to set a new password (production SMTP must be configured for auth emails).
- Optional: clear or leave `external_id` on `public.users` for audit; the app uses `auth.uid()` and no longer depends on `external_id` for auth.
