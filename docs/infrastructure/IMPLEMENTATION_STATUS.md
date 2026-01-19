# Dev/Prod Infrastructure Implementation Status

## Overview

Progress on setting up isolated dev/prod infrastructure with Supabase branches and separate CDK stacks for ECS workers.

---

## ✅ Phase 1: Create Supabase Branches - COMPLETE

### Completed:
- ✅ Dev branch created
- ✅ Main branch configured as prod
- ✅ Both branches linked to GitHub

### Verification Needed:
- ⚠️ **Verify migrations applied to both branches** (should be automatic via GitHub linking)
- ⚠️ **Document connection URLs** (dev + prod)
  - Get from Supabase Dashboard → Settings → API
  - Store in `infra/workers/.env.local` (for CDK stacks)
  - Store in Amplify environment variables (for frontend - Phase 5)

**Status:** ✅ Complete (verify migrations when ready)

---

## ✅ Phase 2: Extract Workers from Amplify - COMPLETE

### Completed:
- ✅ Created separate CDK project at `infra/workers/`
- ✅ Created reusable `WorkerStack` class
- ✅ Created dev and prod stack definitions
- ✅ Extracted all ECS infrastructure from `amplify/backend.ts`
- ✅ Removed ECS workers from Amplify (`amplify/backend.ts` cleaned up)
- ✅ Set up environment variable loading (`.env.local`)
- ✅ Bootstrapped CDK
- ✅ Deployed dev stack successfully
- ✅ Created build-and-push script (`scripts/build-and-push.sh`)

### Files Created:
- `infra/workers/` - Complete CDK project
- `infra/workers/bin/workers.ts` - Stack definitions
- `infra/workers/lib/worker-stack.ts` - Reusable stack class
- `infra/workers/scripts/build-and-push.sh` - Docker build/push script
- `infra/workers/scripts/load-env.sh` - Environment variable loader
- `infra/workers/scripts/check-stack-status.sh` - Debug script
- `infra/workers/.env.local` - Environment variables (you created this)

### Current State:
- **Dev stack:** ✅ Deployed with `desiredCount: 0` (no tasks running yet)
- **Prod stack:** ❌ Not deployed yet

**Status:** ✅ Complete (ready for Phase 3)

---

## ✅ Phase 3: Build and Push Docker Images - COMPLETE (Dev)

### Completed:
- ✅ Created unified build-and-push script
- ✅ Added npm scripts for building (`npm run build:dev`, etc.)
- ✅ Built and pushed Docker images for dev (send-worker and scheduler-worker)

### Still Needed:
- ⚠️ **Build and push Docker images for prod** (after prod stack deployed):
  ```bash
  npm run build:prod
  ```

**Status:** ✅ Dev images complete, prod images pending prod stack deployment

---

## ⏳ Phase 4: Deploy and Start Workers - IN PROGRESS (Dev Scaled)

### Completed:
- ✅ Dev stack deployed (services created with `desiredCount: 0`)
- ✅ Created scale-up script (`scripts/scale-services.sh`)
- ✅ Built and pushed Docker images for dev (Phase 3)
- ✅ Scaled up dev services (`npm run scale:dev`)

### Verification Needed (Dev):
- ⚠️ **Verify dev tasks are running:**
  - Check ECS console or CloudWatch logs
  - Verify tasks started successfully
  - Verify workers connect to dev Supabase branch
  - Test worker functionality (process message jobs, etc.)

### Still Needed:
- ⚠️ **Deploy prod stack:**
  ```bash
  npm run deploy:prod
  ```
- ⚠️ **Build and push prod images** (Phase 3 for prod)
- ⚠️ **Scale up prod services**:
  ```bash
  npm run scale:prod
  ```
- ⚠️ **Verify prod workers** (similar to dev)

**Status:** ⏳ Dev workers scaled - verify they're running; prod not deployed yet

---

## ❌ Phase 5: Configure Frontend/API Environments - NOT STARTED

### Still Needed:
- ⚠️ **Update Amplify environment variables for dev:**
  - Set `EXPO_PUBLIC_SUPABASE_URL` to dev branch URL
  - Set `EXPO_PUBLIC_SUPABASE_ANON_KEY` to dev branch anon key
  - Configure in Amplify Console or `amplify.yml`

