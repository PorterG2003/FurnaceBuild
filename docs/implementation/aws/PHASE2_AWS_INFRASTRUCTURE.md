# Phase 2: AWS Infrastructure Setup - Detailed Implementation Plan

## Overview

Phase 2 sets up the AWS infrastructure components needed for the scalable email infrastructure:
- **SQS Queues** - Message queuing for send jobs
- **CloudWatch Scheduler + Lambda** - Periodic scheduler to evaluate flows
- **ECS Fargate Cluster & Services** - Scalable worker services
- **Docker Images & ECR** - Containerized worker applications
- **Inbox Checker (Scheduled Task)** - Periodic mailbox checking
- **API Gateway / Lambda (Optional)** - Tracking endpoints

---

## 2.1 SQS Queues

### Purpose
Decouple scheduling from execution, buffer spikes in send jobs.

### Requirements
- Single `send_queue` (Standard queue - order not critical, need throughput)
- Visibility timeout: 5 minutes
- Message retention: 14 days
- Dead Letter Queue (DLQ) with max receive count: 3
- Queue policies for ECS task roles

### Implementation Steps

#### Step 1: Create send_queue
```bash
# Using AWS CLI (or Terraform/CDK)
aws sqs create-queue \
  --queue-name furnace-send-queue \
  --attributes \
    VisibilityTimeout=300,\
    MessageRetentionPeriod=1209600
```

**Configuration Details:**
- **Queue Type**: Standard (FIFO not needed - order not critical)
- **Visibility Timeout**: 300 seconds (5 minutes) - time worker has to process before message becomes visible again
- **Message Retention**: 1209600 seconds (14 days)
- **Receive Message Wait Time**: 20 seconds (long polling - reduces empty responses)

#### Step 2: Create Dead Letter Queue
```bash
aws sqs create-queue \
  --queue-name furnace-send-queue-dlq \
  --attributes MessageRetentionPeriod=1209600
```

#### Step 3: Configure send_queue to use DLQ
```bash
# Get queue URLs
SEND_QUEUE_URL=$(aws sqs get-queue-url --queue-name furnace-send-queue --query 'QueueUrl' --output text)
DLQ_URL=$(aws sqs get-queue-url --queue-name furnace-send-queue-dlq --query 'QueueUrl' --output text)
DLQ_ARN=$(aws sqs get-queue-attributes --queue-url $DLQ_URL --attribute-names QueueArn --query 'Attributes.QueueArn' --output text)

# Set redrive policy
aws sqs set-queue-attributes \
  --queue-url $SEND_QUEUE_URL \
  --attributes "{
    \"RedrivePolicy\": \"{\\\"deadLetterTargetArn\\\":\\\"$DLQ_ARN\\\",\\\"maxReceiveCount\\\":3}\",
    \"ReceiveMessageWaitTimeSeconds\": \"20\"
  }"
```

#### Step 4: Create IAM Policy for Queue Access
Create IAM policy document:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "sqs:SendMessage",
        "sqs:ReceiveMessage",
        "sqs:DeleteMessage",
        "sqs:GetQueueAttributes",
        "sqs:GetQueueUrl"
      ],
      "Resource": [
        "arn:aws:sqs:*:*:furnace-send-queue",
        "arn:aws:sqs:*:*:furnace-send-queue-dlq"
      ]
    }
  ]
}
```

### Infrastructure as Code

**Option A: Using AWS CDK (Recommended if using TypeScript/Node.js)**
- Create CDK stack for SQS resources
- Version controlled, easier to manage

**Option B: Using Terraform**
- Create Terraform modules for SQS
- Good for multi-cloud or if already using Terraform

**Option C: Using AWS Console + Manual Setup**
- Quick for initial setup
- Less maintainable long-term

### Testing
- Test sending messages to queue
- Test receiving messages from queue
- Test DLQ behavior (send 4 messages, verify 4th goes to DLQ)

---

## 2.2 CloudWatch Scheduler + Lambda

### Purpose
Periodic scheduler tick (every 30-60 seconds) to evaluate flows and create message jobs.

### Requirements
- CloudWatch Event Rule (every 30-60 seconds)
- Lambda function to evaluate enrollments and create jobs
- IAM role with Supabase and SQS permissions
- Timeout: 5-15 minutes (depending on batch size)

### Implementation Steps

#### Step 1: Create Lambda Function

**Project Structure:**
```
amplify/functions/scheduler/
├── handler.ts
├── package.json
├── tsconfig.json
└── resource.ts
```

**handler.ts:**
```typescript
import { SupabaseClient, createClient } from '@supabase/supabase-js';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

