# Phase 2.6: Docker Images & ECR - Detailed Implementation Plan

## Overview

This phase sets up containerized send worker applications that will run on ECS Fargate. The workers will:
- Poll SQS queue for message jobs
- Load message job details from Supabase
- Send emails via SMTP
- Update job status and create events

**Important**: This is a **monorepo** setup. The worker code lives in the same repository, just in a dedicated directory structure.

---

## Directory Structure

```
/Users/porter/Projects/FurnaceBuild/
├── workers/
│   └── send-worker/
│       ├── src/
│       │   ├── index.ts          # Main entry point
│       │   ├── worker.ts         # Core worker logic
│       │   ├── queue.ts          # SQS polling logic
│       │   ├── email.ts          # SMTP sending logic
│       │   ├── supabase.ts       # Supabase client setup
│       │   └── types.ts          # Type definitions
│       ├── Dockerfile
│       ├── package.json
│       ├── tsconfig.json
│       ├── .dockerignore
│       └── README.md
├── amplify/
├── lib/
│   └── supabase/
│       └── types/               # Shared types (if needed by worker)
├── package.json                 # Root package.json
└── ...
```

**Key Considerations**:
- Worker code is isolated in `workers/send-worker/`
- Worker has its own `package.json` with only necessary dependencies
- Worker can reference shared types from `lib/supabase/types/` if needed (by copying or installing as a local package)
- Dockerfile builds from the monorepo root but only copies what's needed

---

## Step 1: Create Worker Directory Structure

### 1.1 Create Directory Structure

```bash
mkdir -p workers/send-worker/src
```

### 1.2 Create package.json

**workers/send-worker/package.json:**
```json
{
  "name": "@furnace/send-worker",
  "version": "1.0.0",
  "description": "Send worker for processing email jobs from SQS",
  "main": "dist/index.js",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsx watch src/index.ts"
  },
  "dependencies": {
    "@aws-sdk/client-sqs": "^3.0.0",
    "@supabase/supabase-js": "^2.77.0",
    "nodemailer": "^6.9.0",
    "dotenv": "^16.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/nodemailer": "^6.4.0",
    "typescript": "^5.9.0",
    "tsx": "^4.0.0"
  }
}
```

### 1.3 Create tsconfig.json

**workers/send-worker/tsconfig.json:**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "node",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

---

## Step 2: Create Worker Application Code

### 2.1 Create Type Definitions

**workers/send-worker/src/types.ts:**
```typescript
/**
 * Type definitions for send worker
 * 
 * Note: These should match Supabase types, but we'll define them here
 * for now to avoid dependency issues. In the future, we could:
 * - Share types via a shared package
 * - Generate types from Supabase schema
 * - Copy types from lib/supabase/types/
 */

export interface MessageJob {
  id: string;
  enrollment_id: string;
  campaign_id: string;
  lead_id: string;
  mailbox_id: string;
  node_id: string;
  status: 'pending' | 'reserved' | 'sending' | 'sent' | 'failed' | 'cancelled';
  scheduled_at: string;
  reserved_at: string | null;
  sent_at: string | null;
  provider_message_id: string | null;
  error_message: string | null;
  retry_count: number;
  message_data: {
    node_config: any;
    lead_data?: any;
    campaign_data?: any;
  };
  sqs_message_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Mailbox {
  id: string;
  email_address: string;
  display_name: string;
  smtp_host: string;
  smtp_port: number;
  smtp_username: string;
  smtp_password: string; // Will be decrypted if encrypted
  smtp_use_tls: boolean;
  smtp_use_ssl: boolean;
  smtp_status: 'active' | 'throttled' | 'error' | 'disabled';
  // ... other fields
}

export interface Lead {
  id: string;
  email: string;
  first_name?: string;
  last_name?: string;
  // ... other fields
}

export interface SQSMessage {
  message_job_id: string;
  enrollment_id: string;
  campaign_id: string;
  lead_id: string;
  mailbox_id: string;
  node_id: string;
}
```

### 2.2 Create Supabase Client Setup