- ⚠️ **Update Amplify environment variables for prod:**
  - Set `EXPO_PUBLIC_SUPABASE_URL` to prod branch URL
  - Set `EXPO_PUBLIC_SUPABASE_ANON_KEY` to prod branch anon key

- ⚠️ **Update Lambda functions** (if they use Supabase):
  - `enrollmentMetric` - needs environment-specific Supabase URL
  - `inboxChecker` - needs environment-specific Supabase URL
  - `testMailboxConnection` - needs environment-specific Supabase URL
  - `sendInvitationEmail` - needs environment-specific Supabase URL

- ⚠️ **Test frontend connections:**
  - Verify dev frontend connects to dev branch
  - Verify prod frontend connects to prod branch

**Status:** ❌ Not started

---

## ❌ Phase 6: Cleanup and Documentation - NOT STARTED

### Still Needed:
- ⚠️ **Verify old infrastructure removed:**
  - Check AWS Console for any lingering ECS clusters/ECR repos from old Amplify setup
  - Manually delete if found

- ⚠️ **Document deployment process:**
  - Update README files with new workflow
  - Document how to deploy workers independently

- ⚠️ **Update Supabase documentation:**
  - Document branch usage
  - Document how to get branch URLs

- ⚠️ **Cost monitoring:**
  - Set up CloudWatch billing alarms
  - Monitor against cost targets

**Status:** ❌ Not started (not critical for functionality)

---

## Summary

### ✅ Completed:
1. Supabase branches created and linked
2. Workers extracted from Amplify
3. CDK project created and configured
4. Dev stack deployed (with desiredCount: 0)
5. Build scripts created
6. Environment variable management set up

### ⏳ In Progress:
1. Build Docker images for dev
2. Scale up dev workers
3. Deploy prod stack

### ❌ Not Started:
1. Configure frontend/API for branch URLs
2. Update Lambda functions for branch URLs
3. Cleanup and final documentation

---

## Next Immediate Steps

### 1. ✅ Verify Dev Workers Are Running (Just Completed)
```bash
# Check tasks are running
aws ecs list-tasks --cluster furnace-cluster-dev --region us-west-2

# Check CloudWatch logs
aws logs tail /ecs/furnace/send-worker-dev --follow --region us-west-2
aws logs tail /ecs/furnace/scheduler-worker-dev --follow --region us-west-2
```

**Verify:**
- Tasks are running (status: RUNNING)
- Workers connect to dev Supabase branch (check logs)
- Workers process data correctly (test with dev data)

### 2. Deploy Prod Stack
```bash
cd infra/workers
npm run deploy:prod
```

**This will:**
- Create prod ECR repositories
- Create prod ECS cluster
- Create prod services (with `desiredCount: 1`)
- Connect to prod Supabase branch

### 3. Build and Push Prod Images
```bash
npm run build:prod
```

**This will:**
- Build Docker images for prod
- Push to prod ECR repositories

### 4. Scale Up Prod Workers (If needed)
```bash
npm run scale:prod
```

**Note:** Prod stack starts with `desiredCount: 1`, but if you set it to 0, scale up after images are pushed.

### 5. Configure Frontend/API Environments
- Update Amplify environment variables for dev and prod
- Update Lambda function environment variables
- Test connections to correct Supabase branches

---

## Current State Summary

**What's Working:**
- ✅ Dev CDK stack deployed (infrastructure exists)
- ✅ Dev ECR repositories created
- ✅ Dev Docker images built and pushed
- ✅ Dev ECS services scaled up (tasks should be starting)
- ✅ Environment variable management set up
- ✅ Build and scale scripts ready to use

**What's Next:**
1. ✅ Verify dev workers are running (check logs/tasks)
2. Deploy prod stack (`npm run deploy:prod`)
3. Build and push prod images (`npm run build:prod`)
4. Verify prod workers are running
5. Configure frontend/API environments (Phase 5)

---

**Last Updated:** After Phase 2 completion, before Phase 3 execution

