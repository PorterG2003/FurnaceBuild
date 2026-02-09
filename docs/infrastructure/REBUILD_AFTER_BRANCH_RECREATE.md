# Complete Checklist: Rebuild After Dev Branch Recreation

After recreating your Supabase `dev` branch (and making it persistent), follow this checklist to get everything working again.

---

## Step 1: Update Environment Variables

### 1.1 Get New Dev Branch Credentials

1. **Go to Supabase Dashboard**: https://supabase.com/dashboard
2. **Switch to `dev` branch** (using branch selector)
3. **Go to Settings → API**
4. **Copy the following:**
   - ✅ **Project URL** (e.g., `https://<project-ref>-dev.supabase.co`)
   - ✅ **Secret Key** (Service Role Key - for workers)
     - Click "API Keys" tab (not "Legacy API Keys")
     - Copy the **Secret Key** (NOT the Publishable Key)
   - ✅ **Anon Key** (Publishable Key - for frontend)
     - Same "API Keys" tab
     - Copy the **Publishable Key**

### 1.2 Update Workers Infrastructure (.env.local)

**File**: `infra/workers/.env.local`

```bash
cd infra/workers
```

Update or create `.env.local` with:

```env
# AWS Configuration
CDK_DEFAULT_ACCOUNT=686255981838
CDK_DEFAULT_REGION=us-west-2

# Supabase Branch URLs
DEV_SUPABASE_URL=https://<your-new-dev-project-ref>-dev.supabase.co
PROD_SUPABASE_URL=https://<your-prod-project-ref>.supabase.co
```

**Important**: If the dev branch URL changed, update `DEV_SUPABASE_URL`.

### 1.3 Update Frontend Environment Variables

**For Local Development:**

Create/update `.env` in project root:

```env
EXPO_PUBLIC_SUPABASE_URL=https://<your-new-dev-project-ref>-dev.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<dev-branch-publishable-key>
```

**For Amplify (Dev Sandbox):**

```bash
# Set dev environment variables in Amplify
npx ampx sandbox secret set EXPO_PUBLIC_SUPABASE_URL=https://<your-new-dev-project-ref>-dev.supabase.co
npx ampx sandbox secret set EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<dev-branch-publishable-key>
```

**For Amplify (Production):**

Set in Amplify Console → App Settings → Environment Variables (or use production branch keys).

---

## Step 2: Apply Database Migrations

Since you recreated the branch, you need to apply all migrations:

```bash
cd infra/workers
npm run apply:migrations
```

This will:
- Link to the dev branch
- Apply all migrations from `supabase/migrations/`

**Verify migrations were applied:**
```bash
npm run verify:migrations
```

---

## Step 3: Update Supabase Service Key in AWS SSM

The workers need the new Secret Key stored in AWS SSM Parameter Store:

```bash
cd infra/workers
npm run set-secret:dev
```

This will:
- Prompt you for the dev branch **Secret Key** (Service Role Key)
- Store it in SSM Parameter Store at `/amplify/furnacebuild/dev/SUPABASE_SECRET_KEY`
- The workers will automatically use this when they start

**Verify the secret was set correctly:**
```bash
npm run verify-secret:dev
```

---

## Step 4: Update CDK Stack (If URL Changed)

If the `DEV_SUPABASE_URL` changed, the CDK stack needs to know about it:

```bash
cd infra/workers

# Check what will change
npm run diff:dev

# Deploy the updated stack
npm run deploy:dev
```

This updates the ECS task definitions with the new Supabase URL (though you still need to restart services).

---

## Step 5: Rebuild and Push Docker Images (If Needed)

If your worker code changed or you want fresh images:

```bash
cd infra/workers

# Build and push both workers for dev
npm run build:dev

# Or build individually:
npm run build:dev:send      # Send worker only
npm run build:dev:scheduler # Scheduler worker only
```

**Note**: This only needs to be done if:
- You changed worker code
- You want to ensure fresh images
- Otherwise, you can just restart the services

---

## Step 6: Restart ECS Services

Restart the ECS services to pick up:
- New Supabase URL (from CDK deployment)
- New Secret Key (from SSM)

```bash
cd infra/workers
npm run restart:dev
```

This will:
- Force new task deployments
- Tasks will pick up new environment variables
- Tasks will fetch new Secret Key from SSM

**Alternative - Manual restart:**
```bash
# Scale down
npm run scale:down:dev

# Scale back up
npm run scale:dev
```

---

## Step 7: Verify Everything is Working

### 7.1 Check Workers are Running

```bash
cd infra/workers
npm run check:services
```

