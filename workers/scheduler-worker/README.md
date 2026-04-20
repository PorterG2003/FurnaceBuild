# Scheduler Worker

Scheduler worker for processing enrollments and creating message jobs.

## Overview

This worker:
- Polls Supabase database continuously for enrollments ready to process
- Evaluates campaign flows to find next nodes
- Moves enrollments onto email nodes, then creates `message_jobs` through batch interval assignment
- Uses a batched duplicate check for `message_jobs` instead of one lookup per enrollment
- Updates enrollment.next_run_at for wait/delay nodes
- Auto-scales based on enrollment count

## Project Structure

```
workers/scheduler-worker/
├── src/                    # TypeScript source code
│   ├── index.ts           # Main entry point
│   ├── worker.ts          # Core worker logic (main polling loop)
│   ├── database.ts        # Supabase polling logic
│   ├── flow-evaluation.ts # Flow traversal logic
│   ├── scheduling.ts      # Schedule calculation logic
│   ├── mailbox-selection.ts # Mailbox selection (round-robin)
│   ├── batch-interval-assignment.ts # Batch job creation for email nodes (assigns mailbox to lead, creates message_jobs)
│   ├── node-handlers/     # Node type handlers
│   │   ├── ai-categorizer-handler.ts
│   │   ├── data-sender-handler.ts
│   │   └── wait-time-handler.ts
│   ├── supabase.ts        # Supabase client setup
│   └── types.ts           # TypeScript type definitions
├── dist/                  # Compiled JavaScript (generated)
├── Dockerfile             # Docker build configuration
├── .dockerignore          # Docker ignore patterns
├── package.json           # Node.js dependencies
├── tsconfig.json          # TypeScript configuration
├── push-to-ecr.sh         # Helper: Build and push Docker image to ECR
└── README.md              # This file
```

## Local Development

### Prerequisites

- Node.js 20+
- npm or yarn
- Environment variables (see below)

### Setup

1. Install dependencies:
```bash
npm install
```

2. Set environment variables:
```bash
export SUPABASE_URL=your-supabase-url
export SUPABASE_SECRET_KEY=your-secret-key
export SEND_QUEUE_URL=https://sqs.us-west-2.amazonaws.com/.../furnace-send-queue
export AWS_REGION=us-west-2
```

3. Build TypeScript:
```bash
npm run build
```

4. Run worker:
```bash
npm start
```

For development with hot reload:
```bash
npm run dev
```

## Docker

### Build and Push to ECR

**Important:** Always run `npm install` in the `workers/scheduler-worker` directory first to update `package-lock.json` after adding dependencies.

From repository root:
```bash
# 1. Install dependencies (updates package-lock.json)
cd workers/scheduler-worker
npm install
cd ../..

# 2. Build and push to ECR
./workers/scheduler-worker/push-to-ecr.sh
```

Or manually:
```bash
# Get ECR repository URI
REPO_URI=$(aws ecr describe-repositories \
  --repository-names furnace/scheduler-worker \
  --region us-west-2 \
  --query 'repositories[0].repositoryUri' \
  --output text)

# Login to ECR
aws ecr get-login-password --region us-west-2 | \
  docker login --username AWS --password-stdin $REPO_URI

# Build for linux/amd64 (ECS Fargate requirement)
docker buildx build \
  --platform linux/amd64 \
  -f workers/scheduler-worker/Dockerfile \
  -t furnace/scheduler-worker:latest \
  -t $REPO_URI:latest \
  --load \
  .

# Push
docker push $REPO_URI:latest
```

## Environment Variables

### Required (ECS)

- `SUPABASE_URL` (required): Supabase project URL
- `SEND_QUEUE_URL` (required): SQS queue URL for sending message_jobs
- `SUPABASE_SECRET_KEY_PARAM_PATH` (required in ECS): **`{prefix}/SUPABASE_SECRET_KEY`** from **`DEV_SECRET_SSM_PREFIX`** / **`PROD_SECRET_SSM_PREFIX`** (see [`docs/infrastructure/WORKER_SSM_AND_AMPLIFY_SECRETS.md`](../../docs/infrastructure/WORKER_SSM_AND_AMPLIFY_SECRETS.md))
- `AWS_REGION` (optional): AWS region, defaults to `us-west-2`

### Optional (Local Development)

- `SUPABASE_SECRET_KEY` (optional): Supabase Secret Key
  - Can be provided directly, or fetched from Parameter Store if `SUPABASE_SECRET_KEY_PARAM_PATH` is set
  - `SUPABASE_SECRET_KEY_PARAM_PATH` (optional): Same as ECS; use your real Amplify/SSM path locally if not passing `SUPABASE_SECRET_KEY` directly

## Architecture

