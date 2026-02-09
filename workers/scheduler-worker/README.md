# Scheduler Worker

Scheduler worker for processing enrollments and creating message jobs.

## Overview

This worker:
- Polls Supabase database continuously for enrollments ready to process
- Evaluates campaign flows to find next nodes
- Creates message_jobs for email nodes
- Pushes message_job IDs to SQS send_queue
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
│   ├── node-handlers/     # Node type handlers
│   │   └── email-handler.ts
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
- `SUPABASE_SECRET_KEY_PARAM_PATH` (required): SSM Parameter Store path to fetch `SUPABASE_SECRET_KEY` from
  - Example: `/amplify/furnacebuild/dev/SUPABASE_SECRET_KEY`
  - If set, the worker will fetch the secret from Parameter Store at startup
- `AWS_REGION` (optional): AWS region, defaults to `us-west-2`

### Optional (Local Development)

- `SUPABASE_SECRET_KEY` (optional): Supabase Secret Key
  - Can be provided directly, or fetched from Parameter Store if `SUPABASE_SECRET_KEY_PARAM_PATH` is set
  - `SUPABASE_SECRET_KEY_PARAM_PATH` (optional): SSM Parameter Store path to fetch `SUPABASE_SECRET_KEY` from
  - Example: `/amplify/furnacebuild/dev/SUPABASE_SECRET_KEY`
  - If set, the worker will fetch the secret from Parameter Store at startup

## Architecture

- **Continuous Polling**: Workers poll Supabase database every 5 seconds (configurable)
- **Batch Processing**: Processes up to 100 enrollments per poll (configurable)
- **Auto-Scaling**: Scales based on enrollment count metric (1-20 workers)
- **Error Handling**: Individual enrollment errors don't stop worker processing

## Development Workflow

1. **Make code changes** in `src/`
2. **Install/update dependencies** (if you added any): `cd workers/scheduler-worker && npm install`
3. **Build TypeScript**: `npm run build`
4. **Test locally** (optional): `npm start` (requires env vars)
5. **Build and push Docker image**: From repo root, run `./workers/scheduler-worker/push-to-ecr.sh`
6. **Deploy to ECS** (via Amplify): ECS will automatically use the new `latest` image on next task start

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

