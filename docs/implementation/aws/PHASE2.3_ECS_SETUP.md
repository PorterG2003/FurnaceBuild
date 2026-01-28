# Phase 2.3: ECS Fargate Cluster & Service - Detailed Implementation Plan

## Overview

This phase sets up the ECS Fargate infrastructure to run the send worker containers. The workers will:
- Pull messages from SQS queue
- Process email jobs
- Send emails via SMTP
- Scale automatically based on queue depth

**Prerequisites:**
- ✅ Phase 2.1: SQS Queue created
- ✅ Phase 2.6: Docker image pushed to ECR
- Queue URL: `https://sqs.us-west-2.amazonaws.com/686255981838/furnace-send-queue`
- ECR Repository: `686255981838.dkr.ecr.us-west-2.amazonaws.com/furnace/send-worker`

---

## Architecture

```
┌─────────────────┐
│  SQS Queue      │
│  (send_queue)   │
└────────┬────────┘
         │
         │ Messages
         ▼
┌─────────────────┐
│  ECS Service    │
│  (Send Workers) │
│  ┌───────────┐  │
│  │ Task 1    │  │ Polls queue, sends emails
│  └───────────┘  │
│  ┌───────────┐  │
│  │ Task 2    │  │ (Auto-scales based on queue depth)
│  └───────────┘  │
└─────────────────┘
         │
         │ SMTP
         ▼
┌─────────────────┐
│  Gmail SMTP     │
└─────────────────┘
```

---

## Step 1: Create ECS Cluster

### Option A: Via CDK in Amplify (Recommended)

Add to `amplify/backend.ts`:

```typescript
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as logs from 'aws-cdk-lib/aws-logs';

// Create VPC (or use existing/default)
const vpc = new ec2.Vpc(backend.stack, 'FurnaceVpc', {
  maxAzs: 2, // Use 2 availability zones for high availability
  natGateways: 1, // NAT gateway for outbound internet (needed for SMTP)
});

// Create ECS Cluster
const cluster = new ecs.Cluster(backend.stack, 'FurnaceCluster', {
  clusterName: 'furnace-cluster',
  vpc: vpc,
  containerInsights: true, // Enable CloudWatch Container Insights
});
```

### Option B: Via AWS Console (Quick Start)

1. Go to AWS Console → ECS → Clusters
2. Click "Create Cluster"
3. **Cluster configuration:**
   - Cluster name: `furnace-cluster`
   - Infrastructure: AWS Fargate (Serverless)
   - Enable CloudWatch Container Insights: Yes
4. Click "Create"

### Option C: Via AWS CLI

```bash
aws ecs create-cluster \
  --cluster-name furnace-cluster \
  --region us-west-2 \
  --settings name=containerInsights,value=enabled
```

**Note:** For CLI/Console options, you'll also need to create a VPC with internet access for SMTP connectivity.

---

## Step 2: Create ECS Task Definition

### Option A: Via CDK in Amplify (Recommended)

Add to `amplify/backend.ts`:

