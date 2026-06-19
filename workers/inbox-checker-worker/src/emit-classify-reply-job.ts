import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

export interface ClassifyReplyQueuePayload {
  emailMessageId: string;
  threadId: string;
  enrollmentId: string | null;
  campaignId: string | null;
  hasCategorizer: boolean;
  useAi: boolean;
}

export async function emitClassifyReplyJob(payload: ClassifyReplyQueuePayload): Promise<void> {
  const queueUrl = process.env.CLASSIFY_REPLY_QUEUE_URL?.trim();
  if (!queueUrl) {
    return;
  }

  try {
    const client = new SQSClient({ region: process.env.AWS_REGION || 'us-west-2' });
    await client.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify(payload),
      }),
    );
  } catch (error) {
    console.error('[classify-reply] failed to enqueue SQS message', error);
  }
}
