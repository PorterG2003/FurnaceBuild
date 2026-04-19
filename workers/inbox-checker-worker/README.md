# Inbox Checker Worker

ECS Fargate worker for checking IMAP mailboxes for replies, bounces, and unsubscribes.

## Overview

This worker continuously polls the database for mailboxes that need IMAP checking, connects to each mailbox via IMAP, fetches new messages, and processes them to:
- Detect replies (match `In-Reply-To` to `provider_message_id`)
- Detect bounces (subject/body patterns)
- Detect unsubscribes (header/body patterns)
- Create email threads and messages
- Stop enrollments on reply/unsubscribe, and on **matched** bounces only (bounce recipient must match a recent sent campaign job for that mailbox; unrelated mailbox bounces are ignored for campaigns)

## Architecture

- **Pattern**: Similar to send-worker and scheduler-worker
- **Polling**: Atomic claiming via `claim_mailboxes_to_check()` RPC function
- **Processing**: Parallel processing (10 mailboxes at a time per worker)
- **Scaling**: Horizontal scaling (multiple workers)

## Environment Variables

- `SUPABASE_URL`: Supabase project URL
- `SUPABASE_SECRET_KEY`: Supabase Secret Key (or `SUPABASE_SECRET_KEY_PARAM_PATH` to fetch from Parameter Store)
- `AWS_REGION`: AWS region (defaults to us-west-2)

## Development

### Local Development

```bash
cd workers/inbox-checker-worker
npm install
npm run dev  # Uses tsx watch for hot reload
```

### Build

```bash
npm run build
```

## Deployment

**Important:** Always run `npm install` in the `workers/inbox-checker-worker` directory first to update `package-lock.json` after adding dependencies.

### 1. Deploy CDK Infrastructure (creates ECR repository)

```bash
cd infra/workers
npm run deploy:dev  # or deploy:prod
```

This creates the ECR repository and ECS service (but with 0 desired count).

### 2. Build and Push Docker Image

From repository root:
```bash
# 1. Install dependencies (updates package-lock.json)
cd workers/inbox-checker-worker
npm install
cd ../..

# 2. Build and push to ECR
cd infra/workers
npm run build:dev:inbox-checker  # or build:prod:inbox-checker
```

Or manually:
```bash
# From repo root
./workers/inbox-checker-worker/push-to-ecr.sh dev  # or 'prod' for production
```

### 3. Scale Up Worker

```bash
cd infra/workers
# Scale all workers: send=1, scheduler=1, inbox-checker=1
npm run scale:dev

# Or scale manually (send, scheduler, inbox-checker)
bash scripts/scale-services.sh dev 1 1 1
```

## Monitoring

- **CloudWatch Logs**: `/ecs/furnace/inbox-checker-worker-{environment}`
- **Metrics**: Mailboxes processed, messages found, replies/bounces/unsubscribes detected
- **Slack alerts**: retryable read-path issues post once immediately, then summarize repeated occurrences with counts on the next hourly rollover; critical mailbox/config failures still post immediately every time

## Performance

- **Single worker**: ~600 mailboxes/hour
- **1,000 mailboxes**: ~1.7 hours (1 worker) or ~10 minutes (10 workers)
- **Cost**: ~$0.10/day per worker (Fargate spot pricing)
