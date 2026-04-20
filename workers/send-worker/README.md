# Send Worker

Send worker for processing email jobs from SQS queue.

## Overview

This worker:
- Polls SQS queue for message jobs
- Loads job details from Supabase
- Sends emails via SMTP
- Updates job status and creates events
- Relies on trigger-backed `campaign_intervals` progress counters so campaign interval completion happens on terminal `message_jobs` updates instead of an extra reconciliation RPC

## Project Structure

```
workers/send-worker/
├── src/                    # TypeScript source code
│   ├── index.ts           # Main entry point
│   ├── worker.ts          # Core worker logic
│   ├── queue.ts           # SQS queue polling
│   ├── email.ts           # SMTP email sending
│   ├── supabase.ts        # Supabase client setup
│   └── types.ts           # TypeScript type definitions
├── dist/                  # Compiled JavaScript (generated)
├── Dockerfile             # Docker build configuration
├── .dockerignore          # Docker ignore patterns
├── package.json           # Node.js dependencies
├── tsconfig.json          # TypeScript configuration
├── get-ecr-uri.sh         # Helper: Get ECR repository URI
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

**Important:** Always run `npm install` in the `workers/send-worker` directory first to update `package-lock.json` after adding dependencies.

From repository root:
```bash
# 1. Install dependencies (updates package-lock.json)
cd workers/send-worker
npm install
cd ../..

# 2. Build and push to ECR
./workers/send-worker/push-to-ecr.sh
```

Or from the `workers/send-worker` directory:
```bash
# 1. Install dependencies
npm install

# 2. Build and push (must be run from repo root)
cd ../..
./workers/send-worker/push-to-ecr.sh
```

The script will:
- Get the ECR repository URI
- Log in to ECR
- Build the Docker image
- Tag it as `latest`
- Push it to ECR

### Build Image Locally (for testing)

From repository root:
```bash
docker build -f workers/send-worker/Dockerfile -t furnace/send-worker:latest .
```

### Run Container Locally

```bash
docker run --rm \
  -e SUPABASE_URL=your-supabase-url \
  -e SUPABASE_SECRET_KEY=your-secret-key \
  -e SEND_QUEUE_URL=https://sqs.us-west-2.amazonaws.com/.../furnace-send-queue \
  -e AWS_REGION=us-west-2 \
  furnace/send-worker:latest
```

## Helper Scripts

### Get ECR Repository URI

Get the ECR repository URI for tagging and pushing images:

```bash
chmod +x get-ecr-uri.sh
./get-ecr-uri.sh
```

This will output the repository URI and show example commands for building and pushing.

### Build and Push to ECR

Build the Docker image and push it to ECR in one command:

```bash
chmod +x push-to-ecr.sh
./push-to-ecr.sh [tag]
```

**Prerequisites:**
- AWS CLI configured with ECR permissions
- Docker installed and running
- ECR repository already created (see `amplify/backend.ts`)

**Example:**
```bash
# Push with 'latest' tag (default)
./push-to-ecr.sh

# Push with specific tag
./push-to-ecr.sh v1.0.0
```

The script will:
1. Get the ECR repository URI
2. Login to ECR
3. Build the Docker image
4. Tag the image
5. Push to ECR

## Environment Variables

- `SUPABASE_URL` (required): Supabase project URL
- `SUPABASE_SECRET_KEY` (required): Supabase Secret Key (bypasses RLS)
  - Can be provided directly, or fetched from Parameter Store if `SUPABASE_SECRET_KEY_PARAM_PATH` is set
- `SUPABASE_SECRET_KEY_PARAM_PATH` (optional for local): SSM full name for the Secret Key; in ECS CDK sets it to **`{DEV|PROD_SECRET_SSM_PREFIX}/SUPABASE_SECRET_KEY`** (see [`docs/infrastructure/WORKER_SSM_AND_AMPLIFY_SECRETS.md`](../../docs/infrastructure/WORKER_SSM_AND_AMPLIFY_SECRETS.md))
- `SEND_QUEUE_URL` (required): SQS queue URL
- `AWS_REGION` (optional): AWS region, defaults to `us-west-2`

## Architecture

See [docs/implementation/aws/PHASE2.6_DOCKER_IMAGES_ECR.md](../../docs/implementation/aws/PHASE2.6_DOCKER_IMAGES_ECR.md) for detailed architecture and implementation notes.

## Development Workflow

1. **Make code changes** in `src/`
2. **Install/update dependencies** (if you added any): `cd workers/send-worker && npm install`
3. **Build TypeScript**: `npm run build`
4. **Test locally** (optional): `npm start` (requires env vars)
5. **Build and push Docker image**: From repo root, run `./workers/send-worker/push-to-ecr.sh`
6. **Deploy to ECS** (Phase 2.3): ECS will automatically use the new `latest` image on next task start

## Troubleshooting

### Docker build fails

- Make sure you're running from the repository root (not from `workers/send-worker/`)
- Check that `package.json` and `tsconfig.json` exist in `workers/send-worker/`

### ECR push fails

- Verify AWS CLI is configured: `aws sts get-caller-identity`
- Check ECR permissions: Your IAM user needs `ecr:GetAuthorizationToken` and `ecr:PutImage`
- Make sure the ECR repository exists: `aws ecr describe-repositories --repository-names furnace/send-worker --region us-west-2`

### Worker can't connect to SQS

- Verify `SEND_QUEUE_URL` environment variable is set correctly
- Check AWS credentials have SQS permissions
- Ensure the queue exists: `aws sqs get-queue-url --queue-name furnace-send-queue --region us-west-2`

