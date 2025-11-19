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