**workers/send-worker/src/supabase.ts:**
```typescript
import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Initialize Supabase client for worker
 * 
 * Environment variables required:
 * - SUPABASE_URL: Supabase project URL
 * - SUPABASE_SERVICE_KEY: Service role key (bypasses RLS)
 */
export function createSupabaseClient(): SupabaseClient {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY environment variables');
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
```

### 2.3 Create SQS Queue Polling Logic

**workers/send-worker/src/queue.ts:**
```typescript
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand, Message } from '@aws-sdk/client-sqs';

export interface QueueConfig {
  queueUrl: string;
  region: string;
  maxMessages?: number;
  waitTimeSeconds?: number;
  visibilityTimeout?: number;
}

export class QueueClient {
  private sqs: SQSClient;
  private queueUrl: string;
  private maxMessages: number;
  private waitTimeSeconds: number;

  constructor(config: QueueConfig) {
    this.sqs = new SQSClient({ region: config.region });
    this.queueUrl = config.queueUrl;
    this.maxMessages = config.maxMessages ?? 10;
    this.waitTimeSeconds = config.waitTimeSeconds ?? 20; // Long polling
  }

  /**
   * Poll queue for messages (long polling)
   * Returns array of messages, or empty array if none found
   */
  async poll(): Promise<Message[]> {
    try {
      const command = new ReceiveMessageCommand({
        QueueUrl: this.queueUrl,
        MaxNumberOfMessages: this.maxMessages,
        WaitTimeSeconds: this.waitTimeSeconds,
        AttributeNames: ['All'],
        MessageAttributeNames: ['All'],
      });

      const result = await this.sqs.send(command);
      return result.Messages ?? [];
    } catch (error) {
      console.error('Error polling queue:', error);
      throw error;
    }
  }

  /**
   * Delete message from queue after successful processing
   */
  async deleteMessage(receiptHandle: string): Promise<void> {
    try {
      const command = new DeleteMessageCommand({
        QueueUrl: this.queueUrl,
        ReceiptHandle: receiptHandle,
      });

      await this.sqs.send(command);
    } catch (error) {
      console.error('Error deleting message:', error);
      throw error;
    }
  }
}
```

### 2.4 Create Email Sending Logic

**workers/send-worker/src/email.ts:**
```typescript
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type { Mailbox, MessageJob, Lead } from './types';

/**
 * Create SMTP transporter for a mailbox
 */
export function createTransporter(mailbox: Mailbox): Transporter {
  return nodemailer.createTransport({
    host: mailbox.smtp_host,
    port: mailbox.smtp_port,
    secure: mailbox.smtp_use_ssl, // true for 465, false for other ports
    requireTLS: mailbox.smtp_use_tls,
    auth: {
      user: mailbox.smtp_username,
      pass: mailbox.smtp_password, // TODO: Decrypt if encrypted in database
    },
    // Connection pool settings
    pool: true,
    maxConnections: mailbox.smtp_connection_limit ?? 5,
    maxMessages: mailbox.smtp_messages_per_connection ?? 100,
  });
}

/**
 * Generate unique Message-ID header for reply detection
 */
export function generateMessageId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 15);
  return `<${timestamp}.${random}@furnace.build>`;
}

/**
 * Merge template with lead data
 * Simple template replacement: {{field}} → lead.field
 */
export function mergeTemplate(template: string, lead: Lead): string {
  if (!template) return '';
  
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    const value = (lead as any)[key];
    return value !== undefined && value !== null ? String(value) : match;
  });
}

/**
 * Send email via SMTP
 */
export async function sendEmail(
  transporter: Transporter,
  mailbox: Mailbox,
  job: MessageJob,
  lead: Lead,
  subject: string,
  body: string
): Promise<string> {
  const messageId = generateMessageId();

  const mailOptions: nodemailer.SendMailOptions = {
    from: `"${mailbox.display_name}" <${mailbox.email_address}>`,
    to: lead.email,
    subject: subject,
    text: body,
    html: body, // TODO: Support HTML emails if needed
    messageId: messageId,
    headers: {
      'X-Message-ID': job.id, // Track our internal message_job_id
    },
  };

  const info = await transporter.sendMail(mailOptions);
  
  if (!info.messageId) {
    // If nodemailer doesn't set messageId, use our generated one
    return messageId;
  }
  
  return info.messageId;
}
```