interface SchedulerEvent {
  // CloudWatch event
}

interface Enrollment {
  id: string;
  campaign_id: string;
  lead_id: string;
  current_node_id: string;
  state: 'active' | 'paused' | 'stopped' | 'completed';
  next_run_at: string;
  flow_position: any;
}

export const handler = async (event: SchedulerEvent) => {
  // 1. Initialize clients
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
  );
  const sqs = new SQSClient({ region: process.env.AWS_REGION });
  const sendQueueUrl = process.env.SEND_QUEUE_URL!;

  // 2. Query enrollments ready to process
  const { data: enrollments, error } = await supabase
    .from('enrollments')
    .select('*')
    .eq('state', 'active')
    .lte('next_run_at', new Date().toISOString())
    .limit(100); // Process in batches

  if (error) {
    console.error('Error querying enrollments:', error);
    throw error;
  }

  // 3. For each enrollment, evaluate flow and create jobs
  for (const enrollment of enrollments || []) {
    try {
      await processEnrollment(enrollment, supabase, sqs, sendQueueUrl);
    } catch (error) {
      console.error(`Error processing enrollment ${enrollment.id}:`, error);
      // Continue with next enrollment
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      processed: enrollments?.length || 0,
      timestamp: new Date().toISOString()
    })
  };
};

async function processEnrollment(
  enrollment: Enrollment,
  supabase: SupabaseClient,
  sqs: SQSClient,
  sendQueueUrl: string
) {
  // 1. Load campaign and flow graph
  const { data: campaign } = await supabase
    .from('campaigns')
    .select('flow_data, schedule')
    .eq('id', enrollment.campaign_id)
    .single();

  if (!campaign) {
    throw new Error(`Campaign ${enrollment.campaign_id} not found`);
  }

  // 2. Evaluate flow - find next node(s)
  const nextNodes = evaluateFlow(enrollment, campaign.flow_data);
  
  // 3. For each next node:
  for (const node of nextNodes) {
    if (node.type === 'email') {
      // Create message_job
      const messageJob = await createMessageJob(enrollment, node, supabase, campaign.schedule);
      
      // Push to SQS
      await sqs.send(new SendMessageCommand({
        QueueUrl: sendQueueUrl,
        MessageBody: JSON.stringify({
          message_job_id: messageJob.id,
          enrollment_id: enrollment.id,
          campaign_id: enrollment.campaign_id
        })
      }));
      
      // Update message_job with SQS message ID
      // (Note: SendMessageCommand returns MessageId, use it)
      
    } else if (node.type === 'waitTime') {
      // Update enrollment.next_run_at
      const waitDuration = node.data.wait_duration_seconds || 0;
      await supabase
        .from('enrollments')
        .update({
          next_run_at: new Date(Date.now() + waitDuration * 1000).toISOString(),
          current_node_id: node.id
        })
        .eq('id', enrollment.id);
    }
    // Handle other node types (branch, conditional, etc.)
  }
}

async function createMessageJob(
  enrollment: Enrollment,
  node: any,
  supabase: SupabaseClient,
  schedule: any
) {
  // 1. Calculate scheduled_at (respects campaign schedule, jitter, etc.)
  const scheduledAt = calculateScheduledAt(enrollment, schedule);
  
  // 2. Load lead and campaign data for template
  const { data: lead } = await supabase
    .from('leads')
    .select('*')
    .eq('id', enrollment.lead_id)
    .single();
  
  // 3. Select mailbox (load balancing logic here)
  const { data: mailbox } = await selectMailbox(enrollment.campaign_id, supabase);
  
  // 4. Create message_job
  const { data: messageJob, error } = await supabase
    .from('message_jobs')
    .insert({
      enrollment_id: enrollment.id,
      campaign_id: enrollment.campaign_id,
      lead_id: enrollment.lead_id,
      mailbox_id: mailbox.id,
      node_id: node.id,
      status: 'pending',
      scheduled_at: scheduledAt,
      message_data: {
        // Template data will be filled by send worker
        node_config: node.data
      }
    })
    .select()
    .single();
  
  if (error) throw error;
  return messageJob;
}

