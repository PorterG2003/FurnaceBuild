# Furnace Workers Infrastructure

CDK project for deploying ECS worker infrastructure for `send-worker`, `scheduler-worker`, `inbox-checker-worker`, the ad hoc `smartlead-migration-task`, and ad hoc **state registry scrapers** **`utah-scraper`** and **`florida-scraper`** (Docker under [`workers/state-scrapers/`](../../workers/state-scrapers/)) across separate dev and prod environments.

Shared naming and CDK checklist: [State scraper ECS playbook](../../docs/foundry/engineering/state-scraper-ecs-playbook.md).

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

3. **Fill in your Supabase URLs and SSM paths:**
   - Get dev branch URL from Supabase Dashboard → Settings → API (switch to `dev` branch)
   - Get prod branch URL from Supabase Dashboard → Settings → API (switch to `main` branch)
   - Set **`DEV_SECRET_SSM_PREFIX`** and **`PROD_SECRET_SSM_PREFIX`** (parent SSM path per environment; CDK adds `/SUPABASE_SECRET_KEY` and `/LEADS_SUPABASE_SECRET_KEY`). See [`docs/infrastructure/WORKER_SSM_AND_AMPLIFY_SECRETS.md`](../../docs/infrastructure/WORKER_SSM_AND_AMPLIFY_SECRETS.md).

**That's it!** All npm scripts will automatically load these variables. No need to export them manually.

**Variables needed:**
- `CDK_DEFAULT_ACCOUNT` - Your AWS account ID (default: 686255981838)
- `CDK_DEFAULT_REGION` - AWS region (default: us-west-2)
- `DEV_SUPABASE_URL` - Dev branch URL from Supabase
- `PROD_SUPABASE_URL` - Prod branch URL from Supabase
- `DEV_SECRET_SSM_PREFIX` / `PROD_SECRET_SSM_PREFIX` - Required for CDK synth (see doc above). Leads paths are derived from the same prefix when leads URLs are set.

**Note:** `.env.local` is git-ignored and won't be committed.

## Deployment

### Deployment Contract With Amplify

Amplify owns the app backend and Lambda functions. `infra/workers` owns the ECS cluster, networking, task definitions, and worker images.

The Smartlead migration launcher and **Foundry async state matching** in `amplify/backend.ts` import CloudFormation exports from the worker stack, including:

- `FurnaceCluster-{env}`
- `FurnaceWorkerSecurityGroup-{env}`
- `FurnaceWorkerPublicSubnets-{env}`
- `FurnaceWorkerVpcId-{env}` and `FurnaceWorkerVpcAvailabilityZones-{env}` (state matching / Step Functions)
- `FurnaceEcsTaskExecutionRole-{env}`, `FurnaceUtahScraperTaskRole-{env}` (Utah reconciliation via ECS)

Task definition ARNs for **Smartlead migration** and **state scrapers** are not exported (to avoid export churn on every revision). WorkerStack writes them to SSM:

- `/furnace/ecs/{env}/smartlead-migration/task-definition-arn`
- `/furnace/ecs/{env}/utah-scraper/task-definition-arn`
- `/furnace/ecs/{env}/florida-scraper/task-definition-arn`

Because of that dependency, deploy the matching worker stack before any Amplify backend deploy that includes those integrations:

- Amplify sandbox / non-production deploys should use worker environment `dev`
- Amplify production deploys should use worker environment `prod`
- If those exports are missing, Amplify backend deployment will fail

**Opt out (no worker stack / local sandbox):** set `AMPLIFY_ENABLE_SMARTLEAD_MIGRATION=false` (or `0`) in `.env.local` before `npx ampx sandbox`, or in **Amplify Console → Environment variables** for Hosted builds. That omits the `launchSmartleadMigration` Lambda and skips `Fn.importValue` wiring and the export pre-check in `amplify.yml`. Unset or any other value keeps the default (enabled). For Hosting, use the same variable on branches that deploy without `infra/workers`.

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
   aws ecr describe-repositories --repository-names \
     furnace/send-worker-dev \
     furnace/scheduler-worker-dev \
     furnace/inbox-checker-worker-dev \
     furnace/smartlead-migration-task-dev
   ```

2. **ECS Clusters:**
   ```bash
   aws ecs describe-clusters --clusters furnace-cluster-dev
   ```

3. **ECS Services:**
   ```bash
   aws ecs list-services --cluster furnace-cluster-dev
   ```

4. **Smartlead task definition SSM (RunTask ARN):**
   ```bash
   aws ssm get-parameter --name "/furnace/ecs/dev/smartlead-migration/task-definition-arn" --query Parameter.Value --output text
   ```

5. **Shared alerting behavior:**
   - first retryable worker incident posts immediately
   - repeated retryable incidents stop flooding Slack
   - later summary posts include counts/timestamps for the same worker-local aggregation key
   - critical failures still post immediately without aggregation delay

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
npm run build:dev:inbox-checker
npm run build:dev:smartlead

# Prod environment
npm run build:prod:send      # Send worker only
npm run build:prod:scheduler # Scheduler worker only
npm run build:prod:inbox-checker
npm run build:prod:smartlead
```

