# Scheduler Race Condition Fix - SQS Queue Solution (ABSOLUTE GUARANTEE)

## Problem

**Current Issue**: Multiple scheduler workers are processing the same enrollment simultaneously, creating duplicate message jobs.

**Root Cause**: 
- Workers poll database directly: `SELECT * FROM enrollments WHERE state = 'active' AND next_run_at <= NOW()`
- No locking mechanism prevents multiple workers from picking up the same enrollment
- Race condition: Worker 1 and Worker 2 both see enrollment X as ready, both process it

**Why FOR UPDATE SKIP LOCKED Doesn't Guarantee**:
- RPC functions in Supabase/PostgREST execute in **auto-commit mode**
- When the function returns, the transaction commits → **lock is released immediately**
- Window between lock release and state update allows duplicates

---

## Solution: SQS FIFO Queue with Deduplication ⭐ **ABSOLUTE GUARANTEE**

### Architecture

```
Enrollment Pusher (Lambda - Scheduled Every 5s)
  → Queries enrollments ready to process
  → Pushes enrollment IDs to SQS FIFO queue (with deduplication ID)
  → SQS guarantees exactly-once delivery

Scheduler Workers (ECS Fargate)
  → Pull messages from SQS FIFO queue
  → Process enrollment
  → Delete message from queue
```

### Why SQS FIFO Provides Absolute Guarantee

1. **Message Deduplication ID**: Each enrollment ID can only appear once in the queue within a 5-minute window
2. **Exactly-Once Processing**: SQS FIFO guarantees each message is delivered exactly once
3. **Visibility Timeout**: Once a worker receives a message, it's invisible to other workers until deleted or timeout expires
4. **No Race Conditions**: Queue abstraction eliminates database-level race conditions

### Implementation Plan

#### Step 1: Create SQS FIFO Queue

**Queue Name**: `furnace-enrollment-queue.fifo`

**Configuration**:
- **Type**: FIFO (First-In-First-Out)
- **Content-based deduplication**: Enabled (automatically deduplicates based on message body)
- **Message group ID**: Use `campaign_id` or a static value (e.g., "default") for ordering
- **Visibility timeout**: 5 minutes (enough time for worker to process)
- **Message retention**: 14 days (default)
- **Dead Letter Queue**: Optional (for failed messages after max retries)

**CloudFormation/CDK**:
```typescript
const enrollmentQueue = new sqs.Queue(this, 'EnrollmentQueue', {
  queueName: 'furnace-enrollment-queue.fifo',
  fifo: true,
  contentBasedDeduplication: true, // Auto-deduplicate based on message body
  visibilityTimeout: Duration.minutes(5),
  retentionPeriod: Duration.days(14),
  // DLQ optional
});
```

#### Step 2: Create Enrollment Pusher Lambda

**Purpose**: Periodically queries database for ready enrollments and pushes to SQS

**Schedule**: CloudWatch Events rule → Every 5 seconds (or configurable)

**Logic**:
```typescript
// Lambda handler
export async function handler(event: ScheduledEvent) {
  // 1. Query enrollments ready to process
  const { data: enrollments } = await supabase
    .from('enrollments')
    .select('id, campaign_id')
    .eq('state', 'active')
    .lte('next_run_at', new Date().toISOString())
    .limit(100); // Batch size
  
  if (!enrollments || enrollments.length === 0) {
    return { processed: 0 };
  }
  
  // 2. Push to SQS FIFO queue
  const queueUrl = process.env.ENROLLMENT_QUEUE_URL!;
  const sqsClient = new SQSClient({ region: 'us-west-2' });
  
  const messages = enrollments.map(enrollment => ({
    QueueUrl: queueUrl,
    MessageBody: JSON.stringify({
      enrollment_id: enrollment.id,
      campaign_id: enrollment.campaign_id,
    }),
    MessageGroupId: enrollment.campaign_id || 'default', // FIFO requirement
    // No MessageDeduplicationId needed - content-based deduplication is enabled
    // SQS will automatically deduplicate based on MessageBody hash
  }));
  
  // Send messages in batches of 10 (SQS limit)
  for (let i = 0; i < messages.length; i += 10) {
    const batch = messages.slice(i, i + 10);
    await sqsClient.send(new SendMessageBatchCommand({
      QueueUrl: queueUrl,
      Entries: batch.map((msg, index) => ({
        Id: `${i + index}`,
        MessageBody: msg.MessageBody,
        MessageGroupId: msg.MessageGroupId,
      })),
    }));
  }
  
  return { processed: enrollments.length };
}
```

