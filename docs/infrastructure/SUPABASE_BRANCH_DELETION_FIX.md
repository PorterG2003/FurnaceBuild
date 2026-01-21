# Fix: Supabase Dev Branch Keeps Disappearing

## Problem

The Supabase `dev` branch keeps getting deleted automatically, even though you haven't manually deleted it.

## Root Cause

This is a known Supabase behavior related to **branch types**:

- **Preview Branches**: These are automatically deleted when:
  - Merged into the production branch
  - After a period of inactivity
  - When GitHub branch is deleted (if linked)

- **Persistent Branches**: These are long-lived and **won't** be deleted automatically

If your `dev` branch is configured as a **preview branch**, Supabase will delete it automatically in certain scenarios.

## Solution: Convert Dev Branch to Persistent Branch

### Step 1: Check Current Branch Type

1. Go to Supabase Dashboard: https://supabase.com/dashboard
2. Select your project
3. Go to **Settings → Branches**
4. Check if `dev` branch exists and what type it is

### Step 2: Create/Recreate Dev Branch as Persistent

If the branch doesn't exist or is a preview branch:

1. **Create the branch:**
   - Click "New Branch" or "Create Branch"
   - Name it `dev`
   - Select `main` as the source branch
   - **Important**: Look for a setting to make it "Persistent" (not "Preview")

2. **Verify it's Persistent:**
   - After creation, go back to Settings → Branches
   - Find your `dev` branch
   - It should show as "Persistent" type
   - If it shows as "Preview", there should be an option to convert it

### Step 3: Check GitHub Integration Settings

If your branches are linked to GitHub:

1. Go to **Settings → Integrations → GitHub**
2. Verify:
   - **Production Branch**: Should be set to `main` (or your production branch name)
   - **Automatic Branching**: Check if this is enabled (can cause issues if misconfigured)
3. For the `dev` branch integration:
   - Make sure it's linked to your GitHub `dev` branch
   - But ensure it's marked as **Persistent** in Supabase

### Step 4: Update Connection URL

If you recreated the branch, you'll need to update the connection URL:

1. Switch to `dev` branch in Supabase Dashboard
2. Go to **Settings → API**
3. Copy the **Project URL** (e.g., `https://<project-ref>-dev.supabase.co`)
4. Update `infra/workers/.env.local`:
   ```bash
   DEV_SUPABASE_URL=https://<new-project-ref>-dev.supabase.co
   ```
5. Also get the new Service Role Key and update it:
   ```bash
   npm run set-secret:dev
   ```

### Step 5: Reapply Migrations

After recreating the branch, apply migrations:

```bash
cd infra/workers
npm run apply:migrations
```

## Prevention: Best Practices

1. **Always use Persistent branches** for long-lived environments:
   - `dev` - persistent
   - `staging` - persistent (if you have one)
   - `main`/`prod` - persistent (this is automatic)

2. **Use Preview branches only** for temporary feature work:
   - PR branches
   - Short-lived feature branches
   - Experimental work

3. **Monitor GitHub Integration**:
   - If you delete a GitHub branch, and it's linked to Supabase, the Supabase branch might be deleted
   - Make sure persistent branches aren't accidentally linked to temporary GitHub branches

4. **Regular Backups**:
   - Even with persistent branches, maintain backups
   - Export important data before major changes

## Troubleshooting

### Branch Still Disappearing?

1. **Check Supabase Dashboard → Settings → Branches**:
   - Verify branch type is "Persistent"
   - Look for any auto-deletion settings

2. **Check GitHub Integration**:
   - Verify production branch is set correctly
   - Check if automatic branching is causing conflicts

3. **Check Migration History**:
   - Broken migrations can cause branch issues
   - Run: `supabase migration repair --status applied` if needed
   - See: `infra/workers/scripts/sync-dev-from-main.sh`

4. **Contact Supabase Support**:
   - If branch is marked Persistent but still disappears
   - Provide details about when it disappears (after merges? after inactivity?)

## Quick Reference

- **Preview Branch**: Temporary, auto-deletes when merged/inactive
- **Persistent Branch**: Long-lived, won't auto-delete ✅ (Use for `dev`)
- **Production Branch**: Usually `main`, always persistent

## Related Scripts

- `infra/workers/scripts/check-supabase-branch.sh` - Check if branch exists
- `infra/workers/scripts/sync-dev-from-main.sh` - Sync migrations to dev
- `infra/workers/scripts/apply-migrations.sh` - Apply migrations to dev

## References

- [Supabase Branching Documentation](https://supabase.com/docs/guides/deployment/branching)
- [Supabase GitHub Integration](https://supabase.com/docs/guides/deployment/branching/github-integration)
