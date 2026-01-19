# Infrastructure Implementation Plan

## Overview

This document outlines the step-by-step implementation plan for setting up isolated dev/prod infrastructure with:
- Supabase branches (dev + prod)
- Separate ECS workers (dev + prod)
- Separate CDK stack (extracted from Amplify)
- Cost-optimized (~$92-180/month)

---

## Current State Assessment

### ✅ Already Implemented

1. **ECS Worker Code:**
   - ✅ Send worker (`workers/send-worker/`) - polls database, sends emails
   - ✅ Scheduler worker (`workers/scheduler-worker/`) - processes enrollments, manages intervals
   - ✅ Both workers use database polling (not SQS)
   - ✅ Dockerfiles exist for both workers

2. **Amplify Infrastructure:**
   - ✅ ECS infrastructure defined in `amplify/backend.ts`
   - ✅ ECR repositories, ECS clusters, services, task definitions
   - ✅ IAM roles and permissions
   - ✅ Lambda functions (enrollmentMetric, inboxChecker, etc.)

3. **Database:**
   - ✅ Supabase project exists
   - ✅ Migrations in `supabase/migrations/`
   - ✅ Schema includes: campaigns, enrollments, message_jobs, etc.

4. **Worker Scripts:**
   - ✅ `push-to-ecr.sh` scripts for building/pushing Docker images

### ⚠️ Partially Implemented

1. **Supabase Branches:**
   - ✅ Dev branch created and linked to GitHub
   - ✅ Main branch configured as prod and linked to GitHub
   - ⚠️ Environment-specific connection URLs need to be documented
   - ⚠️ Verify migrations are applied to both branches

2. **Separate CDK Stack:**
   - ❌ Workers still in `amplify/backend.ts`
   - ❌ No separate `infra/workers/` CDK project
   - ❌ Dev/prod stacks not separated

3. **Environment Configuration:**
   - ❌ Workers don't have environment-specific config
   - ❌ No dev/prod branch URLs configured

---

## Implementation Phases

### Phase 1: Create Supabase Branches ✅ COMPLETE

**Goal:** Set up database isolation using Supabase branches

#### Step 1.1: Create Dev Branch ✅

- ✅ Dev branch created
- ✅ Linked to GitHub

#### Step 1.2: Configure Prod Branch ✅

- ✅ Main branch configured as prod
- ✅ Linked to GitHub

#### Step 1.3: Apply Migrations to Branches

**Current migrations:** All migrations in `supabase/migrations/` should be applied to both branches via GitHub linking

**Verify migrations are applied:**
1. Check dev branch schema matches main branch
2. Verify key tables exist: campaigns, enrollments, message_jobs, etc.
3. If migrations need to be applied:
   - GitHub linking should handle this automatically
   - Or manually apply via Supabase CLI or Dashboard

#### Step 1.4: Document Connection URLs

**Next steps:**
1. Get dev branch URL from Supabase Dashboard → Settings → API
   - Should be: `https://<project-ref>-dev.supabase.co`
   
2. Get prod/main branch URL:
   - Should be: `https://<project-ref>.supabase.co`

3. Get service role keys:
   - Dev branch: Settings → API → Service Role Key
   - Prod branch: Settings → API → Service Role Key

4. Store these for Phase 3 (worker configuration)

**Checkpoint:** ✅ Both branches exist and linked to GitHub. Need to verify migrations and document connection URLs.

---

### Phase 2: Extract Workers from Amplify (Day 2-3)

**Goal:** Create separate CDK stack for workers, remove from Amplify

#### Step 2.1: Create CDK Project Structure

```bash
mkdir -p infra/workers
cd infra/workers
```

1. **Initialize CDK project:**
   ```bash
   cdk init app --language typescript
   ```

2. **Install dependencies:**
   ```bash
   npm install
   npm install aws-cdk-lib constructs
   ```

3. **Create directory structure:**
   ```
   infra/workers/
   ├── package.json
   ├── tsconfig.json
   ├── cdk.json
   ├── bin/
   │   └── workers.ts          # App entry point (dev + prod stacks)
   └── lib/
       └── worker-stack.ts     # Reusable stack definition
   ```

#### Step 2.2: Create Reusable Worker Stack

**File: `lib/worker-stack.ts`**

This will contain the logic currently in `amplify/backend.ts` for ECS workers, but parameterized by environment.

