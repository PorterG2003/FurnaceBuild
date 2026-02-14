# Migration: Lambda Scheduler → ECS Scheduler Workers

## Overview

This document outlines the steps required to migrate from the existing Lambda-based scheduler to ECS Fargate scheduler workers before implementing Phase 3.1 (Flow Evaluation Engine).

**Current State:**
- ✅ Lambda scheduler exists at `amplify/functions/scheduler/`
- ✅ Lambda is deployed and running (scheduled every 1 minute)
- ✅ Basic flow evaluation placeholder exists in Lambda handler
- ✅ Lambda has IAM permissions for Supabase and SQS

**Target State:**
- ECS Fargate scheduler workers (continuous polling)
- Auto-scaling based on enrollment count
- Same ECS cluster as send workers
- Lambda scheduler removed/deprecated

---

## Migration Steps

### Step 1: Create Scheduler Worker Infrastructure

#### 1.1 Create Worker Directory Structure

**Location:** `workers/scheduler-worker/`

**Tasks:**
- Create directory structure:
  ```
  workers/scheduler-worker/
  ├── src/
  │   ├── index.ts              # Main entry point
  │   ├── worker.ts             # Core worker logic (main loop)
  │   ├── database.ts           # Supabase polling logic
  │   ├── flow-evaluation.ts   # Flow traversal (migrate from Lambda)
  │   ├── scheduling.ts         # Schedule calculation
  │   ├── node-handlers/        # Node type handlers
  │   ├── supabase.ts          # Supabase client setup
  │   └── types.ts             # TypeScript types
  ├── Dockerfile
  ├── package.json
  ├── tsconfig.json
  └── README.md
  ```

**Dependencies:**
- Copy structure from `workers/send-worker/` as template
- Similar patterns: polling loop, error handling, graceful shutdown

#### 1.2 Migrate Logic from Lambda Handler

**Source:** `amplify/functions/scheduler/handler.ts`

**Tasks:**
- Extract `processEnrollment()` function → move to `workers/scheduler-worker/src/worker.ts`
- Extract `evaluateFlow()` function → move to `workers/scheduler-worker/src/flow-evaluation.ts`
- Extract `createMessageJob()` function → move to `workers/scheduler-worker/src/node-handlers/email-handler.ts`
- Extract `calculateScheduledAt()` function → move to `workers/scheduler-worker/src/scheduling.ts`
- Update imports and dependencies

**Key Changes:**
- Replace EventBridge handler pattern with continuous polling loop
- Replace Lambda environment variable access with ECS environment variables
- Replace Lambda timeout constraints with continuous processing

#### 1.3 Create Database Polling Client

**New File:** `workers/scheduler-worker/src/database.ts`

**Tasks:**
- Create `DatabaseClient` class (similar to `QueueClient` in send-worker)
- Implement `poll()` method that queries Supabase:
  ```typescript
  SELECT * FROM enrollments 
  WHERE state = 'active' 
  AND next_run_at <= NOW() 
  LIMIT 100
  ORDER BY next_run_at ASC
  ```
- Add polling interval configuration (default: 5 seconds)
- Add error handling and retry logic

#### 1.4 Create Worker Main Loop

**New File:** `workers/scheduler-worker/src/worker.ts`

**Tasks:**
- Create `SchedulerWorker` class (similar to `SendWorker`)
- Implement `start()` method with continuous polling loop:
  ```typescript
  while (running) {
    const enrollments = await databaseClient.poll();
    if (enrollments.length > 0) {
      await Promise.all(enrollments.map(e => processEnrollment(e)));
    } else {
      await sleep(pollInterval);
    }
  }
  ```
- Implement graceful shutdown (SIGTERM/SIGINT handlers)
- Add error handling and logging

#### 1.5 Create Dockerfile

**New File:** `workers/scheduler-worker/Dockerfile`

**Tasks:**
- Base on `workers/send-worker/Dockerfile` as template
- Update WORKDIR and COPY paths for scheduler-worker
- Same build process: TypeScript compilation → production image
- Ensure ESM module resolution (`.js` extensions in imports)

#### 1.6 Create Package Configuration

**New File:** `workers/scheduler-worker/package.json`