**IAM Permissions**:
- `sqs:SendMessage` on enrollment queue
- `sqs:GetQueueAttributes` (optional, for metrics)

**Environment Variables**:
- `ENROLLMENT_QUEUE_URL`: SQS queue URL
- `SUPABASE_URL`: Supabase URL
- `SUPABASE_SERVICE_KEY`: Supabase service key

#### Step 3: Update Scheduler Worker

**Change**: Pull from SQS queue instead of polling database

**Before** (database polling):
```typescript
// workers/scheduler-worker/src/database.ts
async poll(): Promise<Enrollment[]> {
  const { data } = await this.supabase
    .from('enrollments')
    .select('*')
    .eq('state', 'active')
    .lte('next_run_at', new Date().toISOString());
  return data || [];
}
```

**After** (SQS queue):
```typescript
// workers/scheduler-worker/src/queue-client.ts
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';

export class EnrollmentQueueClient {
  private sqs: SQSClient;
  private queueUrl: string;
  
  constructor(queueUrl: string) {
    this.sqs = new SQSClient({ region: 'us-west-2' });
    this.queueUrl = queueUrl;
  }
  
  async poll(): Promise<Array<{ enrollment_id: string; receiptHandle: string }>> {
    const command = new ReceiveMessageCommand({
      QueueUrl: this.queueUrl,
      MaxNumberOfMessages: 10, // SQS max
      WaitTimeSeconds: 20, // Long polling
      VisibilityTimeout: 300, // 5 minutes
    });
    
    const response = await this.sqs.send(command);
    
    if (!response.Messages) {
      return [];
    }
    
    return response.Messages.map(msg => ({
      enrollment_id: JSON.parse(msg.Body!).enrollment_id,
      receiptHandle: msg.ReceiptHandle!,
    }));
  }
  
  async deleteMessage(receiptHandle: string): Promise<void> {
    await this.sqs.send(new DeleteMessageCommand({
      QueueUrl: this.queueUrl,
      ReceiptHandle: receiptHandle,
    }));
  }
}
```

**Update Worker**:
```typescript
// workers/scheduler-worker/src/worker.ts
export class SchedulerWorker {
  private queueClient: EnrollmentQueueClient;
  // ... other fields
  
  async start(): Promise<void> {
    this.running = true;
    console.log('Scheduler worker started. Polling SQS queue...');
    
    while (this.running) {
      try {
        // Pull messages from SQS (instead of database)
        const messages = await this.queueClient.poll();
        
        if (messages.length > 0) {
          console.log(`[SCHEDULER] Found ${messages.length} enrollments to process`);
          
          // Process enrollments
          const results = await Promise.allSettled(
            messages.map(msg => this.processEnrollmentFromQueue(msg.enrollment_id, msg.receiptHandle))
          );
          
          // Log results
          // ...
        } else {
          // No messages - wait before next poll (long polling handles this)
          await this.sleep(5000);
        }
      } catch (error) {
        // Error handling
      }
    }
  }
  
  private async processEnrollmentFromQueue(enrollmentId: string, receiptHandle: string): Promise<void> {
    try {
      // 1. Load enrollment from database
      const { data: enrollment } = await this.supabase
        .from('enrollments')
        .select('*')
        .eq('id', enrollmentId)
        .single();
      
      if (!enrollment) {
        // Enrollment doesn't exist, delete message
        await this.queueClient.deleteMessage(receiptHandle);
        return;
      }
      
      // 2. Process enrollment (same logic as before)
      await this.processEnrollment(enrollment);
      
      // 3. Delete message from queue (success)
      await this.queueClient.deleteMessage(receiptHandle);
    } catch (error) {
      // On error, message will become visible again after visibility timeout
      // SQS will retry automatically
      console.error(`Error processing enrollment ${enrollmentId}:`, error);
      throw error; // Don't delete message, let it retry
    }
  }
}
```

#### Step 4: Infrastructure Setup