**Key parameters:**
- `environment: 'dev' | 'prod'`
- `supabaseUrl: string` (branch URL)
- `supabaseServiceKeyParamPath: string` (SSM parameter path)
- `desiredCount: number` (task count)

**Extract from `amplify/backend.ts`:**
- ECR repository creation
- VPC creation (or reference existing)
- ECS cluster creation
- IAM roles (task role, execution role)
- Task definitions (send worker + scheduler worker)
- ECS services
- CloudWatch log groups
- Auto-scaling configuration (optional, can disable initially)

**Implementation notes:**
- Use environment in resource names (e.g., `furnace-cluster-dev`, `furnace-cluster-prod`)
- Use environment-specific ECR repos (e.g., `furnace/send-worker-dev`)
- Configure workers with environment-specific Supabase URL
- Set `desiredCount: 0` initially (can't start until images exist)

#### Step 2.3: Create Dev and Prod Stacks

**File: `bin/workers.ts`**

```typescript
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { WorkerStack } from '../lib/worker-stack';

const app = new cdk.App();

// Dev stack
new WorkerStack(app, 'WorkerStack-Dev', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'us-west-2',
  },
  environment: 'dev',
  supabaseUrl: process.env.DEV_SUPABASE_URL!,
  supabaseServiceKeyParamPath: '/amplify/furnacebuild/porter-sandbox-387f79dcc1/SUPABASE_SERVICE_KEY',
  desiredCount: {
    sendWorker: 1,
    schedulerWorker: 1,
  },
});

// Prod stack
new WorkerStack(app, 'WorkerStack-Prod', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'us-west-2',
  },
  environment: 'prod',
  supabaseUrl: process.env.PROD_SUPABASE_URL!,
  supabaseServiceKeyParamPath: '/amplify/shared/d1jtp0rz0l9mcn/SUPABASE_SERVICE_KEY',
  desiredCount: {
    sendWorker: 1, // Start with 1, scale to 2 if needed
    schedulerWorker: 1, // Start with 1, scale to 2 if needed
  },
});
```

#### Step 2.4: Copy/Adapt ECS Infrastructure Code

**From `amplify/backend.ts`, extract and adapt:**

1. **ECR Repositories:**
   - Send worker repo
   - Scheduler worker repo
   - Add environment suffix to names

2. **VPC:**
   - Create new VPC per environment (or share VPC? - recommend separate for isolation)
   - Public subnets only (no NAT Gateway)

3. **ECS Cluster:**
   - One cluster per environment

4. **IAM Roles:**
   - Task role (application permissions)
   - Execution role (ECS service permissions)
   - CloudWatch Logs permissions
   - SSM Parameter Store permissions

5. **Task Definitions:**
   - Send worker task definition
   - Scheduler worker task definition
   - Environment variables: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY_PARAM_PATH`, `AWS_REGION`

6. **ECS Services:**
   - Send worker service
   - Scheduler worker service
   - Set `desiredCount: 0` initially (or use parameter)

7. **CloudWatch Log Groups:**
   - Send worker logs
   - Scheduler worker logs

#### Step 2.5: Remove Workers from Amplify

**File: `amplify/backend.ts`**

1. **Remove ECS-related imports** (if not used by Lambdas):
   - Keep `ecr`, `ecs`, `ec2` if Lambda functions need them
   - Otherwise remove

2. **Remove all ECS worker infrastructure:**
   - ECR repositories for workers
   - VPC (if only used by workers)
   - ECS cluster
   - IAM roles (task roles, execution roles)
   - Task definitions
   - ECS services
   - CloudWatch log groups for workers

3. **Keep in Amplify:**
   - Lambda functions (enrollmentMetric, inboxChecker, sendInvitationEmail, etc.)
   - Auth configuration
   - Data API configuration
   - Any other frontend/API infrastructure

4. **Test Amplify deployment:**
   ```bash
   npx ampx sandbox
   ```
   - Should deploy faster now (no ECS resources)
   - Should not timeout

**Checkpoint:** ✅ Separate CDK project created, Amplify cleaned up, stacks compile

---

### Phase 3: Build and Push Docker Images (Day 3-4)

**Goal:** Build Docker images and push to ECR repositories

#### Step 3.1: Deploy CDK Stacks (Empty - No Images Yet)

1. **Set environment variables:**
   ```bash
   export DEV_SUPABASE_URL=https://<project-ref>-dev.supabase.co
   export PROD_SUPABASE_URL=https://<project-ref>.supabase.co
   export CDK_DEFAULT_ACCOUNT=<your-aws-account-id>
   export CDK_DEFAULT_REGION=us-west-2
   ```

2. **Deploy dev stack (with desiredCount: 0):**
   ```bash
   cd infra/workers
   cdk deploy WorkerStack-Dev
   ```
   - This creates ECR repos, clusters, services (but tasks won't start without images)
   - Note the ECR repository URIs

3. **Deploy prod stack (with desiredCount: 0):**
   ```bash
   cdk deploy WorkerStack-Prod
   ```
   - Creates prod infrastructure
   - Note the ECR repository URIs

#### Step 3.2: Build Send Worker Images

**For dev:**
```bash
# Get ECR login
aws ecr get-login-password --region us-west-2 | \
  docker login --username AWS --password-stdin <account-id>.dkr.ecr.us-west-2.amazonaws.com

# Build and tag
docker buildx build \
  --platform linux/amd64 \
  -f workers/send-worker/Dockerfile \
  -t <account-id>.dkr.ecr.us-west-2.amazonaws.com/furnace/send-worker-dev:latest \
  -t <account-id>.dkr.ecr.us-west-2.amazonaws.com/furnace/send-worker-dev:v1 \
  --load \
  .

# Push
docker push <account-id>.dkr.ecr.us-west-2.amazonaws.com/furnace/send-worker-dev:latest
docker push <account-id>.dkr.ecr.us-west-2.amazonaws.com/furnace/send-worker-dev:v1
```

**For prod:**
```bash
# Build and tag
docker buildx build \
  --platform linux/amd64 \
  -f workers/send-worker/Dockerfile \
  -t <account-id>.dkr.ecr.us-west-2.amazonaws.com/furnace/send-worker-prod:latest \
  -t <account-id>.dkr.ecr.us-west-2.amazonaws.com/furnace/send-worker-prod:v1 \
  --load \
  .

# Push
docker push <account-id>.dkr.ecr.us-west-2.amazonaws.com/furnace/send-worker-prod:latest
docker push <account-id>.dkr.ecr.us-west-2.amazonaws.com/furnace/send-worker-prod:v1
```

#### Step 3.3: Build Scheduler Worker Images

Repeat Step 3.2 for scheduler worker:
- `furnace/scheduler-worker-dev`
- `furnace/scheduler-worker-prod`

#### Step 3.4: Update Push Scripts (Optional)

Update `workers/send-worker/push-to-ecr.sh` and `workers/scheduler-worker/push-to-ecr.sh` to:
- Accept environment parameter (`dev` or `prod`)
- Use environment-specific repo names
- Or create separate scripts for dev/prod

**Checkpoint:** ✅ Docker images built and pushed to both dev and prod ECR repos

---

### Phase 4: Deploy and Start Workers (Day 4-5)

**Goal:** Deploy workers with images, start tasks, verify they run

#### Step 4.1: Update CDK Stacks to Use Images

**In `lib/worker-stack.ts`:**

1. **Update task definitions** to reference correct ECR repos:
   ```typescript
   const sendWorkerImage = ecs.ContainerImage.fromEcrRepository(
     sendWorkerRepo,
     'latest' // or use specific tag
   );
   ```

2. **Set desiredCount > 0:**
   ```typescript
   desiredCount: props.desiredCount.sendWorker,
   ```

#### Step 4.2: Redeploy Dev Stack

```bash
cd infra/workers
cdk deploy WorkerStack-Dev
```

**Verify:**
1. ECS service starts tasks
2. Tasks pull images from ECR
3. Tasks start successfully
4. Check CloudWatch logs:
   ```bash
   aws logs tail /ecs/furnace/send-worker-dev --follow --region us-west-2
   aws logs tail /ecs/furnace/scheduler-worker-dev --follow --region us-west-2
   ```
5. Verify workers connect to dev Supabase branch
6. Verify workers process dev data only

#### Step 4.3: Redeploy Prod Stack

```bash
cdk deploy WorkerStack-Prod
```

**Verify:**
1. ECS service starts tasks
2. Tasks pull images from ECR
3. Tasks start successfully
4. Check CloudWatch logs
5. Verify workers connect to prod Supabase branch
6. Verify workers process prod data only

#### Step 4.4: Test Worker Functionality

**Dev:**
1. Create test data in dev branch
2. Verify send worker processes message jobs
3. Verify scheduler worker processes enrollments
4. Check database for updates

**Prod:**
1. Create test data in prod branch (carefully!)
2. Verify workers process prod data only
3. Verify no cross-contamination with dev

**Checkpoint:** ✅ Both dev and prod workers running, processing correct data

---

### Phase 5: Configure Frontend/API Environments (Day 5)

**Goal:** Point frontend/API to correct Supabase branches

#### Step 5.1: Update Amplify Environment Variables

**For dev (Amplify sandbox):**
- Set `EXPO_PUBLIC_SUPABASE_URL` to dev branch URL
- Set `EXPO_PUBLIC_SUPABASE_ANON_KEY` to dev branch anon key

**For prod (Amplify production):**
- Set `EXPO_PUBLIC_SUPABASE_URL` to prod branch URL
- Set `EXPO_PUBLIC_SUPABASE_ANON_KEY` to prod branch anon key

**Note:** Amplify environment variables can be set in:
- Amplify Console → App → Environment variables
- Or in `amplify.yml` (if using build-time vars)

#### Step 5.2: Update Lambda Functions

**Lambda functions that access Supabase:**
- `enrollmentMetric` - should use prod branch (or environment-specific)
- `inboxChecker` - should use environment-specific branch

**Update Lambda environment variables:**
- Add `SUPABASE_URL` environment variable per environment
- Add `SUPABASE_SERVICE_KEY` or use SSM parameter

#### Step 5.3: Test Frontend Connections

1. **Test dev frontend:**
   - Open dev Amplify app
   - Verify it connects to dev branch
   - Verify data shown is from dev branch only

2. **Test prod frontend:**
   - Open prod Amplify app
   - Verify it connects to prod branch
   - Verify data shown is from prod branch only

**Checkpoint:** ✅ Frontend/API connected to correct Supabase branches

---

### Phase 6: Cleanup and Documentation (Day 6)

**Goal:** Clean up old infrastructure, document setup

#### Step 6.1: Verify Old Infrastructure Removal

1. **Check Amplify stack:**
   - Verify no ECS resources remain
   - Verify no worker-related ECR repos
   - Verify deployment is fast (no timeouts)

2. **Check old ECR repos:**
   - Old repos from Amplify (with `-8747b9808c` suffix) can be deleted
   - Or kept for reference (costs nothing if empty)

#### Step 6.2: Document Configuration

**Create documentation:**
1. **Connection URLs:**
   - Dev Supabase branch URL
   - Prod Supabase branch URL
   - ECR repository URIs

2. **Deployment commands:**
   ```bash
   # Deploy dev workers
   cd infra/workers
   cdk deploy WorkerStack-Dev

   # Deploy prod workers
   cdk deploy WorkerStack-Prod

   # Deploy frontend/API (via Amplify)
   # Auto-deploys on git push, or:
   npx ampx sandbox  # Dev
   # Prod via Amplify Console
   ```

3. **Image build/push process:**
   - Document how to build and push new images
   - Document versioning strategy

4. **Environment variable reference:**
   - Document all environment variables needed
   - Document where they're set (CDK, Amplify, etc.)

#### Step 6.3: Update README Files

Update:
- `workers/send-worker/README.md` - mention dev/prod deployment
- `workers/scheduler-worker/README.md` - mention dev/prod deployment
- Root `README.md` - add infrastructure overview

#### Step 6.4: Set Up CI/CD (Optional, Future)

**GitHub Actions workflow:**
- Build Docker images on worker code changes
- Push to ECR (dev and/or prod based on branch)
- Optionally: Deploy CDK stacks (if desired)

**For now:** Manual deployment is acceptable (cost-saving)

**Checkpoint:** ✅ All cleanup done, documentation complete

---

## Testing Checklist

### Dev Environment

- [ ] Dev workers connect to dev Supabase branch
- [ ] Dev workers process dev data only
- [ ] Dev frontend connects to dev Supabase branch
- [ ] Dev frontend shows dev data only
- [ ] No cross-contamination with prod data
- [ ] CloudWatch logs show dev workers running
- [ ] ECS tasks are healthy

### Prod Environment

- [ ] Prod workers connect to prod Supabase branch
- [ ] Prod workers process prod data only
- [ ] Prod frontend connects to prod Supabase branch
- [ ] Prod frontend shows prod data only
- [ ] No cross-contamination with dev data
- [ ] CloudWatch logs show prod workers running
- [ ] ECS tasks are healthy

### Infrastructure

- [ ] Amplify deployment is fast (no timeouts)
- [ ] CDK stacks deploy successfully
- [ ] No old ECS resources in Amplify stack
- [ ] ECR repositories created correctly
- [ ] IAM roles have correct permissions
- [ ] CloudWatch logs are being written

---

## Rollback Plan

If something goes wrong:

### Rollback Workers to Amplify (if needed)

1. **Stop CDK stacks:**
   ```bash
   cdk destroy WorkerStack-Dev
   cdk destroy WorkerStack-Prod
   ```

2. **Revert `amplify/backend.ts`:**
   - Git revert the removal of ECS infrastructure
   - Redeploy Amplify

3. **Use old ECR repos** (if they still exist)

### Rollback Database (if needed)

1. **Supabase branches can be deleted/recreated**
2. **Or merge branches if needed**
3. **Or use main branch for both** (temporary)

---

## Cost Monitoring

### Initial Costs

After implementation, monitor AWS costs:
- ECS Fargate tasks (dev + prod)
- CloudWatch Logs ingestion/storage
- ECR storage (usually minimal)
- Data transfer (usually minimal)

### Expected Monthly Costs

- **Dev workers:** ~$15-30/month
- **Prod workers:** ~$30-60/month
- **Database (Supabase):** ~$25-50/month
- **Frontend/API (Amplify):** ~$15-25/month
- **Total:** ~$85-165/month

### Cost Optimization Tips

1. **Reduce task count** if utilization is low
2. **Reduce task size** (CPU/memory) if possible
3. **Reduce CloudWatch log retention** (currently 1 week)
4. **Use Spot instances** (not available for Fargate, but consider for future EC2-based workers)

---

## Next Steps After Implementation

1. **Set up monitoring/alerts:**
   - CloudWatch alarms for task failures
   - SNS notifications for critical errors

2. **Automate deployments:**
   - GitHub Actions for building/pushing images
   - Optional: Auto-deploy CDK stacks

3. **Set up backups:**
   - Verify Supabase automatic backups
   - Document backup/restore procedures

4. **Scale as needed:**
   - Monitor worker utilization
   - Scale up tasks if needed
   - Add auto-scaling if utilization is high

5. **Consider staging environment:**
   - When revenue > $5,000/month
   - Or when team size > 3 engineers
   - Add staging Supabase branch + staging workers

---

## Files to Create/Modify

### New Files

- `infra/workers/package.json`
- `infra/workers/tsconfig.json`
- `infra/workers/cdk.json`
- `infra/workers/bin/workers.ts`
- `infra/workers/lib/worker-stack.ts`
- `docs/infrastructure/DEPLOYMENT.md` (deployment guide)

### Modified Files

- `amplify/backend.ts` - Remove ECS worker infrastructure
- `workers/send-worker/push-to-ecr.sh` - Add environment parameter (optional)
- `workers/scheduler-worker/push-to-ecr.sh` - Add environment parameter (optional)

### Configuration to Update

- Amplify environment variables (dev + prod)
- Lambda environment variables (if using Supabase)
- SSM Parameter Store (verify paths are correct)

---

## Timeline Estimate

- **Phase 1 (Supabase Branches):** 2-4 hours
- **Phase 2 (CDK Extraction):** 4-6 hours
- **Phase 3 (Docker Images):** 2-3 hours
- **Phase 4 (Deploy Workers):** 2-4 hours
- **Phase 5 (Frontend Config):** 1-2 hours
- **Phase 6 (Cleanup/Docs):** 2-3 hours

**Total:** ~13-22 hours (2-3 days of focused work)

---

## Risk Mitigation

### Risks During Implementation

1. **Amplify deployment still times out:**
   - Verify all ECS resources removed
   - Check for any remaining worker-related resources

2. **Workers can't connect to Supabase:**
   - Verify branch URLs are correct
   - Verify SSM parameter paths are correct
   - Check IAM permissions for SSM

3. **Data isolation issues:**
   - Test thoroughly with test data
   - Verify queries only access correct branch
   - Use Supabase dashboard to verify branch isolation

4. **CDK deployment fails:**
   - Check CloudFormation events for specific errors
   - Verify ECR repos exist before deploying services
   - Use `cdk synth` to validate before deploying

### Rollback Options

- Keep old Amplify infrastructure until new one is verified
- Use git branches to isolate changes
- Test dev first, then prod
- Keep old ECR images as backup