```typescript
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';

// Get ECR repository (already created in Phase 2.6)
const sendWorkerRepo = ecr.Repository.fromRepositoryName(
  backend.stack,
  'SendWorkerRepoRef',
  'furnace/send-worker'
);

// Create CloudWatch Log Group
const logGroup = new logs.LogGroup(backend.stack, 'SendWorkerLogGroup', {
  logGroupName: '/ecs/furnace/send-worker',
  retention: logs.RetentionDays.ONE_WEEK,
  removalPolicy: cdk.RemovalPolicy.DESTROY,
});

// Create IAM task role
const taskRole = new iam.Role(backend.stack, 'SendWorkerTaskRole', {
  assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
  description: 'Role for ECS send worker tasks',
});

// Grant SQS permissions
taskRole.addToPolicy(new iam.PolicyStatement({
  sid: 'AllowSQSAccess',
  actions: [
    'sqs:ReceiveMessage',
    'sqs:DeleteMessage',
    'sqs:GetQueueAttributes',
    'sqs:GetQueueUrl',
  ],
  resources: ['arn:aws:sqs:us-west-2:686255981838:furnace-send-queue'],
}));

// Grant CloudWatch Logs permissions
taskRole.addToPolicy(new iam.PolicyStatement({
  sid: 'AllowCloudWatchLogs',
  actions: [
    'logs:CreateLogStream',
    'logs:PutLogEvents',
  ],
  resources: [logGroup.logGroupArn + ':*'],
}));

// Create task execution role (for pulling images, writing logs)
const taskExecutionRole = new iam.Role(backend.stack, 'SendWorkerTaskExecutionRole', {
  assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
  managedPolicies: [
    iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
  ],
});

// Grant ECR pull permissions
taskExecutionRole.addToPolicy(new iam.PolicyStatement({
  sid: 'AllowECRPull',
  actions: [
    'ecr:GetAuthorizationToken',
    'ecr:BatchCheckLayerAvailability',
    'ecr:GetDownloadUrlForLayer',
    'ecr:BatchGetImage',
  ],
  resources: ['*'],
}));

// Create task definition
const taskDefinition = new ecs.FargateTaskDefinition(backend.stack, 'SendWorkerTaskDef', {
  memoryLimitMiB: 1024, // 1 GB
  cpu: 512, // 0.5 vCPU
  taskRole: taskRole,
  executionRole: taskExecutionRole,
});

// Add container
const container = taskDefinition.addContainer('send-worker', {
  image: ecs.ContainerImage.fromEcrRepository(sendWorkerRepo, 'latest'),
  logging: ecs.LogDrivers.awsLogs({
    streamPrefix: 'send-worker',
    logGroup: logGroup,
  }),
  environment: {
    // These will be set from secrets or environment variables
    AWS_REGION: 'us-west-2',
  },
  secrets: {
    // Use AWS Secrets Manager or Systems Manager Parameter Store
    SUPABASE_URL: ecs.Secret.fromSecretsManager(/* secret */),
    SUPABASE_SERVICE_KEY: ecs.Secret.fromSecretsManager(/* secret */),
    SEND_QUEUE_URL: ecs.Secret.fromSecretsManager(/* secret */),
  },
});
```

**Note:** For secrets, you have two options:
1. **AWS Secrets Manager** (recommended for production)
2. **Environment variables** (simpler for development, but less secure)

### Option B: Via AWS Console

1. Go to ECS → Task Definitions → Create new Task Definition
2. **Task definition family:** `furnace-send-worker`
3. **Launch type:** Fargate
4. **Task size:**
   - CPU: 0.5 vCPU (512)
   - Memory: 1 GB (1024)
5. **Container:**
   - Container name: `send-worker`
   - Image URI: `686255981838.dkr.ecr.us-west-2.amazonaws.com/furnace/send-worker:latest`
   - Environment variables:
     - `SUPABASE_URL`
     - `SUPABASE_SERVICE_KEY`
     - `SEND_QUEUE_URL`
     - `AWS_REGION=us-west-2`
6. **Logging:** CloudWatch Logs
   - Log group: `/ecs/furnace/send-worker`
7. **Task role:** Create new role with SQS permissions (see IAM section below)
8. **Task execution role:** Use default or create with ECR pull permissions

---

## Step 3: Create IAM Roles

### Task Role (for application permissions)

**Permissions needed:**
- SQS: `ReceiveMessage`, `DeleteMessage`, `GetQueueAttributes`, `GetQueueUrl`
- CloudWatch Logs: `CreateLogStream`, `PutLogEvents`

**IAM Policy:**
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowSQSAccess",
      "Effect": "Allow",
      "Action": [
        "sqs:ReceiveMessage",
        "sqs:DeleteMessage",
        "sqs:GetQueueAttributes",
        "sqs:GetQueueUrl"
      ],
      "Resource": "arn:aws:sqs:us-west-2:686255981838:furnace-send-queue"
    },
    {
      "Sid": "AllowCloudWatchLogs",
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:us-west-2:686255981838:log-group:/ecs/furnace/send-worker:*"
    }
  ]
}
```

### Task Execution Role (for ECS service permissions)

**Permissions needed:**
- ECR: Pull images
- CloudWatch Logs: Create log streams
- (Managed policy: `AmazonECSTaskExecutionRolePolicy`)

**Additional policy for ECR:**
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ecr:GetAuthorizationToken",
        "ecr:BatchCheckLayerAvailability",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage"
      ],
      "Resource": "*"
    }
  ]
}
```