### Manual Build (Alternative)

You can also use the script directly:

```bash
bash scripts/build-and-push.sh dev all           # All workers for dev
bash scripts/build-and-push.sh prod send-worker  # Send worker for prod
bash scripts/build-and-push.sh dev smartlead-migration-task
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
- `npm run build:dev:inbox-checker` - Build inbox checker worker for dev
- `npm run build:dev:smartlead` - Build Smartlead migration task image for dev
- `./scripts/build-and-push.sh dev utah-scraper` - Build Utah registry scraper image for dev (see script for prod)
- `./scripts/build-and-push.sh dev florida-scraper` - Build Florida Sunbiz scraper image for dev (see script for prod)
- `npm run build:prod:inbox-checker` - Build inbox checker worker for prod
- `npm run build:prod:smartlead` - Build Smartlead migration task image for prod

### Scaling Commands
- `npm run scale:dev` - Scale dev services to 1 task each (queries `furnace-cluster-dev` only)
- `npm run scale:prod` - Scale prod services to 1 task each (queries `furnace-cluster-prod` only)
- `npm run scale:down:dev` - Scale dev services to 0 tasks (stop workers)
- `npm run scale:down:prod` - Scale prod services to 0 tasks (stop workers)

**Note:** Services are isolated by cluster - the script queries the specific cluster for that environment, so dev and prod won't mix.

### Smartlead Migration Task

Unlike the other workers, `smartlead-migration-task` is not an ECS service. Amplify launches it on demand with `ecs:RunTask` from `amplify/functions/launchSmartleadMigration/handler.ts`.

That means:

- build and push its Docker image through the shared worker scripts
- deploy the worker stack first so the exported cluster/network/task-definition values exist
- do not use service scaling or restart commands for Smartlead
- use task/log inspection commands instead:

```bash
# Check the task definition and latest runs
npm run check:task -- dev smartlead

# Check task definition environment
npm run check:env -- dev smartlead

# Check CloudWatch logs
npm run check:logs -- dev smartlead
```

### Utah registry scraper task

Like Smartlead migration, **`utah-scraper`** is a **RunTask-only** image (no ECS service). Image Dockerfile: `workers/state-scrapers/utah-scraper/Dockerfile`. Exports and SSM:

- `FurnaceUtahScraperTaskRepo-{env}`
- SSM `/furnace/ecs/{env}/utah-scraper/task-definition-arn` (latest task definition ARN)

Build and push:

```bash
./scripts/build-and-push.sh dev utah-scraper
```

Operational details, local CLI, and volume mounts for CSV/output: [docs/foundry/engineering/utah-registry-scraper.md](../../docs/foundry/engineering/utah-registry-scraper.md).

### Florida registry scraper task

Like Utah, **`florida-scraper`** is a **RunTask-only** image (no ECS service). Dockerfile: `workers/state-scrapers/florida-scraper/Dockerfile`.

- `FurnaceFloridaScraperTaskRepo-{env}`
- SSM `/furnace/ecs/{env}/florida-scraper/task-definition-arn`

Build and push:

```bash
./scripts/build-and-push.sh dev florida-scraper
```

The container runs the CSV CLI by default (`INPUT_CSV` / `OUTPUT_JSON`). Foundry Step Functions does not invoke Florida yet; use manual `RunTask` or wire a new branch using the SSM task definition ARN and `FurnaceFloridaScraperTaskRole-{env}`. See [State scraper ECS playbook](../../docs/foundry/engineering/state-scraper-ecs-playbook.md).

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

