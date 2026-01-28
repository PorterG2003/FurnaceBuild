# Phase 2.1: SQS Queues - Setup Guide

## Overview

This guide walks through setting up the SQS queues needed for the email infrastructure. The queues decouple the scheduler (job creation) from the workers (job execution), allowing for scalable, resilient processing.

## What We're Creating

1. **`furnace-send-queue`** - Main queue for email send jobs
2. **`furnace-send-queue-dlq`** - Dead letter queue for messages that fail processing

## Quick Start

Use the provided setup script:

```bash
./scripts/setup-sqs-queues.sh
```

This script will:
- Create both queues with proper configuration
- Set up the redrive policy (DLQ configuration)
- Output the queue URLs and ARNs you'll need later

## Manual Setup (Alternative)

If you prefer to create the queues manually or need to customize:

### Step 1: Create Send Queue

```bash
aws sqs create-queue \
  --queue-name furnace-send-queue \
  --attributes \
    VisibilityTimeout=300,\
    MessageRetentionPeriod=1209600,\
    ReceiveMessageWaitTimeSeconds=20 \
  --region us-east-1
```

**Configuration Explained:**
- `VisibilityTimeout=300` - Messages are hidden for 5 minutes after being received, giving workers time to process
- `MessageRetentionPeriod=1209600` - Messages kept for 14 days if not processed
- `ReceiveMessageWaitTimeSeconds=20` - Long polling (reduces empty API calls)

### Step 2: Create Dead Letter Queue

```bash
aws sqs create-queue \
  --queue-name furnace-send-queue-dlq \
  --attributes MessageRetentionPeriod=1209600 \
  --region us-east-1
```

### Step 3: Get Queue ARNs

```bash
# Get send queue ARN
SEND_QUEUE_URL=$(aws sqs get-queue-url --queue-name furnace-send-queue --query 'QueueUrl' --output text)
SEND_QUEUE_ARN=$(aws sqs get-queue-attributes \
  --queue-url "$SEND_QUEUE_URL" \
  --attribute-names QueueArn \
  --query 'Attributes.QueueArn' \
  --output text)

# Get DLQ ARN
DLQ_URL=$(aws sqs get-queue-url --queue-name furnace-send-queue-dlq --query 'QueueUrl' --output text)
DLQ_ARN=$(aws sqs get-queue-attributes \
  --queue-url "$DLQ_URL" \
  --attribute-names QueueArn \
  --query 'Attributes.QueueArn' \
  --output text)
```

### Step 4: Configure Redrive Policy

```bash
REDRIVE_POLICY="{\"deadLetterTargetArn\":\"$DLQ_ARN\",\"maxReceiveCount\":3}"

aws sqs set-queue-attributes \
  --queue-url "$SEND_QUEUE_URL" \
  --attributes \
    "RedrivePolicy=$REDRIVE_POLICY" \
    "ReceiveMessageWaitTimeSeconds=20"
```

**Redrive Policy Explained:**
- Messages that fail to process 3 times (maxReceiveCount=3) will be moved to the DLQ
- This prevents infinite retry loops and helps identify problematic messages

## Save Queue Information

After setup, save these values for use in Phase 2.2 and 2.3:

```bash
# Example: Save to environment variables or config file
export SEND_QUEUE_URL="https://sqs.us-east-1.amazonaws.com/123456789012/furnace-send-queue"
export SEND_QUEUE_ARN="arn:aws:sqs:us-east-1:123456789012:furnace-send-queue"
export DLQ_URL="https://sqs.us-east-1.amazonaws.com/123456789012/furnace-send-queue-dlq"
export DLQ_ARN="arn:aws:sqs:us-east-1:123456789012:furnace-send-queue-dlq"
```

## Testing

### Test 1: Send a Message

```bash
aws sqs send-message \
  --queue-url "$SEND_QUEUE_URL" \
  --message-body '{"test": "message"}' \
  --region us-east-1
```

### Test 2: Receive a Message

```bash
aws sqs receive-message \
  --queue-url "$SEND_QUEUE_URL" \
  --max-number-of-messages 1 \
  --wait-time-seconds 20 \
  --region us-east-1
```

### Test 3: Delete a Message (After Receiving)

```bash
# After receiving a message, delete it using the ReceiptHandle
aws sqs delete-message \
  --queue-url "$SEND_QUEUE_URL" \
  --receipt-handle "<ReceiptHandle from receive-message>" \
  --region us-east-1
```

### Test 4: Verify DLQ Behavior

To test the DLQ, you can simulate failures by:
1. Receiving a message (without deleting it)
2. Waiting for visibility timeout to expire (5 minutes)
3. Receiving it again
4. Repeating 3 times
5. The 4th receive should find it in the DLQ

Or, more practically, test with actual worker code that intentionally fails.

## IAM Policy Template

For reference, here's the IAM policy that will be needed for Lambda and ECS tasks:

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
        "arn:aws:sqs:REGION:ACCOUNT-ID:furnace-send-queue",
        "arn:aws:sqs:REGION:ACCOUNT-ID:furnace-send-queue-dlq"
      ]
    }
  ]
}
```

Replace `REGION` and `ACCOUNT-ID` with your actual values.

## Next Steps

Once queues are created:

1. ✅ Save queue URLs/ARNs for Phase 2.2 (Scheduler Lambda)
2. ✅ Continue to Phase 2.2: CloudWatch Scheduler + Lambda
3. ✅ The Scheduler Lambda will need the `SEND_QUEUE_URL` environment variable

## Troubleshooting

### Queue Already Exists
If you see "QueueAlreadyExists" errors, the script will use the existing queue. To start fresh, delete the queues first:

```bash
aws sqs delete-queue --queue-url "$SEND_QUEUE_URL"
aws sqs delete-queue --queue-url "$DLQ_URL"
```

### Permission Denied
Ensure your AWS credentials have `sqs:CreateQueue`, `sqs:GetQueueAttributes`, and `sqs:SetQueueAttributes` permissions.

### Wrong Region
Make sure you're creating queues in the same region where you'll deploy Lambda and ECS. The default is `us-east-1`, but you can change it:

```bash
AWS_REGION=us-west-2 ./scripts/setup-sqs-queues.sh
```