### 2.5 Create Core Worker Logic

**workers/send-worker/src/worker.ts:**
```typescript
import { SupabaseClient } from '@supabase/supabase-js';
import { QueueClient } from './queue';
import { createTransporter, sendEmail, mergeTemplate } from './email';
import type { MessageJob, Mailbox, Lead, SQSMessage } from './types';

export interface WorkerConfig {
  supabase: SupabaseClient;
  queueClient: QueueClient;
}

export class SendWorker {
  private supabase: SupabaseClient;
  private queueClient: QueueClient;
  private running: boolean = false;

  constructor(config: WorkerConfig) {
    this.supabase = config.supabase;
    this.queueClient = config.queueClient;
  }

  /**
   * Start the worker (main loop)
   */
  async start(): Promise<void> {
    console.log('Send worker starting...');
    this.running = true;

    while (this.running) {
      try {
        // Poll queue for messages
        const messages = await this.queueClient.poll();

        if (messages.length > 0) {
          console.log(`Received ${messages.length} messages from queue`);

          // Process messages in parallel (with concurrency limit if needed)
          await Promise.all(
            messages.map(msg => this.processMessage(msg))
          );
        }
      } catch (error) {
        console.error('Error in worker main loop:', error);
        // Wait before retrying
        await this.sleep(5000);
      }
    }
  }

  /**
   * Stop the worker gracefully
   */
  stop(): void {
    console.log('Stopping send worker...');
    this.running = false;
  }

  /**
   * Process a single message from SQS
   */
  private async processMessage(sqsMessage: any): Promise<void> {
    let receiptHandle: string | undefined;

    try {
      // Parse message body
      const body: SQSMessage = JSON.parse(sqsMessage.Body);
      receiptHandle = sqsMessage.ReceiptHandle;

      const { message_job_id } = body;

      console.log(`Processing message job: ${message_job_id}`);

      // 1. Load message_job from database
      const messageJob = await this.loadMessageJob(message_job_id);

      if (!messageJob || messageJob.status !== 'pending') {
        console.log(`Message job ${message_job_id} not found or not pending, skipping`);
        // Delete message from queue
        if (receiptHandle) {
          await this.queueClient.deleteMessage(receiptHandle);
        }
        return;
      }

      // 2. TODO: Reserve job (atomic throttle check)
      // For now, we'll skip throttling and proceed
      // const reserved = await this.reserveMessageJob(messageJob);
      // if (!reserved) {
      //   // Throttle limit hit, message will become visible again after visibility timeout
      //   return;
      // }

      // 3. Load related data (lead, mailbox, node config)
      const { lead, mailbox, nodeConfig } = await this.loadJobData(messageJob);

      // 4. Generate email content from template
      const subject = mergeTemplate(nodeConfig.subject || '', lead);
      const body = mergeTemplate(nodeConfig.body || '', lead);

      // 5. Create SMTP transporter
      const transporter = createTransporter(mailbox);

      // 6. Send email
      const providerMessageId = await sendEmail(
        transporter,
        mailbox,
        messageJob,
        lead,
        subject,
        body
      );

      // 7. Update message_job status
      await this.supabase
        .from('message_jobs')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          provider_message_id: providerMessageId,
        })
        .eq('id', message_job_id);

      // 8. Create event record
      await this.supabase
        .from('events')
        .insert({
          campaign_id: messageJob.campaign_id,
          lead_id: messageJob.lead_id,
          enrollment_id: messageJob.enrollment_id,
          message_job_id: messageJob.id,
          event_type: 'sent',
          event_data: {
            provider_message_id: providerMessageId,
            sent_at: new Date().toISOString(),
          },
        });

      console.log(`Successfully sent email for message job ${message_job_id}`);

      // 9. Delete message from queue
      if (receiptHandle) {
        await this.queueClient.deleteMessage(receiptHandle);
      }

    } catch (error) {
      console.error('Error processing message:', error);
      // Message will become visible again after visibility timeout
      // TODO: Implement retry logic with exponential backoff
      // TODO: Move to DLQ after max retries
    }
  }

  /**
   * Load message job from database
   */
  private async loadMessageJob(messageJobId: string): Promise<MessageJob | null> {
    const { data, error } = await this.supabase
      .from('message_jobs')
      .select('*')
      .eq('id', messageJobId)
      .single();

    if (error) {
      console.error('Error loading message job:', error);
      return null;
    }

    return data as MessageJob;
  }

  /**
   * Load related data for message job (lead, mailbox, node config)
   */
  private async loadJobData(messageJob: MessageJob): Promise<{
    lead: Lead;
    mailbox: Mailbox;
    nodeConfig: any;
  }> {
    // Load lead
    const { data: lead, error: leadError } = await this.supabase
      .from('leads')
      .select('*')
      .eq('id', messageJob.lead_id)
      .single();

    if (leadError || !lead) {
      throw new Error(`Failed to load lead ${messageJob.lead_id}: ${leadError?.message}`);
    }

    // Load mailbox
    const { data: mailbox, error: mailboxError } = await this.supabase
      .from('mailboxes')
      .select('*')
      .eq('id', messageJob.mailbox_id)
      .single();

    if (mailboxError || !mailbox) {
      throw new Error(`Failed to load mailbox ${messageJob.mailbox_id}: ${mailboxError?.message}`);
    }

    // Get node config from message_data
    const nodeConfig = messageJob.message_data?.node_config || {};

    return {
      lead: lead as Lead,
      mailbox: mailbox as Mailbox,
      nodeConfig,
    };
  }

  /**
   * TODO: Implement atomic job reservation with throttle checking
   */
  private async reserveMessageJob(messageJob: MessageJob): Promise<boolean> {
    // This will call a Supabase function to atomically:
    // 1. Check throttle limits
    // 2. Reserve the job (update status to 'reserved')
    // 3. Update throttle counters
    // Returns true if reserved, false if throttle limit hit
    // 
    // For now, we'll skip this and implement it in Phase 4 (Pacing & Throttling)
    return true;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

### 2.6 Create Main Entry Point

**workers/send-worker/src/index.ts:**
```typescript
import { createSupabaseClient } from './supabase';
import { QueueClient } from './queue';
import { SendWorker } from './worker';

