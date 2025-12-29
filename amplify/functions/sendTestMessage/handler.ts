import { SQSClient, SendMessageCommand, SendMessageBatchCommand } from '@aws-sdk/client-sqs';
import type { Schema } from '../../data/resource';

/**
 * Handler for sendTestMessage function
 * 
 * Sends a message or batch of messages to the SQS send queue
 * 
 * Single message: { message_job_id: "uuid" }
 * Batch: { message_job_ids: ["uuid1", "uuid2", ...] }
 */
export const handler: Schema['sendTestMessage']['functionHandler'] = async (event) => {
  try {
    const { message_job_id, message_job_ids } = event.arguments;

    const sendQueueUrl = process.env.SEND_QUEUE_URL;
    const awsRegion = process.env.AWS_REGION || 'us-west-2';

    if (!sendQueueUrl) {
      throw new Error('SEND_QUEUE_URL environment variable is not set');
    }

    if (!awsRegion) {
      throw new Error('AWS_REGION is not set in Lambda runtime environment');
    }

    // Create SQS client
    const sqs = new SQSClient({ region: awsRegion });

    // Handle batch sending
    if (message_job_ids && Array.isArray(message_job_ids) && message_job_ids.length > 0) {
      // Filter out any null/undefined values
      const validIds = message_job_ids.filter((id): id is string => Boolean(id));
      
      if (validIds.length === 0) {
        throw new Error('No valid message_job_ids provided');
      }

      // SQS batch limit is 10 messages per batch
      const batchSize = 10;
      const batches: string[][] = [];
      
      for (let i = 0; i < validIds.length; i += batchSize) {
        batches.push(validIds.slice(i, i + batchSize));
      }

      let totalSent = 0;
      const messageIds: string[] = [];

      // Send each batch
      for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        const batch = batches[batchIndex];
        const entries = batch.map((id, index) => ({
          Id: `${batchIndex}-${index}`,
          MessageBody: JSON.stringify({ message_job_id: id }),
        }));

        const response = await sqs.send(
          new SendMessageBatchCommand({
            QueueUrl: sendQueueUrl,
            Entries: entries,
          })
        );

        if (response.Successful) {
          totalSent += response.Successful.length;
          const successfulIds = response.Successful
            .map(m => m.MessageId)
            .filter((id): id is string => id !== undefined);
          messageIds.push(...successfulIds);
        }

        if (response.Failed && response.Failed.length > 0) {
          console.warn(`Failed to send ${response.Failed.length} messages in batch`);
        }
      }

      return {
        success: true,
        messageId: messageIds[0] || undefined, // Return first message ID for compatibility
        messageIds: messageIds,
        totalSent,
        message: `Sent ${totalSent} messages to SQS queue in ${batches.length} batch(es)`,
      };
    }

    // Handle single message
    if (!message_job_id || typeof message_job_id !== 'string') {
      throw new Error('message_job_id or message_job_ids is required');
    }

    // Send single message to SQS
    const response = await sqs.send(
      new SendMessageCommand({
        QueueUrl: sendQueueUrl,
        MessageBody: JSON.stringify({
          message_job_id,
        }),
      })
    );

    return {
      success: true,
      messageId: response.MessageId,
      message: `Message sent to SQS queue successfully`,
    };
  } catch (error) {
    console.error('Error sending message to SQS:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      error: errorMessage,
    };
  }
};