function evaluateFlow(enrollment: Enrollment, flowData: any): any[] {
  // TODO: Implement flow traversal logic
  // - Load flow edges from flowData
  // - Find next node(s) from current_node_id
  // - Handle branching/conditionals
  // - Return array of next nodes to process
  return [];
}

function calculateScheduledAt(enrollment: Enrollment, schedule: any): string {
  // TODO: Implement scheduling logic
  // - Respect campaign schedule (timezone, hours, days)
  // - Apply jitter
  // - Handle business hours
  return new Date().toISOString();
}

async function selectMailbox(campaignId: string, supabase: SupabaseClient) {
  // TODO: Implement mailbox selection logic
  // - Load available mailboxes for campaign/account
  // - Load balancing / round-robin
  // - Consider mailbox throttles
  const { data: mailboxes } = await supabase
    .from('mailboxes')
    .select('*')
    .eq('smtp_status', 'active')
    .limit(1);
  
  return mailboxes?.[0];
}
```

**package.json:**
```json
{
  "name": "scheduler",
  "version": "1.0.0",
  "type": "module",
  "dependencies": {
    "@aws-sdk/client-sqs": "^3.0.0",
    "@supabase/supabase-js": "^2.77.0"
  },
  "devDependencies": {
    "@types/aws-lambda": "^8.10.0",
    "typescript": "^5.0.0"
  }
}
```

#### Step 2: Create Lambda Resource in Amplify

**resource.ts:**
```typescript
import { defineFunction } from '@aws-amplify/backend';

export const scheduler = defineFunction({
  name: 'scheduler',
  entry: './handler.ts',
  timeoutSeconds: 900, // 15 minutes
  memoryMB: 512,
  environment: {
    SUPABASE_URL: process.env.SUPABASE_URL!,
    SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY!,
    SEND_QUEUE_URL: process.env.SEND_QUEUE_URL!,
    AWS_REGION: process.env.AWS_REGION!
  }
});
```

Update `amplify/backend.ts`:
```typescript
import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { scheduler } from './functions/scheduler/resource';

defineBackend({
  auth,
  data,
  scheduler,
});
```

#### Step 3: Create CloudWatch Event Rule

**Using AWS CDK or Terraform:**

```typescript
// CDK example
import { Rule, Schedule } from 'aws-cdk-lib/aws-events';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';

const schedulerRule = new Rule(this, 'SchedulerRule', {
  schedule: Schedule.rate(Duration.seconds(30)), // Every 30 seconds
  description: 'Triggers scheduler Lambda every 30 seconds'
});

schedulerRule.addTarget(new LambdaFunction(schedulerFunction));
```

**Or using AWS CLI:**
```bash
# Create rule
aws events put-rule \
  --name furnace-scheduler-rule \
  --schedule-expression "rate(30 seconds)" \
  --description "Triggers scheduler every 30 seconds"

# Add Lambda as target
aws events put-targets \
  --rule furnace-scheduler-rule \
  --targets "Id=1,Arn=$LAMBDA_ARN"
```

#### Step 4: Configure IAM Permissions

Lambda execution role needs:
- SQS: `SendMessage`, `GetQueueUrl`, `GetQueueAttributes`
- CloudWatch Logs: `CreateLogGroup`, `CreateLogStream`, `PutLogEvents`
- Supabase: Access via service key (stored in environment variable)

**IAM Policy:**
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "sqs:SendMessage",
        "sqs:GetQueueUrl",
        "sqs:GetQueueAttributes"
      ],
      "Resource": "arn:aws:sqs:*:*:furnace-send-queue"
    },
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:*:*:*"
    }
  ]
}
```

### Testing
1. Test Lambda function locally with test event
2. Verify CloudWatch rule triggers Lambda
3. Verify enrollments are queried correctly
4. Verify message_jobs are created
5. Verify messages are pushed to SQS

---

## 2.3 ECS Fargate Cluster & Services

### Purpose
Scalable worker services for sending emails.

### Requirements
- ECS Cluster (Fargate)
- Send Workers service:
  - Auto-scaling based on queue depth
  - Desired count: Start with 2-5
  - Health checks
  - Logging to CloudWatch

### Implementation Steps