/**
 * Main entry point for send worker
 * 
 * Environment variables required:
 * - SUPABASE_URL: Supabase project URL
 * - SUPABASE_SERVICE_KEY: Service role key
 * - SEND_QUEUE_URL: SQS queue URL
 * - AWS_REGION: AWS region (defaults to us-west-2)
 */
async function main() {
  try {
    // Validate environment variables
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
    const sendQueueUrl = process.env.SEND_QUEUE_URL;
    const awsRegion = process.env.AWS_REGION || 'us-west-2';

    if (!supabaseUrl || !supabaseServiceKey || !sendQueueUrl) {
      throw new Error(
        'Missing required environment variables: SUPABASE_URL, SUPABASE_SERVICE_KEY, or SEND_QUEUE_URL'
      );
    }

    console.log('Initializing send worker...');
    console.log(`Queue URL: ${sendQueueUrl}`);
    console.log(`AWS Region: ${awsRegion}`);

    // Initialize clients
    const supabase = createSupabaseClient();
    const queueClient = new QueueClient({
      queueUrl: sendQueueUrl,
      region: awsRegion,
      maxMessages: 10,
      waitTimeSeconds: 20, // Long polling
    });

    // Create and start worker
    const worker = new SendWorker({
      supabase,
      queueClient,
    });

    // Handle graceful shutdown
    process.on('SIGTERM', () => {
      console.log('SIGTERM received, shutting down gracefully...');
      worker.stop();
      process.exit(0);
    });

    process.on('SIGINT', () => {
      console.log('SIGINT received, shutting down gracefully...');
      worker.stop();
      process.exit(0);
    });

    // Start worker (runs until stopped)
    await worker.start();

  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

main();
```

---

## Step 3: Create Dockerfile

**workers/send-worker/Dockerfile:**
```dockerfile
# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files for worker
COPY workers/send-worker/package*.json ./workers/send-worker/
WORKDIR /app/workers/send-worker

# Install dependencies
RUN npm ci

# Copy worker source code
COPY workers/send-worker/src ./src
COPY workers/send-worker/tsconfig.json ./

# Build TypeScript
RUN npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY workers/send-worker/package*.json ./
COPY workers/send-worker/dist ./dist

# Install production dependencies only
RUN npm ci --production && npm cache clean --force

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

USER nodejs

# Expose port (if needed for health checks)
# EXPOSE 3000

# Start worker
CMD ["node", "dist/index.js"]
```

**workers/send-worker/.dockerignore:**
```
node_modules
dist
*.log
.env
.env.local
.git
.gitignore
README.md
tsconfig.json
src
```

---

## Step 4: Create ECR Repository

### 4.1 Create Repository via AWS CLI

```bash
# Create ECR repository
aws ecr create-repository \
  --repository-name furnace/send-worker \
  --image-scanning-configuration scanOnPush=true \
  --region us-west-2

# Get repository URI
aws ecr describe-repositories \
  --repository-names furnace/send-worker \
  --region us-west-2 \
  --query 'repositories[0].repositoryUri' \
  --output text
```

### 4.2 Create Repository via CDK (Optional)

If you want Infrastructure as Code, you can add this to your Amplify backend:

```typescript
// amplify/backend.ts or separate CDK stack
import * as ecr from 'aws-cdk-lib/aws-ecr';

const sendWorkerRepo = new ecr.Repository(this, 'SendWorkerRepo', {
  repositoryName: 'furnace/send-worker',
  imageScanOnPush: true,
  lifecycleRules: [
    {
      maxImageCount: 10, // Keep last 10 images
    },
  ],
});
```

---

## Step 5: Build and Push Image

### 5.1 Build Script

**workers/send-worker/build.sh:**
```bash
#!/bin/bash

set -e

# Configuration
REGION="us-west-2"
REPO_NAME="furnace/send-worker"
IMAGE_TAG="${1:-latest}"

# Get AWS account ID
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

# ECR repository URI
ECR_URI="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${REPO_NAME}"

echo "Building Docker image..."
docker build \
  -f workers/send-worker/Dockerfile \
  -t ${REPO_NAME}:${IMAGE_TAG} \
  -t ${ECR_URI}:${IMAGE_TAG} \
  -t ${ECR_URI}:latest \
  .

echo "Logging in to ECR..."
aws ecr get-login-password --region ${REGION} | \
  docker login --username AWS --password-stdin ${ECR_URI}

echo "Pushing image to ECR..."
docker push ${ECR_URI}:${IMAGE_TAG}
docker push ${ECR_URI}:latest

echo "Image pushed successfully: ${ECR_URI}:${IMAGE_TAG}"
```

Make it executable:
```bash
chmod +x workers/send-worker/build.sh
```

### 5.2 Manual Build and Push

```bash
# 1. Get ECR login
aws ecr get-login-password --region us-west-2 | \
  docker login --username AWS --password-stdin <account-id>.dkr.ecr.us-west-2.amazonaws.com

# 2. Build image (from repo root)
docker build \
  -f workers/send-worker/Dockerfile \
  -t furnace/send-worker:latest \
  .

# 3. Tag image
docker tag furnace/send-worker:latest \
  <account-id>.dkr.ecr.us-west-2.amazonaws.com/furnace/send-worker:latest

# 4. Push image
docker push <account-id>.dkr.ecr.us-west-2.amazonaws.com/furnace/send-worker:latest
```

---

## Step 6: Testing Locally

### 6.1 Test TypeScript Build

```bash
cd workers/send-worker
npm install
npm run build
```

### 6.2 Test Docker Build Locally

```bash
# From repo root
docker build -f workers/send-worker/Dockerfile -t furnace/send-worker:test .

# Test run (will fail without env vars, but tests image build)
docker run --rm furnace/send-worker:test
```

### 6.3 Test Worker Locally (with env vars)

```bash
# Create .env file in workers/send-worker/
cd workers/send-worker
cat > .env << EOF
SUPABASE_URL=your-supabase-url
SUPABASE_SERVICE_KEY=your-service-key
SEND_QUEUE_URL=https://sqs.us-west-2.amazonaws.com/.../furnace-send-queue
AWS_REGION=us-west-2
EOF

# Run locally (requires Docker or local Node.js)
npm run dev
# or
npm run build && node dist/index.js
```

---

## Step 7: CI/CD Integration (Optional)

### 7.1 GitHub Actions Workflow

**.github/workflows/build-send-worker.yml:**
```yaml
name: Build and Push Send Worker

on:
  push:
    branches: [main]
    paths:
      - 'workers/send-worker/**'
      - '.github/workflows/build-send-worker.yml'
  workflow_dispatch:

env:
  AWS_REGION: us-west-2
  ECR_REPOSITORY: furnace/send-worker

jobs:
  build-and-push:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ${{ env.AWS_REGION }}

      - name: Login to Amazon ECR
        id: login-ecr
        uses: aws-actions/amazon-ecr-login@v2

      - name: Build, tag, and push image to Amazon ECR
        env:
          ECR_REGISTRY: ${{ steps.login-ecr.outputs.registry }}
          IMAGE_TAG: ${{ github.sha }}
        run: |
          docker build \
            -f workers/send-worker/Dockerfile \
            -t $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG \
            -t $ECR_REGISTRY/$ECR_REPOSITORY:latest \
            .
          docker push $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG
          docker push $ECR_REGISTRY/$ECR_REPOSITORY:latest
          echo "Image URI: $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG"
```

---

## Dependencies & Considerations

### Shared Types

**Option 1: Copy types** (simplest for now)
- Copy type definitions into worker code
- Keep them in sync manually

**Option 2: Shared package** (better for long-term)
- Create `packages/shared-types` package
- Publish to private npm registry or use local file references
- Install in worker via `file:../../packages/shared-types`

**Option 3: Generate from Supabase** (best for accuracy)
- Use Supabase CLI to generate TypeScript types
- Copy generated types to worker

For Phase 2.6, we'll use **Option 1** (copy types) for simplicity. We can refactor later.

### Environment Variables

Worker needs these environment variables (set in ECS task definition):
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY` (store in AWS Secrets Manager or ECS secrets)
- `SEND_QUEUE_URL`
- `AWS_REGION` (optional, defaults to us-west-2)

### Error Handling & Retries

**Current implementation**:
- Errors in message processing log and continue
- SQS visibility timeout handles retries (message becomes visible again)

**Future improvements** (Phase 4):
- Exponential backoff
- Dead letter queue handling
- Throttle checking before processing

---

## Testing Checklist

- [ ] Worker directory structure created
- [ ] `package.json` and `tsconfig.json` configured
- [ ] TypeScript compiles successfully (`npm run build`)
- [ ] Dockerfile builds successfully
- [ ] Docker image runs (even if it fails without env vars)
- [ ] ECR repository created
- [ ] Image pushes to ECR successfully
- [ ] Image can be pulled from ECR
- [ ] Worker runs locally with test env vars
- [ ] Worker connects to SQS queue
- [ ] Worker processes test messages (if test data exists)
- [ ] CI/CD workflow works (if implemented)

---

## Next Steps

After Phase 2.6 is complete:
1. **Phase 2.3**: ECS Cluster & Service setup (uses the Docker image from 2.6)
2. **Phase 3.2**: Send Worker implementation refinements (throttling, error handling)
3. **Phase 4**: Pacing & Throttling (atomic job reservation, throttle checks)

---

## Cost Considerations

- **ECR Storage**: ~$0.10 per GB/month
  - Image size: ~200-300 MB (Node.js Alpine)
  - Cost: ~$0.02-0.03/month per image
- **ECR Data Transfer**: Free within same region
- **CI/CD**: GitHub Actions minutes (free tier: 2000 minutes/month)

---

## Security Considerations

1. **Secrets Management**:
   - Store `SUPABASE_SERVICE_KEY` in AWS Secrets Manager
   - Reference secrets in ECS task definition
   - Never commit secrets to code

2. **Image Security**:
   - Enable image scanning on push (already configured)
   - Use minimal base image (Alpine Linux)
   - Run as non-root user (configured in Dockerfile)

3. **Network Security**:
   - ECS tasks need internet access for SMTP
   - Use NAT Gateway or VPC endpoints if in private subnets

4. **IAM Permissions**:
   - ECS task role needs: SQS (receive/delete), CloudWatch Logs
   - No direct AWS resource access needed beyond SQS