- **Continuous Polling**: Workers poll Supabase database every 5 seconds (configurable)
- **Batch Processing**: Processes up to 100 enrollments per poll (configurable)
- **Shared Campaign Context**: Each claim batch groups enrollments by `campaign_id`, preloads campaigns/accounts/nodes once, and reuses that context across the batch
- **Batched Email-Gate Reads**: The worker preloads latest `message_jobs` status for email-node enrollments so flow evaluation does not issue one lookup per enrollment
- **Single-Flight Background Tasks**: Interval maintenance, stale lock cleanup, and batch interval assignment skip overlapping ticks if a prior run is still active
- **Mailbox Reuse**: Batch interval assignment reuses a preloaded eligible mailbox pool instead of requerying mailbox eligibility for every unassigned lead
- **Batched Duplicate Filtering**: Batch interval assignment asks Supabase for existing `(enrollment_id, node_id)` pairs in one RPC-backed lookup before calling `batch_assign_jobs_to_interval`
- **Interval-Local Completion**: Batch interval assignment stamps `required_mailbox_count` onto the interval, and `message_jobs` triggers maintain assigned/terminal counters so completion no longer depends on a periodic reconciliation scan
- **One Candidate Per Mailbox**: The scheduler only sends one candidate job per mailbox into the current interval RPC because later candidates for the same mailbox cannot be scheduled into that interval
- **Backlog Pacing**: Full claim batches add a short post-batch delay to avoid tight-loop hammering during transient Supabase incidents
- **Auto-Scaling**: Scales based on enrollment count metric (1-20 workers)
- **Error Handling**: Individual enrollment errors don't stop worker processing
- **Alerting**: Retryable Supabase/read-path noise now sends one immediate Slack alert, then worker-local summaries with occurrence counts (default 60m window). Critical/non-retryable failures still alert immediately without aggregation.

## Development Workflow

1. **Make code changes** in `src/`
2. **Install/update dependencies** (if you added any): `cd workers/scheduler-worker && npm install`
3. **Build TypeScript**: `npm run build`
4. **Run scheduler tests**: `npm test`
5. **Test locally** (optional): `npm start` (requires env vars)
6. **Build and push Docker image**: From `infra/workers`, run `npm run build:dev:scheduler` or `npm run build:prod:scheduler`
7. **Restart services**: From `infra/workers`, run `npm run restart:dev` or `npm run restart:prod`

## Troubleshooting

### Docker build fails

- Make sure you're running from the repository root (not from `workers/scheduler-worker/`)
- Check that `package.json` and `tsconfig.json` exist in `workers/scheduler-worker/`
- Ensure `npm install` was run to update `package-lock.json`

### ECR push fails

- Verify AWS CLI is configured: `aws sts get-caller-identity`
- Check ECR permissions: Your IAM user needs `ecr:GetAuthorizationToken` and `ecr:PutImage`
- Make sure the ECR repository exists: `aws ecr describe-repositories --repository-names furnace/scheduler-worker --region us-west-2`

### Worker can't connect to Supabase

- Verify `SUPABASE_URL` environment variable is set correctly
- Check `SUPABASE_SECRET_KEY_PARAM_PATH` is correct
- Ensure IAM task role has `ssm:GetParameter` permissions
- Check CloudWatch logs: `/ecs/furnace/scheduler-worker`

### Worker not processing enrollments

- Check CloudWatch logs for errors
- Verify enrollments exist with `state = 'active'` and `next_run_at <= NOW()`
- Check database connection (Supabase URL and service key)
- Verify worker is running: `aws ecs list-tasks --cluster furnace-cluster --service-name <scheduler-worker-service-name>`

### Frequent Supabase 502/503 errors from `message_jobs`

- Confirm the scheduler image includes the shared campaign-context preload, batched email-gate lookup, and mailbox-pool reuse changes
- Confirm the scheduler only emits mailbox distribution queries when `SCHEDULER_LOG_MAILBOX_DISTRIBUTION=true` is explicitly enabled
- Confirm full claim batches now show a short pacing gap instead of immediately re-claiming another batch
- Confirm the scheduler image includes the batched duplicate lookup change and the matching migration
- Verify the `get_existing_message_job_pairs` RPC exists and the `idx_message_jobs_enrollment_node_status` index has been applied
- Check logs for repeated `Previous run still in progress; skipping overlapping tick` messages to identify a slow background task without creating more load
- Verify the interval-progress migration is applied so `campaign_intervals.required_mailbox_count`, `assigned_mailbox_count`, `expected_job_count`, and `terminal_job_count` stay in sync without `check_and_update_processed_intervals` running on a timer
- Check that retryable campaign/account/message-job transport failures are labeled as retryable read-path issues, not as missing campaign/account data
- In Slack, expect one immediate warning for a retryable scheduler issue, then a later summary showing `occurrences`, `first_seen`, and `last_seen` for the same aggregation key