#### Step 1: Create ECS Cluster

**Using AWS CDK:**
```typescript
import { Cluster, FargateService, FargateTaskDefinition } from 'aws-cdk-lib/aws-ecs';
import { Vpc } from 'aws-cdk-lib/aws-ec2';

const cluster = new Cluster(this, 'FurnaceCluster', {
  clusterName: 'furnace-cluster',
  vpc: vpc, // Create or use existing VPC
});

const sendWorkerTaskDef = new FargateTaskDefinition(this, 'SendWorkerTask', {
  memoryLimitMiB: 1024,
  cpu: 512,
});

sendWorkerTaskDef.addContainer('send-worker', {
  image: ecs.ContainerImage.fromEcrRepository(ecrRepo, 'latest'),
  logging: ecs.LogDrivers.awsLogs({
    streamPrefix: 'send-worker',
  }),
  environment: {
    SUPABASE_URL: process.env.SUPABASE_URL!,
    SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY!,
    SEND_QUEUE_URL: process.env.SEND_QUEUE_URL!,
    AWS_REGION: process.env.AWS_REGION!,
  },
});
```

#### Step 2: Create Send Workers Service

**Configuration:**
- Task definition: send-worker (from Docker image)
- Desired count: 2-5 (start conservative)
- Launch type: FARGATE
- Network: VPC with internet access (for SMTP)
- Auto-scaling: Based on SQS queue depth

**Auto-scaling Configuration:**
```typescript
const sendWorkerService = new FargateService(this, 'SendWorkerService', {
  cluster,
  taskDefinition: sendWorkerTaskDef,
  desiredCount: 2,
  // Health check, etc.
});

// Auto-scaling based on queue depth
const scaling = sendWorkerService.autoScaleTaskCount({
  minCapacity: 1,
  maxCapacity: 20,
});

scaling.scaleOnMetric('QueueDepth', {
  metric: queue.metricApproximateNumberOfMessagesVisible(),
  scalingSteps: [
    { upper: 10, change: -1 },   // Scale down if < 10 messages
    { lower: 50, change: +1 },   // Scale up if > 50 messages
    { lower: 100, change: +2 },  // Scale up more if > 100 messages
  ],
});
```

#### Step 3: Configure IAM Task Role

ECS task role needs:
- SQS: `ReceiveMessage`, `DeleteMessage`, `GetQueueAttributes`, `GetQueueUrl`
- Supabase: Access via service key
- CloudWatch Logs: `CreateLogStream`, `PutLogEvents`
- Secrets Manager: Read SMTP credentials (if using)

**IAM Task Role Policy:**
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "sqs:ReceiveMessage",
        "sqs:DeleteMessage",
        "sqs:GetQueueAttributes",
        "sqs:GetQueueUrl"
      ],
      "Resource": "arn:aws:sqs:*:*:furnace-send-queue"
    },
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:*:*:*"
    }
  ]
}
```

### Testing
1. Deploy service with minimal desired count
2. Verify tasks start and connect to queue
3. Verify workers poll queue
4. Test auto-scaling by sending many messages
5. Monitor CloudWatch logs

---

## 2.4 Inbox Checker (Scheduled Task)

### Purpose
Periodically check mailboxes for replies/bounces via IMAP.

### Requirements
- CloudWatch Event Rule (every 5 minutes)
- Lambda function (or ECS Scheduled Task) to check mailboxes
- IAM role with Supabase and IMAP access
- Error handling and logging

### Implementation Steps

#### Step 1: Create Inbox Checker Lambda

**handler.ts:**
```typescript
import { SupabaseClient, createClient } from '@supabase/supabase-js';
import { ImapFlow } from 'imapflow';

export const handler = async (event: any) => {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
  );

  // Query all active mailboxes
  const { data: mailboxes, error } = await supabase
    .from('mailboxes')
    .select('*')
    .eq('sync_enabled', true)
    .eq('status', 'connected');

  if (error) {
    console.error('Error querying mailboxes:', error);
    throw error;
  }

  // Process each mailbox
  for (const mailbox of mailboxes || []) {
    try {
      await checkMailbox(mailbox, supabase);
    } catch (error) {
      console.error(`Error checking mailbox ${mailbox.id}:`, error);
      // Continue with next mailbox
    }
  }

  return {
    statusCode: 200,
    processed: mailboxes?.length || 0
  };
};

