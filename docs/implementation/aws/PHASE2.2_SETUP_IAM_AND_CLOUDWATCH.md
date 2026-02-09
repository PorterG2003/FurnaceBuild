# Phase 2.2: IAM Permissions and CloudWatch Event Rule Setup

## Overview

The scheduler Lambda function needs:
1. IAM permissions to send messages to SQS ✅ **DONE via CDK in backend.ts**
2. A CloudWatch Event Rule to trigger it periodically

## Step 1: Add IAM Permissions for SQS ✅

**Already configured in `amplify/backend.ts` using CDK!**

The IAM permissions are automatically granted when you deploy. The scheduler Lambda has permission to:
- `sqs:SendMessage`
- `sqs:GetQueueUrl`
- `sqs:GetQueueAttributes`

On the queue: `arn:aws:sqs:us-west-2:686255981838:furnace-send-queue`

No manual setup needed - the permissions are managed via Infrastructure as Code!

## Step 2: Create CloudWatch Event Rule ✅

**Already configured in `amplify/functions/scheduler/resource.ts` using the `schedule` property!**

The scheduler function uses Amplify's built-in scheduling feature:
- Schedule: `every 1m` (runs every minute)
- Automatically creates EventBridge rule
- Automatically grants Lambda invocation permissions

**Note:** EventBridge rate expressions have a minimum of 1 minute. For 30-second intervals, you would need:
- Two separate scheduled functions, OR
- Accept 1-minute as the minimum (which processes enrollments in batches, so it's fine)

No manual setup needed - the schedule is managed via Infrastructure as Code!

## Step 3: Verify Setup

### Test the Lambda Function

1. Go to Lambda → Your scheduler function
2. Click **Test** tab
3. Create a test event (use empty JSON `{}` or CloudWatch Events template)
4. Click **Test**
5. Check CloudWatch Logs to see if it runs successfully

### Check CloudWatch Logs

1. Go to Lambda → Your scheduler function → **Monitor** tab
2. Click **View CloudWatch logs**
3. You should see logs from test runs and scheduled invocations

## Troubleshooting

### Lambda doesn't have SQS permissions

**Error:** `AccessDenied: User: arn:aws:iam::... is not authorized to perform: sqs:SendMessage`

**Fix:** Add the IAM policy as described in Step 1.

### Lambda not being triggered

**Check:**
1. EventBridge rule is enabled
2. Lambda function is selected as target
3. Lambda has permission to be invoked by EventBridge (should be automatic)

### Environment variables missing

**Error:** `Missing required environment variables`

**Fix:** Make sure you've set all secrets:
```bash
npx ampx sandbox secret set EXPO_PUBLIC_SUPABASE_URL
npx ampx sandbox secret set SUPABASE_SECRET_KEY
npx ampx sandbox secret set SEND_QUEUE_URL
```

## Next Steps

After IAM permissions and CloudWatch Event Rule are set up:
1. ✅ Scheduler Lambda will run every 30 seconds
2. ✅ It will query enrollments and create message_jobs
3. ✅ It will push message_job IDs to SQS queue

**TODO:** Implement the placeholder functions:
- Flow evaluation logic
- Mailbox selection logic
- Scheduling logic (campaign schedule, jitter)

