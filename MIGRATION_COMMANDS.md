# SQS to Database Migration - Deployment Commands

## Step 1: Apply Database Migration

You have two options:

### Option A: Supabase CLI (Recommended)

```bash
# Make sure you have Supabase CLI installed
# npm install -g supabase

# Link to your project (if not already linked)
# supabase link --project-ref your-project-ref

# Push migrations (applies all pending migrations)
supabase db push
```

### Option B: Manual (SQL Editor)

1. Open Supabase Dashboard → SQL Editor
2. Copy the contents of: `supabase/migrations/20260103050000_create_claim_message_jobs_ready_function.sql`
3. Paste and run the query

Verify the function was created:
```sql
SELECT * FROM pg_proc WHERE proname = 'claim_message_jobs_ready';
```

---

## Step 2: Build and Push Send Worker

```bash
# From repository root

# 1. Install dependencies (if you added any)
cd workers/send-worker
npm install
cd ../..

# 2. Build and push Docker image
./workers/send-worker/push-to-ecr.sh
```

---

## Step 3: Build and Push Scheduler Worker

```bash
# From repository root

# 1. Install dependencies (if you added any)
cd workers/scheduler-worker
npm install
cd ../..

# 2. Build and push Docker image
./workers/scheduler-worker/push-to-ecr.sh
```

---

## Step 4: Update ECS Services

After pushing Docker images, update your ECS services to use the new images:

### Update Send Worker Service

```bash
# Force new deployment (uses latest image)
aws ecs update-service \
  --cluster your-cluster-name \
  --service send-workers \
  --force-new-deployment \
  --region us-west-2
```

### Update Scheduler Worker Service

```bash
# Force new deployment (uses latest image)
aws ecs update-service \
  --cluster your-cluster-name \
  --service scheduler-workers \
  --force-new-deployment \
  --region us-west-2
```

**Note:** Replace `your-cluster-name` with your actual ECS cluster name.

---

## Step 5: Update ECS Task Definitions (Remove SQS Environment Variables)

You'll need to update the task definitions to remove `SEND_QUEUE_URL` environment variable:

### Option A: AWS Console

1. Go to ECS → Task Definitions
2. Find `send-workers` task definition → Create new revision
3. Remove `SEND_QUEUE_URL` environment variable
4. Save new revision
5. Update service to use new revision

Repeat for `scheduler-workers` task definition.

### Option B: AWS CLI (if using JSON task definitions)

Update your task definition JSON files to remove `SEND_QUEUE_URL`, then:

```bash
# Register new task definition
aws ecs register-task-definition \
  --cli-input-json file://send-workers-task-def.json \
  --region us-west-2

# Update service to use new task definition
aws ecs update-service \
  --cluster your-cluster-name \
  --service send-workers \
  --task-definition send-workers:NEW_REVISION \
  --region us-west-2
```

---

## Step 6: Update IAM Roles (Remove SQS Permissions)

Update the IAM roles for both worker services to remove SQS permissions:

1. Go to IAM → Roles
2. Find the role used by send-workers ECS tasks
3. Remove SQS read permissions policy
4. Find the role used by scheduler-workers ECS tasks  
5. Remove SQS write permissions policy

---

## Step 7: Verify Deployment

1. Check CloudWatch logs for both services
2. Verify send workers are polling database (look for `[DATABASE] Claimed X message job(s)`)
3. Verify scheduler workers are creating message jobs (no SQS errors)
4. Test end-to-end: Create test enrollment → Verify message jobs created → Verify emails sent

---

## Quick Command Summary

```bash
# 1. Apply migration
supabase db push

# 2. Build and push send worker
cd workers/send-worker && npm install && cd ../..
./workers/send-worker/push-to-ecr.sh

# 3. Build and push scheduler worker
cd workers/scheduler-worker && npm install && cd ../..
./workers/scheduler-worker/push-to-ecr.sh

# 4. Update ECS services (replace CLUSTER_NAME)
aws ecs update-service --cluster CLUSTER_NAME --service send-workers --force-new-deployment --region us-west-2
aws ecs update-service --cluster CLUSTER_NAME --service scheduler-workers --force-new-deployment --region us-west-2
```