Should show:
- ✅ `send-worker-dev`: Running (desiredCount: 1, runningCount: 1)
- ✅ `scheduler-worker-dev`: Running (desiredCount: 1, runningCount: 1)

### 7.2 Check Worker Environment Variables

```bash
npm run check:env
```

Should show the new `SUPABASE_URL` in task definitions.

### 7.3 Check Worker Logs

```bash
npm run check:logs
```

Or manually:
```bash
# Send worker logs
aws logs tail /ecs/furnace/send-worker-dev --follow --region us-west-2

# Scheduler worker logs
aws logs tail /ecs/furnace/scheduler-worker-dev --follow --region us-west-2
```

Look for:
- ✅ No errors about "Missing SUPABASE_URL"
- ✅ No errors about "Missing SUPABASE_SECRET_KEY"
- ✅ Successful database connections

### 7.4 Test Supabase Connection

```bash
npm run test:url
```

Should show the dev branch URL is reachable.

### 7.5 Verify Database Schema

```bash
npm run verify:migrations
```

Should confirm all migrations are applied.

---

## Step 8: Update Frontend (If Dev Branch Changed)

If you're running the frontend locally or in Amplify dev:

### Local Development

Restart your dev server to pick up new `.env` variables:

```bash
# Stop current server (Ctrl+C)
# Start again
npm start
```

### Amplify Sandbox

If you updated Amplify secrets, redeploy:

```bash
# This will pick up new environment variables
npx ampx sandbox
```

---

## Summary Checklist

- [ ] ✅ Updated `infra/workers/.env.local` with new `DEV_SUPABASE_URL`
- [ ] ✅ Applied migrations to dev branch (`npm run apply:migrations`)
- [ ] ✅ Set new Supabase Secret Key in AWS SSM (`npm run set-secret:dev`)
- [ ] ✅ Updated CDK stack if URL changed (`npm run deploy:dev`)
- [ ] ✅ Rebuilt Docker images if needed (`npm run build:dev`)
- [ ] ✅ Restarted ECS services (`npm run restart:dev`)
- [ ] ✅ Verified services are running (`npm run check:services`)
- [ ] ✅ Checked worker logs for errors (`npm run check:logs`)
- [ ] ✅ Updated frontend environment variables (`.env` or Amplify)
- [ ] ✅ Tested frontend connection to new dev branch

---

## Quick Reference: All Required Environment Variables

### For Workers (infra/workers/.env.local)

```env
CDK_DEFAULT_ACCOUNT=686255981838
CDK_DEFAULT_REGION=us-west-2
DEV_SUPABASE_URL=https://<project-ref>-dev.supabase.co
PROD_SUPABASE_URL=https://<project-ref>.supabase.co
```

### For Workers (Set via SSM - use `npm run set-secret:dev`)

- **Dev**: `/amplify/furnacebuild/dev/SUPABASE_SECRET_KEY` (Secret Key)
- **Prod**: `/amplify/shared/d1jtp0rz0l9mcn/SUPABASE_SECRET_KEY` (Secret Key)

### For Frontend (.env or Amplify)

```env
EXPO_PUBLIC_SUPABASE_URL=https://<project-ref>-dev.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable-key>
```

---

## Troubleshooting

### Workers Can't Connect

1. **Check SSM Secret Key:**
   ```bash
   npm run verify-secret:dev
   ```

2. **Check task environment variables:**
   ```bash
   npm run check:env
   ```

3. **Check logs for errors:**
   ```bash
   npm run check:logs
   ```

### Migrations Failed

1. **Check migration status:**
   ```bash
   npm run verify:migrations
   ```

2. **Try syncing from main:**
   ```bash
   npm run sync:dev
   ```

### Frontend Can't Connect

1. **Check environment variables are set:**
   - Local: Check `.env` file
   - Amplify: Check Amplify Console → Environment Variables

2. **Verify Anon Key is correct:**
   - Get from Supabase Dashboard → Settings → API → Publishable Key
   - Make sure you're using the **Publishable Key**, not the Secret Key

---

## Related Scripts

All commands should be run from `infra/workers/` directory:

- `npm run check:branch` - Check if dev branch exists
- `npm run apply:migrations` - Apply migrations to dev
- `npm run verify:migrations` - Verify migrations are applied
- `npm run set-secret:dev` - Set Supabase Secret Key in SSM
- `npm run verify-secret:dev` - Verify Secret Key is correct
- `npm run deploy:dev` - Deploy CDK stack
- `npm run build:dev` - Build and push Docker images
- `npm run restart:dev` - Restart ECS services
- `npm run check:services` - Check service status
- `npm run check:logs` - Check worker logs
- `npm run check:env` - Check environment variables