---

## Step 4: Create ECS Service

### Option A: Via CDK in Amplify (Recommended)

Add to `amplify/backend.ts`:

```typescript
// Get SQS queue (reference existing queue)
const sendQueue = sqs.Queue.fromQueueArn(
  backend.stack,
  'SendQueueRef',
  'arn:aws:sqs:us-west-2:686255981838:furnace-send-queue'
);

// Create ECS Service
const service = new ecs.FargateService(backend.stack, 'SendWorkerService', {
  cluster: cluster,
  taskDefinition: taskDefinition,
  desiredCount: 2, // Start with 2 tasks
  assignPublicIp: true, // Needed for SMTP (or use NAT Gateway)
  vpcSubnets: {
    subnetType: ec2.SubnetType.PUBLIC, // Or PRIVATE with NAT Gateway
  },
  enableLogging: true,
  healthCheckGracePeriod: cdk.Duration.seconds(60),
});

// Auto-scaling based on SQS queue depth
const scaling = service.autoScaleTaskCount({
  minCapacity: 1,
  maxCapacity: 20,
});

// Scale based on approximate number of messages in queue
scaling.scaleOnMetric('QueueDepth', {
  metric: sendQueue.metricApproximateNumberOfMessagesVisible(),
  scalingSteps: [
    { upper: 10, change: -1 },   // Scale down if < 10 messages
    { lower: 50, change: +1 },   // Scale up if > 50 messages
    { lower: 100, change: +2 },  // Scale up more if > 100 messages
    { lower: 500, change: +5 },  // Scale up aggressively if > 500 messages
  ],
  adjustmentType: autoscaling.AdjustmentType.CHANGE_IN_CAPACITY,
});
```

### Option B: Via AWS Console

1. Go to ECS → Clusters → `furnace-cluster` → Services → Create
2. **Service configuration:**
   - Launch type: Fargate
   - Task definition: `furnace-send-worker` (latest revision)
   - Service name: `send-worker-service`
   - Number of tasks: 2
3. **Networking:**
   - VPC: Select or create VPC with internet access
   - Subnets: Public subnets (or private with NAT Gateway)
   - Security group: Allow outbound HTTPS (for SMTP)
   - Auto-assign public IP: Enabled (if using public subnets)