**Tasks:**
- Copy structure from `workers/send-worker/package.json`
- Dependencies:
  - `@supabase/supabase-js` (for database polling)
  - `@aws-sdk/client-sqs` (for pushing message_jobs to send_queue)
  - `@aws-sdk/client-ssm` (for fetching secrets from Parameter Store)
  - `date-fns-tz` (for timezone handling in scheduling)
- Scripts: `build`, `start`, `dev`

#### 1.7 Create TypeScript Configuration

**New File:** `workers/scheduler-worker/tsconfig.json`

**Tasks:**
- Copy from `workers/send-worker/tsconfig.json`
- Ensure `module: "Node16"` and `moduleResolution: "node16"` for ESM support
- Update paths if needed

---

### Step 2: Create ECS Service Infrastructure

#### 2.1 Add ECR Repository

**File:** `amplify/backend.ts`

**Tasks:**
- Add ECR repository for scheduler-worker:
  ```typescript
  const schedulerWorkerRepo = new ecr.Repository(backend.stack, 'SchedulerWorkerRepo', {
    repositoryName: 'furnace/scheduler-worker',
    imageScanOnPush: true,
    lifecycleRules: [{ maxImageCount: 10 }],
  });
  ```

#### 2.2 Create IAM Task Role

**File:** `amplify/backend.ts`

**Tasks:**
- Create `SchedulerWorkerTaskRole`:
  - Supabase access (SSM Parameter Store for service key)
  - SQS write permissions (to push message_jobs to send_queue)
  - CloudWatch Logs permissions
- Reuse `taskExecutionRole` from send-worker (for ECR pull, logs)

#### 2.3 Create Task Definition

**File:** `amplify/backend.ts`

**Tasks:**
- Create Fargate task definition:
  - Memory: 1024 MB
  - CPU: 512
  - Task role: `SchedulerWorkerTaskRole`
  - Execution role: Reuse from send-worker
- Add container:
  - Image: ECR repository `latest` tag
  - Environment variables:
    - `SUPABASE_URL` (from process.env)
    - `SEND_QUEUE_URL` (from process.env)
    - `SUPABASE_SECRET_KEY_PARAM_PATH` (Parameter Store path)
    - `AWS_REGION` (from process.env)
  - Logging: CloudWatch Logs with log group

#### 2.4 Create ECS Service

**File:** `amplify/backend.ts`

**Tasks:**
- Create Fargate service:
  - Cluster: Reuse existing `furnace-cluster`
  - Task definition: Scheduler worker task definition
  - Desired count: 2 (start with 2 workers)
  - VPC: Reuse existing VPC
  - Subnets: Public subnets (for internet access to Supabase)
  - Health check: Configure if needed

#### 2.5 Create CloudWatch Log Group

**File:** `amplify/backend.ts`

**Tasks:**
- Create log group: `/ecs/furnace/scheduler-worker`
- Retention: 1 week
- Removal policy: DESTROY

---

### Step 3: Create Auto-Scaling Infrastructure

#### 3.1 Create Enrollment Count Metric Lambda

**Purpose:** Publish CloudWatch custom metric for enrollment count (required for ECS auto-scaling)

**New Function:** `amplify/functions/enrollmentMetric/`

**Tasks:**
- Create Lambda function:
  - Name: `enrollmentMetric`
  - Schedule: `every 1m` (runs every minute)
  - Timeout: 30 seconds
  - Memory: 256 MB
- Handler logic:
  ```typescript
  // Query Supabase for enrollment count
  const { count } = await supabase
    .from('enrollments')
    .select('*', { count: 'exact', head: true })
    .eq('state', 'active')
    .lte('next_run_at', new Date().toISOString());
  
  // Publish custom metric
  await cloudwatch.send(new PutMetricDataCommand({
    Namespace: 'Furnace/Scheduler',
    MetricData: [{
      MetricName: 'EnrollmentsReadyToProcess',
      Value: count || 0,
      Timestamp: new Date(),
    }],
  }));
  ```
- IAM permissions: CloudWatch `PutMetricData`

#### 3.2 Configure ECS Auto-Scaling

**File:** `amplify/backend.ts`

**Tasks:**
- Create auto-scaling target:
  ```typescript
  const schedulerScaling = schedulerWorkerService.autoScaleTaskCount({
    minCapacity: 1,
    maxCapacity: 20,
  });
  ```
