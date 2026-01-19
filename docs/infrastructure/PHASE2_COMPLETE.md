# Phase 2: Extract Workers from Amplify - COMPLETE ✅

## What Was Done

### 1. Created Separate CDK Project

**Location:** `infra/workers/`

**Structure:**
```
infra/workers/
├── bin/
│   └── workers.ts          # Dev and prod stack definitions
├── lib/
│   └── worker-stack.ts     # Reusable WorkerStack class
├── cdk.json                # CDK configuration
├── tsconfig.json           # TypeScript configuration
├── package.json            # Dependencies and scripts
├── .gitignore              # Git ignore rules
└── README.md               # Documentation
```

### 2. Created Reusable WorkerStack

**File:** `infra/workers/lib/worker-stack.ts`

**Features:**
- Parameterized by environment (dev/prod)
- Accepts Supabase URL and SSM parameter path
- Configurable desired task count
- Creates all ECS infrastructure:
  - ECR repositories (send-worker, scheduler-worker)
  - VPC with public subnets (no NAT Gateway)
  - ECS cluster
  - IAM roles (task roles, execution roles)
  - Task definitions
  - ECS services
  - CloudWatch log groups

### 3. Created Dev and Prod Stacks

**File:** `infra/workers/bin/workers.ts`

**Stacks:**
- `WorkerStack-Dev` - Dev environment workers
- `WorkerStack-Prod` - Prod environment workers

**Environment Variables Required:**
- `DEV_SUPABASE_URL` or `SUPABASE_URL_DEV`
- `PROD_SUPABASE_URL` or `SUPABASE_URL_PROD`
- `CDK_DEFAULT_ACCOUNT` or `AWS_ACCOUNT_ID`
- `CDK_DEFAULT_REGION` or `AWS_REGION` (defaults to us-west-2)

### 4. Removed Workers from Amplify

**File:** `amplify/backend.ts`

**Removed:**
- All ECS-related imports (ecr, ecs, ec2, logs - except iam for Lambda)
- ECR repositories
- VPC
- ECS cluster
- IAM roles (task roles, execution roles)
- Task definitions
- ECS services
- CloudWatch log groups for workers
- Auto-scaling configuration

**Kept:**
- Lambda functions (enrollmentMetric, inboxChecker, sendInvitationEmail)
- Auth configuration
- Data API configuration
- CloudWatch permissions for enrollmentMetric Lambda (still useful for monitoring)

## Next Steps

### 1. Install CDK Dependencies

```bash
cd infra/workers
npm install
```

**If npm install fails due to sandbox restrictions:**
- Run `npm install` manually in your terminal
- Or use `npm install --legacy-peer-deps` if there are peer dependency issues

### 2. Bootstrap CDK (First Time Only)

```bash
cd infra/workers
cdk bootstrap aws://<your-account-id>/us-west-2
```

### 3. Set Environment Variables

Before deploying, set:

```bash
export CDK_DEFAULT_ACCOUNT=<your-aws-account-id>
export CDK_DEFAULT_REGION=us-west-2
export DEV_SUPABASE_URL=https://<project-ref>-dev.supabase.co
export PROD_SUPABASE_URL=https://<project-ref>.supabase.co
```

### 4. Test CDK Compilation

```bash
cd infra/workers
npm run build
cdk synth WorkerStack-Dev
```

This should synthesize the CloudFormation template without errors.

### 5. Deploy CDK Stacks

**Deploy dev stack:**
```bash
npm run deploy:dev
```

**Deploy prod stack:**
```bash
npm run deploy:prod
```

**Note:** Services will be created with `desiredCount: 0` initially, so tasks won't start until Docker images are pushed (Phase 3).

### 6. Test Amplify Deployment

```bash
# From project root
npx ampx sandbox
```

This should now:
- Deploy much faster (no ECS resources)
- Not timeout
- Only deploy Lambda functions and API resources

## Verification

### Check CDK Stack Created:

1. **ECR Repositories:**
   ```bash
   aws ecr describe-repositories --repository-names furnace/send-worker-dev furnace/scheduler-worker-dev
   ```

2. **ECS Cluster:**
   ```bash
   aws ecs describe-clusters --clusters furnace-cluster-dev
   ```

3. **ECS Services:**
   ```bash
   aws ecs list-services --cluster furnace-cluster-dev
   ```

### Check Amplify Cleaned Up:

- `amplify/backend.ts` should be much shorter (only Lambda functions)
- No ECS-related code should remain

## Files Modified

1. **Created:**
   - `infra/workers/` (entire directory)
   - `infra/workers/bin/workers.ts`
   - `infra/workers/lib/worker-stack.ts`
   - `infra/workers/package.json`
   - `infra/workers/tsconfig.json`
   - `infra/workers/cdk.json`
   - `infra/workers/.gitignore`
   - `infra/workers/README.md`

2. **Modified:**
   - `amplify/backend.ts` - Removed all ECS worker infrastructure

## Status

✅ Phase 2 Complete - Ready for Phase 3 (Build and Push Docker Images)