4. **Load balancing:** None (workers don't need load balancer)
5. **Auto Scaling:**
   - Enable auto scaling: Yes
   - Min capacity: 1
   - Max capacity: 20
   - Target metric: SQS queue depth
   - Scale up when: Queue depth > 50
   - Scale down when: Queue depth < 10

---

## Step 5: Configure Secrets/Environment Variables

### Option A: AWS Secrets Manager (Recommended for Production)

1. Create secrets in AWS Secrets Manager:
   ```bash
   aws secretsmanager create-secret \
     --name furnace/send-worker/supabase-url \
     --secret-string "your-supabase-url" \
     --region us-west-2
   
   aws secretsmanager create-secret \
     --name furnace/send-worker/supabase-service-key \
     --secret-string "your-service-key" \
     --region us-west-2
   
   aws secretsmanager create-secret \
     --name furnace/send-worker/send-queue-url \
     --secret-string "https://sqs.us-west-2.amazonaws.com/686255981838/furnace-send-queue" \
     --region us-west-2
   ```

2. Reference in task definition (CDK):
   ```typescript
   secrets: {
     SUPABASE_URL: ecs.Secret.fromSecretsManager(
       secretsmanager.Secret.fromSecretNameV2(
         backend.stack,
         'SupabaseUrlSecret',
         'furnace/send-worker/supabase-url'
       )
     ),
     // ... similar for other secrets
   }
   ```

### Option B: Environment Variables (Simpler for Development)

Set directly in task definition:
```typescript
environment: {
  SUPABASE_URL: 'your-supabase-url',
  SUPABASE_SERVICE_KEY: 'your-service-key',
  SEND_QUEUE_URL: 'https://sqs.us-west-2.amazonaws.com/686255981838/furnace-send-queue',
  AWS_REGION: 'us-west-2',
}
```

**⚠️ Security Note:** For production, use Secrets Manager. Environment variables are visible in ECS console and CloudWatch logs.

---

## Step 6: Network Configuration

### VPC Requirements

Workers need **outbound internet access** for:
- SMTP connections (Gmail SMTP servers)
- Supabase API calls
- CloudWatch Logs

**Options:**

1. **Public Subnets** (Simpler)
   - Tasks get public IPs
   - Direct internet access
   - No NAT Gateway needed (cost savings)

2. **Private Subnets + NAT Gateway** (More Secure)
   - Tasks in private subnets
   - NAT Gateway for outbound internet
   - More secure (no public IPs)
   - Additional cost (~$32/month for NAT Gateway)

**For initial setup, public subnets are simpler and cheaper.**

### Security Group

Allow outbound HTTPS (port 443) for:
- SMTP (TLS)
- Supabase API
- CloudWatch Logs

**Default security group allows all outbound traffic** (which is fine for this use case).

---

## Step 7: Auto-Scaling Configuration

### Scaling Based on SQS Queue Depth

The ECS service automatically scales the number of tasks based on the **approximate number of visible messages** in the SQS queue. This metric is measured by CloudWatch and evaluated every minute.

#### What Causes Scaling

**Scale Up Triggers:**
- **Queue depth ≥ 50 messages**: Add 1 task
- **Queue depth ≥ 100 messages**: Add 2 tasks  
- **Queue depth ≥ 500 messages**: Add 5 tasks

**Scale Down Triggers:**
- **Queue depth < 10 messages**: Remove 1 task

#### Scaling Behavior Details

1. **Metric**: `ApproximateNumberOfMessagesVisible` from the SQS queue
   - This counts messages that are visible and available for processing
   - Messages currently being processed (within visibility timeout) are not counted
   - Updated in near real-time by SQS

2. **Evaluation Frequency**: CloudWatch evaluates the metric every 60 seconds

3. **Scaling Steps** (applied in order, highest threshold wins):
   ```
   Queue Depth < 10  → Remove 1 task (scale down)
   Queue Depth ≥ 50  → Add 1 task (scale up)
   Queue Depth ≥ 100 → Add 2 tasks (scale up more)
   Queue Depth ≥ 500 → Add 5 tasks (scale up aggressively)
   ```

4. **Capacity Limits:**
   - **Minimum**: 1 task (always keep at least one worker running)
   - **Maximum**: 20 tasks (prevents runaway scaling)
   - **Initial**: 2 tasks (default desired count)

5. **Cooldown Periods**:
   - **Scale Up Cooldown**: 60 seconds (prevents rapid scaling up)
   - **Scale Down Cooldown**: 300 seconds (5 minutes - prevents rapid scale-down, allows queue to stabilize)

#### Example Scaling Scenarios

**Scenario 1: Gradual Load Increase**
- Queue starts at 5 messages → 1 task running
- Scheduler adds 60 messages → Queue depth = 60
- After 60s: CloudWatch detects ≥ 50 → Scale to 2 tasks
- Workers process messages → Queue depth decreases
- When queue < 10: After 5 min cooldown → Scale back to 1 task

**Scenario 2: Sudden Spike**
- Queue starts at 5 messages → 1 task running
- Scale test creates 500 messages → Queue depth = 500
- After 60s: CloudWatch detects ≥ 500 → Add 5 tasks (total: 6 tasks)
- Workers process in parallel → Queue depth decreases rapidly
- When queue < 100: After 60s → Remove 2 tasks (total: 4 tasks)
- When queue < 50: After 60s → Remove 1 task (total: 3 tasks)
- When queue < 10: After 5 min cooldown → Remove 1 task (total: 2 tasks, then eventually 1)

**Scenario 3: Sustained High Load**
- Queue consistently > 500 messages
- Scales to maximum 20 tasks
- All 20 tasks process messages in parallel
- Queue depth stabilizes based on processing rate vs. incoming rate

#### Worker Processing Rate

Each worker:
- Polls queue every ~20 seconds (long polling)
- Processes up to 10 messages per poll
- Each message takes ~1-2 seconds to process (SMTP send)
- **Effective rate**: ~5-10 messages per minute per worker

**With 20 workers at max capacity**: ~100-200 messages per minute processing rate

### CloudWatch Metrics

Monitor these metrics:
- `ApproximateNumberOfMessagesVisible` - Queue depth
- `ApproximateNumberOfMessagesNotVisible` - In-flight messages
- ECS Service: `CPUUtilization`, `MemoryUtilization`
- ECS Service: `RunningTaskCount`

---

## Step 8: CloudWatch Logging

### Log Group Configuration

- **Log group:** `/ecs/furnace/send-worker`
- **Retention:** 7 days (adjust based on needs)
- **Stream prefix:** `send-worker`

### Viewing Logs

1. **Via AWS Console:**
   - CloudWatch → Log groups → `/ecs/furnace/send-worker`
   - Filter by task ID or search for errors

2. **Via AWS CLI:**
   ```bash
   aws logs tail /ecs/furnace/send-worker --follow --region us-west-2
   ```

---

## Testing Checklist

- [ ] ECS cluster created
- [ ] Task definition created with correct image URI
- [ ] IAM roles created with correct permissions
- [ ] ECS service deployed
- [ ] Tasks are running (check ECS console)
- [ ] Tasks can pull from ECR (check task logs for image pull errors)
- [ ] Tasks can connect to SQS (check task logs)
- [ ] Tasks can connect to Supabase (check task logs)
- [ ] Workers are polling queue (check CloudWatch logs)
- [ ] Auto-scaling works (test by sending many messages to queue)
- [ ] Logs appear in CloudWatch

---

## Cost Considerations

**ECS Fargate Pricing (us-west-2):**
- vCPU: $0.04048 per vCPU-hour
- Memory: $0.004445 per GB-hour

**Example (2 tasks, 0.5 vCPU, 1GB each):**
- vCPU cost: 2 × 0.5 × $0.04048 = $0.04048/hour = ~$29/month
- Memory cost: 2 × 1 × $0.004445 = $0.00889/hour = ~$6/month
- **Total: ~$35/month** (for 2 tasks running 24/7)

**Additional costs:**
- NAT Gateway (if using private subnets): ~$32/month
- CloudWatch Logs: ~$0.50 per GB ingested
- Data transfer: Minimal for SMTP

**Estimated monthly cost:** $35-70/month (depending on VPC setup and usage)

---

## Troubleshooting

### Tasks fail to start

**Check:**
1. Task definition image URI is correct
2. ECR repository exists and image is pushed
3. Task execution role has ECR pull permissions
4. Security group allows outbound traffic

### Tasks start but exit immediately

**Check CloudWatch logs:**
```bash
aws logs tail /ecs/furnace/send-worker --follow
```

**Common issues:**
- Missing environment variables
- Invalid Supabase credentials
- Invalid SQS queue URL
- Network connectivity issues

### Tasks can't connect to SQS

**Check:**
1. Task role has SQS permissions
2. Queue URL is correct
3. Queue exists in same region
4. Security group allows outbound HTTPS

### Tasks can't send emails

**Check:**
1. SMTP credentials are correct (in Supabase mailboxes table)
2. Security group allows outbound port 587/465 (SMTP)
3. Network connectivity (public IP or NAT Gateway)

---

## Next Steps

After Phase 2.3 is complete:
1. **Phase 3.2**: Refine send worker implementation (throttling, error handling)
2. **Phase 4**: Pacing & Throttling (atomic job reservation)
3. **Phase 2.4**: Inbox Checker (scheduled task for reply detection)

---

## Implementation Approach

**Recommended:** Use CDK in `amplify/backend.ts` for Infrastructure as Code.

**Alternative:** Use AWS Console for quick setup, then migrate to CDK later.

**Decision:** Since we're already using CDK for ECR and Lambda permissions, we should use CDK for ECS as well for consistency.

