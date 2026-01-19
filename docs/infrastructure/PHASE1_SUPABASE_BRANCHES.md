# Phase 1: Supabase Branches - Completion Checklist

## ✅ Completed Steps

- ✅ Dev branch created
- ✅ Main branch configured as prod
- ✅ Both branches linked to GitHub

## 🔄 Verification Steps

### Step 1: Verify Migrations Applied

Since branches are linked to GitHub, migrations should be applied automatically. Verify:

1. **Check dev branch schema:**
   - Go to Supabase Dashboard
   - Switch to `dev` branch
   - Go to Database → Tables
   - Verify key tables exist:
     - `campaigns`
     - `enrollments`
     - `message_jobs`
     - `leads`
     - `mailboxes`
     - `nodes`
     - `campaign_intervals`
     - etc.

2. **Check prod (main) branch schema:**
   - Switch to `main` branch
   - Verify same tables exist
   - Verify schemas match

3. **If migrations not applied:**
   - Check GitHub integration status
   - Manually apply migrations if needed:
     - Use Supabase CLI: `supabase db push --branch dev`
     - Or manually via SQL Editor

### Step 2: Document Connection URLs

**Get dev branch connection info:**
1. Go to Supabase Dashboard
2. Switch to `dev` branch
3. Go to Settings → API
4. Copy:
   - **Project URL:** `https://<project-ref>-dev.supabase.co` (or similar)
   - **Service Role Key:** (for workers - secret key)
   - **Anon Key:** (for frontend - publishable key)

**Get prod (main) branch connection info:**
1. Switch to `main` branch
2. Go to Settings → API
3. Copy:
   - **Project URL:** `https://<project-ref>.supabase.co`
   - **Service Role Key:** (for workers)
   - **Anon Key:** (for frontend)

**Store these securely:**
- For CDK stacks (Phase 2): Service Role Keys (will use SSM Parameter Store)
- For frontend (Phase 5): Anon Keys (environment variables)
- Document in a secure location (password manager, etc.)

### Step 3: Test Branch Isolation

1. **Create test data in dev:**
   - Switch to `dev` branch
   - Create a test campaign via SQL Editor or API
   - Note the campaign ID

2. **Verify prod doesn't see it:**
   - Switch to `main` branch
   - Query for the same campaign ID
   - Should not exist (or vice versa)

3. **Verify branches are truly isolated:**
   - Each branch should have separate data
   - No cross-contamination

## ✅ Phase 1 Complete When:

- [ ] Migrations verified on both branches
- [ ] Connection URLs documented (dev + prod)
- [ ] Service role keys noted (for workers)
- [ ] Anon keys noted (for frontend)
- [ ] Branch isolation tested and verified

## Next Steps

Once Phase 1 is complete:
- Move to **Phase 2: Extract Workers from Amplify**
- Use connection URLs in CDK stack configuration
- Use service role keys in SSM Parameter Store paths

