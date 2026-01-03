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