async function checkMailbox(mailbox: any, supabase: SupabaseClient) {
  // 1. Connect via IMAP
  const client = new ImapFlow({
    host: mailbox.imap_host,
    port: mailbox.imap_port,
    secure: mailbox.imap_use_ssl,
    auth: {
      user: mailbox.imap_username,
      pass: mailbox.imap_password, // Decrypt if encrypted
    },
  });

  await client.connect();

  // 2. Query for new messages since last_synced_at
  const lastSynced = mailbox.last_synced_at 
    ? new Date(mailbox.last_synced_at)
    : new Date(Date.now() - 24 * 60 * 60 * 1000); // Default: last 24 hours

  const lock = await client.getMailboxLock('INBOX');
  try {
    const messages = await client.search({
      since: lastSynced,
    });

    // 3. Process each message
    for (const msg of messages) {
      await processMessage(msg, mailbox, supabase, client);
    }

    // 4. Update last_synced_at
    await supabase
      .from('mailboxes')
      .update({ last_synced_at: new Date().toISOString() })
      .eq('id', mailbox.id);
  } finally {
    lock.release();
  }

  await client.logout();
}

async function processMessage(
  msg: any,
  mailbox: any,
  supabase: SupabaseClient,
  client: ImapFlow
) {
  // Fetch message headers
  const message = await client.fetchOne(msg.seq, {
    envelope: true,
    bodyStructure: true,
  });

  // Check if reply
  if (message.envelope.inReplyTo) {
    await handleReply(message.envelope.inReplyTo, mailbox, supabase);
  }

  // Check if bounce (subject/from patterns)
  if (isBounce(message.envelope)) {
    await handleBounce(message, mailbox, supabase);
  }
}

async function handleReply(inReplyTo: string, mailbox: any, supabase: SupabaseClient) {
  // Find message_job by provider_message_id
  const { data: messageJob } = await supabase
    .from('message_jobs')
    .select('*, enrollment_id')
    .eq('provider_message_id', inReplyTo)
    .single();

  if (messageJob) {
    // Update enrollment state
    await supabase
      .from('enrollments')
      .update({ state: 'stopped' })
      .eq('id', messageJob.enrollment_id);

    // Create event
    await supabase
      .from('events')
      .insert({
        campaign_id: messageJob.campaign_id,
        lead_id: messageJob.lead_id,
        enrollment_id: messageJob.enrollment_id,
        message_job_id: messageJob.id,
        event_type: 'replied',
        event_data: { in_reply_to: inReplyTo }
      });
  }
}
```

#### Step 2: Create CloudWatch Event Rule

```bash
aws events put-rule \
  --name furnace-inbox-checker-rule \
  --schedule-expression "rate(5 minutes)" \
  --description "Check mailboxes for replies every 5 minutes"
```

#### Step 3: Package Dependencies

**package.json:**
```json
{
  "dependencies": {
    "@supabase/supabase-js": "^2.77.0",
    "imapflow": "^2.0.0"
  }
}
```

### Testing
1. Test Lambda with test mailbox
2. Verify IMAP connection works
3. Verify reply detection
4. Verify enrollment state updates
5. Test with multiple mailboxes

---

## 2.5 API Gateway / Lambda Functions (Optional)

### Purpose
Tracking endpoints for opens/clicks.

### Requirements
- `/o/:message_job_id.png` - Open pixel endpoint
- `/c/:link_id` - Click redirect endpoint
- Lambda@Edge or API Gateway + Lambda
- Write to events table

### Implementation Steps

#### Step 1: Create Tracking Lambda

**handler.ts:**
```typescript
export const handler = async (event: any) => {
  const path = event.path;
  
  if (path.startsWith('/o/')) {
    // Open tracking
    const messageJobId = path.split('/o/')[1].replace('.png', '');
    await trackOpen(messageJobId);
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      },
      body: getTransparentPixel(), // 1x1 transparent PNG
      isBase64Encoded: true
    };
  } else if (path.startsWith('/c/')) {
    // Click tracking
    const linkId = path.split('/c/')[1];
    const redirectUrl = await trackClick(linkId);
    return {
      statusCode: 302,
      headers: {
        'Location': redirectUrl
      }
    };
  }
  
  return { statusCode: 404 };
};