- Create custom metric (reference the metric published by Lambda)
- Configure scaling steps:
  - Scale down when enrollment count < 10 (remove 1 worker)
  - Scale up when enrollment count > 50 (add 1 worker)
  - Scale up when enrollment count > 100 (add 2 workers)
  - Scale up when enrollment count > 500 (add 5 workers)

**Note:** ECS auto-scaling requires a CloudWatch metric. The `enrollmentMetric` Lambda publishes this metric every minute.

---

### Step 4: Build and Push Docker Image

#### 4.1 Build Docker Image

**Tasks:**
- From repository root:
  ```bash
  cd workers/scheduler-worker
  npm install  # Install dependencies
  cd ../..
  docker buildx build \
    --platform linux/amd64 \
    -f workers/scheduler-worker/Dockerfile \
    -t furnace/scheduler-worker:latest \
    --load \
    .
  ```

#### 4.2 Push to ECR

**Tasks:**
- Get ECR repository URI (after ECR repo is created in Step 2.1)
- Login to ECR:
  ```bash
  aws ecr get-login-password --region us-west-2 | \
    docker login --username AWS --password-stdin <ECR_URI>
  ```
- Tag and push:
  ```bash
  docker tag furnace/scheduler-worker:latest <ECR_URI>:latest
  docker push <ECR_URI>:latest
  ```

**Helper Script:** Create `workers/scheduler-worker/push-to-ecr.sh` (similar to send-worker)

---

### Step 5: Deploy Infrastructure

#### 5.1 Deploy Amplify Backend

**Tasks:**
- Update `amplify/backend.ts` with scheduler worker infrastructure
- Deploy:
  ```bash
  npx ampx sandbox
  ```
- Verify:
  - ECR repository created
  - ECS service created
  - Task definition created
  - IAM roles created
  - CloudWatch log group created

#### 5.2 Deploy Enrollment Metric Lambda

**Tasks:**
- Deploy `enrollmentMetric` Lambda (included in Amplify backend)
- Verify:
  - Lambda is scheduled (EventBridge rule created)
  - Lambda has CloudWatch PutMetricData permissions
  - Metric is being published (check CloudWatch Metrics)

#### 5.3 Verify ECS Service

**Tasks:**
- Check ECS service status:
  ```bash
  aws ecs describe-services \
    --cluster furnace-cluster \
    --services <scheduler-worker-service-name> \
    --region us-west-2
  ```
- Check tasks are running:
  ```bash
  aws ecs list-tasks \
    --cluster furnace-cluster \
    --service-name <scheduler-worker-service-name> \
    --region us-west-2
  ```
- Check CloudWatch logs:
  ```bash
  aws logs tail /ecs/furnace/scheduler-worker --follow --region us-west-2
  ```

---

### Step 6: Deprecate Lambda Scheduler

#### 6.1 Disable Lambda Schedule

**File:** `amplify/functions/scheduler/resource.ts`

**Tasks:**
- **Option 1 (Recommended):** Comment out the schedule:
  ```typescript
  // schedule: 'every 1m', // DISABLED - Migrated to ECS workers
  ```