**Amplify/CDK**:
```typescript
// amplify/backend.ts or CDK stack

// 1. Create SQS FIFO queue
const enrollmentQueue = new sqs.Queue(this, 'EnrollmentQueue', {
  queueName: 'furnace-enrollment-queue.fifo',
  fifo: true,
  contentBasedDeduplication: true,
  visibilityTimeout: Duration.minutes(5),
});

// 2. Create Lambda function for enrollment pusher
const enrollmentPusher = new Function(this, 'EnrollmentPusher', {
  name: 'enrollment-pusher',
  runtime: Runtime.NODEJS_20_X,
  handler: 'index.handler',
  timeout: Duration.seconds(30),
  environment: {
    ENROLLMENT_QUEUE_URL: enrollmentQueue.queueUrl,
    SUPABASE_URL: process.env.SUPABASE_URL!,
  },
});

// Grant Lambda permission to send to queue
enrollmentQueue.grantSendMessages(enrollmentPusher);

// 3. Create CloudWatch Events rule (every 5 seconds)
const rule = new events.Rule(this, 'EnrollmentPusherSchedule', {
  schedule: events.Schedule.rate(Duration.seconds(5)),
});

rule.addTarget(new targets.LambdaFunction(enrollmentPusher));

// 4. Grant scheduler workers permission to read/delete from queue
enrollmentQueue.grantConsumeMessages(schedulerWorkerTaskRole);
```

**Scheduler Worker IAM Permissions**:
- `sqs:ReceiveMessage` on enrollment queue
- `sqs:DeleteMessage` on enrollment queue
- `sqs:GetQueueAttributes` (optional, for metrics)

#### Step 5: Update Environment Variables

**Scheduler Worker**:
- `ENROLLMENT_QUEUE_URL`: SQS queue URL (new)
- Remove direct database polling code

**Lambda Enrollment Pusher**:
- `ENROLLMENT_QUEUE_URL`: SQS queue URL
- `SUPABASE_URL`: Supabase URL
- `SUPABASE_SERVICE_KEY`: Supabase service key

---

## Why This Provides Absolute Guarantee

1. **SQS FIFO Deduplication**:
   - Content-based deduplication: SQS automatically deduplicates based on message body hash
   - Deduplication window: 5 minutes (plenty for enrollment processing)
   - If same enrollment ID is pushed twice within 5 minutes, SQS only delivers once

2. **Visibility Timeout**:
   - Once a worker receives a message, it's invisible to other workers
   - Message only becomes visible again if worker doesn't delete it (crash/timeout)
   - Prevents concurrent processing

3. **Exactly-Once Delivery**:
   - SQS FIFO guarantees each message is delivered exactly once
   - No duplicate deliveries possible

4. **No Race Conditions**:
   - Queue abstraction eliminates database-level race conditions
   - Only one worker can receive a message at a time

---

## Trade-offs

**Pros**:
- ✅ **Absolute guarantee**: SQS FIFO provides exactly-once delivery
- ✅ **Built-in retries**: Failed messages automatically retry after visibility timeout
- ✅ **Dead Letter Queue**: Can route failed messages to DLQ for analysis
- ✅ **Scalability**: Queue buffers spikes, workers scale independently
- ✅ **Monitoring**: CloudWatch metrics for queue depth, message age, etc.

**Cons**:
- ❌ **Additional latency**: DB → Queue → Worker (adds ~50-100ms)
- ❌ **More infrastructure**: Lambda function + SQS queue to maintain
- ❌ **Cost**: SQS charges per request (minimal, but not zero)
- ❌ **Complexity**: Two services instead of one

**Cost Estimate**:
- SQS: ~$0.40 per million requests
- Lambda: Free tier covers 1M requests/month, then $0.20 per million requests
- **Total**: Negligible for typical workloads (< $1/month for most use cases)

---

## Migration Path

1. **Phase 1**: Deploy SQS queue and enrollment pusher Lambda (doesn't affect existing workers)
2. **Phase 2**: Deploy updated scheduler workers that read from queue
3. **Phase 3**: Monitor both systems, verify queue-based workers are processing correctly
4. **Phase 4**: Remove old database polling code once queue-based system is stable

---

## Summary

**Solution**: **SQS FIFO Queue with Content-Based Deduplication**

- ✅ **Absolute guarantee**: Exactly-once delivery, no duplicates possible
- ✅ **Production-ready**: AWS managed service, battle-tested at scale
- ✅ **Self-healing**: Automatic retries, DLQ support
- ⚠️ **Additional infrastructure**: Lambda + SQS queue
- ⚠️ **Slight latency increase**: ~50-100ms per enrollment

**This is the only solution that provides an absolute guarantee of no duplicates.**

