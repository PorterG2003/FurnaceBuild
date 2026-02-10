# Furnace Workers Infrastructure

CDK project for deploying ECS workers (send worker and scheduler worker) to separate dev and prod environments.

## Prerequisites

1. **AWS CDK CLI installed (choose one):**
   
   **Option A: Install globally:**
   ```bash
   npm install -g aws-cdk
   ```
   
   **Option B: Use npx (no install needed):**
   ```bash
   npx aws-cdk --version  # Test it works
   ```

2. **AWS credentials configured:**
   ```bash
   aws configure
   ```

3. **Bootstrap CDK (first time only):**
   
   **If CDK installed globally:**
   ```bash
   cdk bootstrap aws://686255981838/us-west-2
   ```
   
   **If using npx:**
   ```bash
   npx aws-cdk bootstrap aws://686255981838/us-west-2
   ```
   
   **Or use npm script:**
   ```bash
   npm run bootstrap
   ```

## Installation

```bash
cd infra/workers
npm install
```

## Environment Variables Setup

**One-time setup:**

1. **Create `.env.local` file:**
   ```bash
   npm run env:setup
   # Or manually: cp .env.example .env.local
   ```

2. **Edit `.env.local` with your values:**
   ```bash
   # Open in your editor
   nano .env.local
   # or
   code .env.local
   ```

3. **Fill in your Supabase URLs:**
   - Get dev branch URL from Supabase Dashboard → Settings → API (switch to `dev` branch)
   - Get prod branch URL from Supabase Dashboard → Settings → API (switch to `main` branch)

**That's it!** All npm scripts will automatically load these variables. No need to export them manually.

**Variables needed:**
- `CDK_DEFAULT_ACCOUNT` - Your AWS account ID (default: 686255981838)
- `CDK_DEFAULT_REGION` - AWS region (default: us-west-2)
- `DEV_SUPABASE_URL` - Dev branch URL from Supabase
- `PROD_SUPABASE_URL` - Prod branch URL from Supabase

**Note:** `.env.local` is git-ignored and won't be committed.

## Deployment

### Deploy Dev Stack

```bash
npm run deploy:dev
```

### Deploy Prod Stack

```bash
npm run deploy:prod
```

### Deploy Both Stacks

```bash
npm run deploy:all
```

## Verify Deployment

After deployment, check:

1. **ECR Repositories:**
   ```bash
   aws ecr describe-repositories --repository-names furnace/send-worker-dev furnace/scheduler-worker-dev
   ```

2. **ECS Clusters:**
   ```bash
   aws ecs describe-clusters --clusters furnace-cluster-dev
   ```

3. **ECS Services:**
   ```bash
   aws ecs list-services --cluster furnace-cluster-dev
   ```

## Build and Push Docker Images

After deploying the stacks, build and push Docker images to ECR:

### Build All Workers

```bash
# Build and push all workers for dev
npm run build:dev

# Build and push all workers for prod
npm run build:prod
```

### Build Individual Workers

```bash
# Dev environment
npm run build:dev:send       # Send worker only
npm run build:dev:scheduler  # Scheduler worker only

# Prod environment
npm run build:prod:send      # Send worker only
npm run build:prod:scheduler # Scheduler worker only
```

### Manual Build (Alternative)

You can also use the script directly:

```bash
bash scripts/build-and-push.sh dev all           # All workers for dev
bash scripts/build-and-push.sh prod send-worker  # Send worker for prod
```

The script will:
- ✅ Automatically get ECR repository URIs from CDK stack outputs
- ✅ Login to ECR
- ✅ Build Docker images for linux/amd64 platform
- ✅ Push images to ECR

## Useful Commands

### CDK Commands
- `npm run build` - Compile TypeScript to JavaScript
- `npm run watch` - Watch for changes and compile
- `npm run cdk` - Show CDK CLI help
- `npm run deploy:dev` - Deploy dev stack
- `npm run deploy:prod` - Deploy prod stack
- `npm run synth:dev` - Synthesize dev stack template
- `npm run diff:dev` - Compare deployed dev stack with current state

### Docker Build Commands
- `npm run build:dev` - Build and push all workers for dev
- `npm run build:prod` - Build and push all workers for prod
- `npm run build:dev:send` - Build send worker for dev
- `npm run build:dev:scheduler` - Build scheduler worker for dev

### Scaling Commands
- `npm run scale:dev` - Scale dev services to 1 task each (queries `furnace-cluster-dev` only)
- `npm run scale:prod` - Scale prod services to 1 task each (queries `furnace-cluster-prod` only)
- `npm run scale:down:dev` - Scale dev services to 0 tasks (stop workers)
- `npm run scale:down:prod` - Scale prod services to 0 tasks (stop workers)

**Note:** Services are isolated by cluster - the script queries the specific cluster for that environment, so dev and prod won't mix.

### Inbox Checker Runtime Ownership

To avoid duplicate ingestion, only one inbox checker runtime should be active:

- **Option A (default):** Amplify Lambda `inboxChecker`
- **Option B:** ECS `inbox-checker-worker`

When scaling ECS inbox checker above `0`, disable Lambda ingestion at deploy time:

```bash
INBOX_CHECKER_LAMBDA_ENABLED=false npx ampx pipeline-deploy --branch "$AWS_BRANCH" --app-id "$AWS_APP_ID"
```

The scaling script enforces this by default and blocks inbox checker ECS scale-up unless you explicitly override with:

```bash
ALLOW_DUAL_INGESTION=true bash scripts/scale-services.sh dev 1 1 1
```

### Stack Management
- `npm run check:stack` - Check stack status
- `npm run cancel:stack` - Cancel stuck stack deployment