- **Option 2:** Remove schedule entirely (Lambda will still exist but won't run)

**Note:** Keep Lambda code for reference during migration, but disable execution.

#### 6.2 Verify ECS Workers Are Processing

**Tasks:**
- Monitor CloudWatch logs for scheduler-worker
- Verify enrollments are being processed
- Verify message_jobs are being created
- Verify message_jobs are being pushed to SQS

#### 6.3 Remove Lambda (After Verification)

**File:** `amplify/backend.ts`

**Tasks:**
- Remove `scheduler` function from backend definition:
  ```typescript
  // Remove: scheduler,
  ```
- Remove IAM permissions for scheduler Lambda (if any)
- Deploy to remove Lambda:
  ```bash
  npx ampx sandbox
  ```

**Alternative:** Keep Lambda code in repository but remove from deployment (for reference)

---

### Step 7: Update Documentation

#### 7.1 Update Implementation Plan

**File:** `docs/implementation/status/IMPLEMENTATION_PLAN.md`

**Tasks:**
- ✅ Already updated (Phase 2.2, 3.1, Scaling Strategy)

#### 7.2 Update Phase 3.1 Plan

**File:** `docs/implementation/flow/PHASE3.1_FLOW_EVALUATION_ENGINE.md`

**Tasks:**
- ✅ Already updated (prerequisites, current state)

#### 7.3 Create Scheduler Worker README

**New File:** `workers/scheduler-worker/README.md`

**Tasks:**
- Document worker purpose and architecture
- Document environment variables
- Document local development workflow
- Document Docker build and push process
- Document troubleshooting

---

## Migration Checklist

### Infrastructure Setup
- [ ] Create `workers/scheduler-worker/` directory structure
- [ ] Create `DatabaseClient` class for Supabase polling
- [ ] Create `SchedulerWorker` class with main loop
- [ ] Migrate logic from Lambda handler to worker
- [ ] Create Dockerfile
- [ ] Create package.json and tsconfig.json
- [ ] Build and test Docker image locally

### AWS Infrastructure
- [ ] Add ECR repository to `amplify/backend.ts`
- [ ] Create IAM task role with required permissions
- [ ] Create task definition
- [ ] Create ECS service
- [ ] Create CloudWatch log group
- [ ] Create `enrollmentMetric` Lambda
- [ ] Configure ECS auto-scaling
- [ ] Deploy infrastructure (`npx ampx sandbox`)

### Docker Image
- [ ] Build Docker image for linux/amd64
- [ ] Push to ECR
- [ ] Verify image is accessible by ECS

### Verification
- [ ] ECS service is running
- [ ] Tasks are healthy
- [ ] CloudWatch logs show worker activity
- [ ] Enrollments are being processed
- [ ] Message jobs are being created
- [ ] Message jobs are being pushed to SQS
- [ ] Auto-scaling metric is being published

### Cleanup
- [ ] Disable Lambda schedule
- [ ] Verify ECS workers are handling all processing
- [ ] Remove Lambda from deployment (optional)
- [ ] Update documentation

---

## Rollback Plan

If migration fails:

1. **Re-enable Lambda scheduler:**
   - Uncomment `schedule: 'every 1m'` in `amplify/functions/scheduler/resource.ts`
   - Deploy: `npx ampx sandbox`

2. **Disable ECS service:**
   - Set desired count to 0 in `amplify/backend.ts`
   - Deploy: `npx ampx sandbox`

3. **Monitor:**
   - Check Lambda logs to verify it's processing enrollments
   - Check ECS service is stopped

---

## Dependencies

### Required Before Migration
- ✅ ECS cluster exists (`furnace-cluster`)
- ✅ SQS send_queue exists
- ✅ Supabase database schema (enrollments, message_jobs, campaigns)
- ✅ Docker build process established (from send-worker)
- ✅ ECR access permissions configured

### Required During Migration
- AWS CLI configured with appropriate permissions
- Docker installed and running
- Node.js 20+ for local development/testing

---

## Timeline Estimate

- **Step 1 (Worker Code):** 2-3 hours
- **Step 2 (ECS Infrastructure):** 1-2 hours
- **Step 3 (Auto-Scaling):** 1 hour
- **Step 4 (Docker Build/Push):** 30 minutes
- **Step 5 (Deploy):** 30 minutes
- **Step 6 (Deprecate Lambda):** 30 minutes
- **Step 7 (Documentation):** 1 hour

**Total:** ~6-9 hours

---

## Notes

- **Keep Lambda code for reference:** Don't delete immediately, keep for comparison during migration
- **Parallel running:** Lambda and ECS workers can run in parallel during migration (disable Lambda schedule first to avoid duplicate processing)
- **Testing:** Test worker locally before deploying to ECS
- **Monitoring:** Monitor both Lambda and ECS logs during migration to ensure smooth transition
- **Gradual rollout:** Consider starting with 1 ECS worker, then scaling up after verification

---

## Next Steps After Migration

Once migration is complete:
1. Proceed with Phase 3.1 implementation (Flow Evaluation Engine enhancements)
2. Implement mailbox selection and load balancing
3. Implement scheduling logic (campaign schedules, jitter)
4. Implement node handlers (email, waitTime, aiCategorizer, etc.)