async function trackOpen(messageJobId: string) {
  // Query message_job to get enrollment_id, campaign_id, etc.
  // Insert event into events table
}

async function trackClick(linkId: string): Promise<string> {
  // Query link mapping to get original URL
  // Insert event into events table
  // Return original URL for redirect
}
```

#### Step 2: Deploy to API Gateway or CloudFront

**Option A: API Gateway**
- Create REST API
- Create resource `/o/{messageJobId}.png`
- Create resource `/c/{linkId}`
- Deploy to stage

**Option B: CloudFront + Lambda@Edge**
- More performant (edge locations)
- Better for global traffic
- More complex setup

### Testing
1. Test open pixel endpoint
2. Test click redirect endpoint
3. Verify events are created
4. Test with actual email opens/clicks

---

## 2.6 Docker Images & ECR

### Purpose
Containerized send worker application.

### Requirements
- Dockerfile for send worker
- ECR repository
- CI/CD pipeline to build and push images

### Implementation Steps

#### Step 1: Create Dockerfile

**Dockerfile:**
```dockerfile
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm ci --production

# Copy application code
COPY . .

# Build TypeScript (if needed)
RUN npm run build

# Run worker
CMD ["node", "dist/index.js"]
```

**index.ts (Send Worker):**
```typescript
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
import { SupabaseClient, createClient } from '@supabase/supabase-js';
import * as nodemailer from 'nodemailer';

const sqs = new SQSClient({ region: process.env.AWS_REGION });
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const sendQueueUrl = process.env.SEND_QUEUE_URL!;

async function main() {
  console.log('Send worker starting...');
  
  while (true) {
    try {
      // Poll queue (long polling, 20 second wait)
      const result = await sqs.send(new ReceiveMessageCommand({
        QueueUrl: sendQueueUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 20, // Long polling
      }));

      if (result.Messages && result.Messages.length > 0) {
        // Process messages
        await Promise.all(
          result.Messages.map(msg => processMessage(msg, sendQueueUrl))
        );
      }
    } catch (error) {
      console.error('Error polling queue:', error);
      await sleep(5000); // Wait before retrying
    }
  }
}

async function processMessage(msg: any, queueUrl: string) {
  try {
    const body = JSON.parse(msg.Body);
    const { message_job_id } = body;

    // 1. Load message_job from database
    const { data: messageJob } = await supabase
      .from('message_jobs')
      .select('*, lead:leads(*), campaign:campaigns(*), mailbox:mailboxes(*), node:nodes(*)')
      .eq('id', message_job_id)
      .single();

    if (!messageJob || messageJob.status !== 'pending') {
      // Already processed or cancelled
      await deleteMessage(queueUrl, msg.ReceiptHandle!);
      return;
    }

    // 2. Reserve job (atomic throttle check)
    const reserved = await reserveMessageJob(messageJob);
    if (!reserved) {
      // Throttle limit hit, reschedule
      await deleteMessage(queueUrl, msg.ReceiptHandle!);
      return;
    }

    // 3. Generate and send email
    await sendEmail(messageJob);

    // 4. Update message_job
    await supabase
      .from('message_jobs')
      .update({
        status: 'sent',
        sent_at: new Date().toISOString()
      })
      .eq('id', message_job_id);

    // 5. Create event
    await supabase
      .from('events')
      .insert({
        campaign_id: messageJob.campaign_id,
        lead_id: messageJob.lead_id,
        enrollment_id: messageJob.enrollment_id,
        message_job_id: messageJob.id,
        event_type: 'sent'
      });

    // 6. Delete message from queue
    await deleteMessage(queueUrl, msg.ReceiptHandle!);

  } catch (error) {
    console.error('Error processing message:', error);
    // Message will become visible again after visibility timeout
  }
}

async function reserveMessageJob(messageJob: any): Promise<boolean> {
  // Call Supabase function to atomically reserve job
  // Returns true if reserved, false if throttle limit hit
  const { data, error } = await supabase.rpc('reserve_message_job', {
    p_message_job_id: messageJob.id,
    p_mailbox_id: messageJob.mailbox_id
  });
  
  return data === true;
}

