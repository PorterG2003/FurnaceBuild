import { generateClient } from 'aws-amplify/api';
import type { Schema } from '@/amplify/data/resource';

interface SendInvitationEmailParams {
  to: string;
  inviterName: string;
  inviterEmail: string;
  accountName: string;
  acceptUrl?: string;
}

/**
 * Send an invitation email via Resend
 */
export async function sendInvitationEmail(params: SendInvitationEmailParams): Promise<void> {
  try {
    // Generate client with user pool authentication
    // The query requires allow.authenticated() which needs user pool tokens
    const client = generateClient<Schema>({
      authMode: 'userPool', // Use Cognito User Pool auth instead of identity pool
    });
    
    const result = await client.queries.sendInvitationEmail({
      to: params.to,
      inviterName: params.inviterName,
      inviterEmail: params.inviterEmail,
      accountName: params.accountName,
      acceptUrl: params.acceptUrl,
    });

    // Log the full result for debugging
    console.log('Email function result:', JSON.stringify(result, null, 2));

    // Check for errors in the result
    if (result.errors && result.errors.length > 0) {
      console.error('GraphQL errors:', result.errors);
      throw new Error(result.errors[0].message || 'Failed to send invitation email');
    }

    // The function returns data as a JSON string when called through Data API
    // Parse it if it's a string, otherwise use it directly
    let response: any;
    if (typeof result.data === 'string') {
      try {
        response = JSON.parse(result.data);
      } catch (parseError) {
        console.error('Failed to parse response data:', result.data);
        throw new Error('Invalid response format from email function');
      }
    } else {
      response = result.data;
    }

    if (!response?.success) {
      console.error('Function returned unsuccessful response:', response);
      throw new Error(response?.message || response?.error || 'Failed to send invitation email');
    }
  } catch (error) {
    console.error('Error sending invitation email:', error);
    // Log more details if available
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
    }
    throw error;
  }
}

interface TestMailboxConnectionParams {
  smtp_host: string;
  smtp_port: number;
  smtp_username: string;
  smtp_password: string;
  smtp_use_tls: boolean;
  smtp_use_ssl: boolean;
  imap_host: string;
  imap_port: number;
  imap_username: string;
  imap_password: string;
  imap_use_ssl: boolean;
}

interface TestMailboxConnectionResult {
  success: boolean;
  smtp: { success: boolean; error?: string };
  imap: { success: boolean; error?: string };
  message: string;
}

/**
 * Test mailbox SMTP and IMAP connections
 */
export async function testMailboxConnection(
  params: TestMailboxConnectionParams
): Promise<TestMailboxConnectionResult> {
  try {
    const client = generateClient<Schema>({
      authMode: 'userPool',
    });

    // Check if the function exists
    if (!client.queries.testMailboxConnection) {
      throw new Error(
        'testMailboxConnection function is not available. Please deploy the Amplify backend by running: npx ampx sandbox'
      );
    }

    const result = await client.queries.testMailboxConnection({
      smtp_host: params.smtp_host,
      smtp_port: params.smtp_port,
      smtp_username: params.smtp_username,
      smtp_password: params.smtp_password,
      smtp_use_tls: params.smtp_use_tls,
      smtp_use_ssl: params.smtp_use_ssl,
      imap_host: params.imap_host,
      imap_port: params.imap_port,
      imap_username: params.imap_username,
      imap_password: params.imap_password,
      imap_use_ssl: params.imap_use_ssl,
    });

    if (result.errors && result.errors.length > 0) {
      throw new Error(result.errors[0].message || 'Failed to test mailbox connection');
    }

    // Parse response if it's a string
    let response: any;
    if (typeof result.data === 'string') {
      try {
        response = JSON.parse(result.data);
      } catch (parseError) {
        throw new Error('Invalid response format from test function');
      }
    } else {
      response = result.data;
    }

    return response as TestMailboxConnectionResult;
  } catch (error) {
    console.error('Error testing mailbox connection:', error);
    if (error instanceof Error && error.message.includes('is not a function')) {
      throw new Error(
        'testMailboxConnection function is not deployed. Please run: npx ampx sandbox'
      );
    }
    throw error;
  }
}

interface SendTestMessageParams {
  message_job_id?: string;
  message_job_ids?: string[];
}

interface SendTestMessageResult {
  success: boolean;
  messageId?: string;
  messageIds?: string[];
  totalSent?: number;
  message?: string;
  error?: string;
}

/**
 * Send a test message or batch of messages to SQS queue
 */
export async function sendTestMessage(
  params: SendTestMessageParams
): Promise<SendTestMessageResult> {
  try {
    const client = generateClient<Schema>({
      authMode: 'userPool',
    });

    if (!client.queries.sendTestMessage) {
      throw new Error(
        'sendTestMessage function is not available. Please deploy the Amplify backend by running: npx ampx sandbox'
      );
    }

    const result = await client.queries.sendTestMessage({
      message_job_id: params.message_job_id,
      message_job_ids: params.message_job_ids,
    });

    if (result.errors && result.errors.length > 0) {
      throw new Error(result.errors[0].message || 'Failed to send test message');
    }

    // Parse response if it's a string
    let response: any;
    if (typeof result.data === 'string') {
      try {
        response = JSON.parse(result.data);
      } catch (parseError) {
        throw new Error('Invalid response format from test function');
      }
    } else {
      response = result.data;
    }

    return response as SendTestMessageResult;
  } catch (error) {
    console.error('Error sending test message:', error);
    if (error instanceof Error && error.message.includes('is not a function')) {
      throw new Error(
        'sendTestMessage function is not deployed. Please run: npx ampx sandbox'
      );
    }
    throw error;
  }
}