async function sendEmail(messageJob: any) {
  // 1. Create SMTP transporter
  const transporter = nodemailer.createTransport({
    host: messageJob.mailbox.smtp_host,
    port: messageJob.mailbox.smtp_port,
    secure: messageJob.mailbox.smtp_use_ssl,
    auth: {
      user: messageJob.mailbox.smtp_username,
      pass: messageJob.mailbox.smtp_password, // Decrypt if needed
    },
  });

  // 2. Generate message content
  const subject = mergeTemplate(messageJob.message_data.subject, messageJob.lead);
  const text = mergeTemplate(messageJob.message_data.body, messageJob.lead);

  // 3. Send email
  const info = await transporter.sendMail({
    from: `"${messageJob.mailbox.display_name}" <${messageJob.mailbox.email_address}>`,
    to: messageJob.lead.email,
    subject,
    text,
    messageId: generateMessageId(), // For reply detection
  });

  // 4. Update message_job with provider_message_id
  await supabase
    .from('message_jobs')
    .update({
      provider_message_id: info.messageId
    })
    .eq('id', messageJob.id);
}

function mergeTemplate(template: string, lead: any): string {
  // Simple template merging (replace {{field}} with lead data)
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return lead[key] || match;
  });
}

function generateMessageId(): string {
  return `<${Date.now()}.${Math.random().toString(36)}@furnace.build>`;
}

async function deleteMessage(queueUrl: string, receiptHandle: string) {
  await sqs.send(new DeleteMessageCommand({
    QueueUrl: queueUrl,
    ReceiptHandle: receiptHandle,
  }));
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(console.error);
```

#### Step 2: Create ECR Repository

```bash
aws ecr create-repository \
  --repository-name furnace/send-worker \
  --image-scanning-configuration scanOnPush=true
```

#### Step 3: Build and Push Image

```bash
# Get ECR login
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <account-id>.dkr.ecr.us-east-1.amazonaws.com

# Build image
docker build -t furnace/send-worker .

# Tag image
docker tag furnace/send-worker:latest <account-id>.dkr.ecr.us-east-1.amazonaws.com/furnace/send-worker:latest

# Push image
docker push <account-id>.dkr.ecr.us-east-1.amazonaws.com/furnace/send-worker:latest
```

#### Step 4: Set Up CI/CD (GitHub Actions Example)

**.github/workflows/build-worker.yml:**
```yaml
name: Build and Push Send Worker

on:
  push:
    branches: [main]
    paths:
      - 'workers/send-worker/**'

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v2
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: us-east-1
      
      - name: Login to Amazon ECR
        id: login-ecr
        uses: aws-actions/amazon-ecr-login@v1
      
      - name: Build and push
        env:
          ECR_REGISTRY: ${{ steps.login-ecr.outputs.registry }}
          ECR_REPOSITORY: furnace/send-worker
          IMAGE_TAG: ${{ github.sha }}
        run: |
          docker build -t $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG ./workers/send-worker
          docker push $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG
          docker tag $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG $ECR_REGISTRY/$ECR_REPOSITORY:latest
          docker push $ECR_REGISTRY/$ECR_REPOSITORY:latest
```

### Testing
1. Build Docker image locally
2. Test container runs and connects to queue
3. Test sending email from container
4. Push to ECR
5. Update ECS service to use new image
6. Verify service pulls new image and runs

---

## Implementation Order

**Dependencies:**
- **SQS Queue** (2.1) ← Needed by: Scheduler (2.2) and ECS Workers (2.3)
- **Docker Image** (2.6) ← Needed by: ECS Service (2.3)
- **ECS Service** (2.3) ← Needs: SQS Queue (2.1) and Docker Image (2.6)
- **Scheduler Lambda** (2.2) ← Needs: SQS Queue (2.1)
- **Inbox Checker** (2.4) ← Independent (no dependencies)
- **Tracking Endpoints** (2.5) ← Independent, optional

**Recommended Order:**

1. **2.1 SQS Queues** - Foundation, needed by scheduler and workers
   - Must be done first

2. **2.2 Scheduler Lambda** - Creates jobs, pushes to queue
   - Only depends on SQS (can be done early)
   - Jobs will queue until workers are ready (this is fine)

3. **2.6 Docker Images** - Build worker image
   - Can be done in parallel with 2.2 (no dependencies)
   - Takes time to build/push, good to start early

4. **2.3 ECS Cluster & Service** - Deploy workers
   - Needs both SQS (2.1) and Docker Image (2.6)
   - Can now process jobs from scheduler

5. **2.4 Inbox Checker** - Independent, can be done anytime

6. **2.5 Tracking Endpoints** - Optional, can be done later

**Alternative Order (if you want workers ready before scheduler starts):**
1. SQS (2.1)
2. Docker Images (2.6) - Start building early
3. ECS (2.3) - Deploy workers (ready to process)
4. Scheduler (2.2) - Start creating jobs (workers already running)
5. Inbox Checker (2.4)
6. Tracking (2.5)

---

## Testing Checklist

### SQS
- [ ] Queue created successfully
- [ ] DLQ configured correctly
- [ ] Can send messages
- [ ] Can receive messages
- [ ] DLQ receives failed messages after max retries

### Scheduler Lambda
- [ ] Lambda function deployed
- [ ] CloudWatch rule triggers Lambda
- [ ] Queries enrollments correctly
- [ ] Creates message_jobs
- [ ] Pushes to SQS queue
- [ ] Handles errors gracefully

### ECS Send Workers
- [ ] Cluster created
- [ ] Service deployed
- [ ] Tasks start successfully
- [ ] Workers poll queue
- [ ] Workers process messages
- [ ] Auto-scaling works
- [ ] Logs appear in CloudWatch

### Inbox Checker
- [ ] Lambda function deployed
- [ ] CloudWatch rule triggers
- [ ] Connects to IMAP
- [ ] Detects replies
- [ ] Updates enrollments
- [ ] Creates events

### Docker Images
- [ ] Dockerfile builds successfully
- [ ] Image runs locally
- [ ] Image pushes to ECR
- [ ] ECS service uses image

---

## Cost Considerations

- **SQS**: ~$0.40 per million requests (very cheap)
- **Lambda**: Pay per invocation + compute time (scheduler: ~$5-10/month)
- **ECS Fargate**: Pay per task hour (~$0.04/vCPU/hour, ~$0.004/GB/hour)
  - Example: 2 tasks, 1 vCPU, 2GB = ~$60/month
- **CloudWatch Logs**: ~$0.50 per GB ingested
- **ECR**: ~$0.10 per GB/month stored

**Estimated Monthly Cost** (conservative):
- SQS: < $5
- Lambda: ~$10
- ECS (2-5 tasks): ~$60-150
- Logs: ~$10
- **Total**: ~$85-175/month (scales with usage)

---

## Security Considerations

1. **Secrets Management**:
   - Store Supabase service key in AWS Secrets Manager or environment variables
   - Store SMTP passwords encrypted (Supabase Vault or Secrets Manager)
   - Never commit secrets to code

2. **IAM Roles**:
   - Use least privilege principle
   - Separate roles for Lambda vs ECS tasks
   - No broad permissions

3. **Network Security**:
   - ECS tasks in private subnets if possible
   - NAT Gateway for outbound internet (for SMTP)
   - Security groups restrict traffic

4. **Encryption**:
   - Encrypt SQS queues at rest
   - Encrypt ECS task storage
   - Use TLS for SMTP/IMAP

---

## Monitoring Setup

### CloudWatch Metrics to Track

1. **SQS**:
   - `ApproximateNumberOfMessagesVisible` (queue depth)
   - `ApproximateNumberOfMessagesNotVisible` (in-flight)
   - `NumberOfMessagesSent`
   - `NumberOfMessagesReceived`

2. **Lambda**:
   - `Invocations`
   - `Duration`
   - `Errors`
   - `Throttles`

3. **ECS**:
   - `CPUUtilization`
   - `MemoryUtilization`
   - `RunningTaskCount`

4. **Custom Metrics**:
   - `MessageJobsCreated` (from scheduler)
   - `MessageJobsSent` (from workers)
   - `MessageJobsFailed` (from workers)
   - `ThrottleHits` (from workers)

### Alarms to Set

- Queue depth > 1000 (scale up workers)
- Lambda errors > 10 in 5 minutes
- ECS task failures > 5 in 5 minutes
- Worker CPU > 80% consistently

---

## Next Steps After Phase 2

Once Phase 2 infrastructure is deployed:
1. Test end-to-end flow: enrollment → scheduler → queue → worker → email sent
2. Monitor metrics and adjust scaling
3. Move to Phase 3: Core Application Logic (flow evaluation, send worker implementation)

