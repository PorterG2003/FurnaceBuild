import { reportErrorToSlack } from '@furnace/slack-lib';
import { Resend } from 'resend';
import type { Schema } from '../../data/resource';

const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * Handler for sendInvitationEmail function
 * 
 * According to Amplify Gen 2 docs:
 * "Use the Schema export to strongly type your Function handler"
 * "arguments typed from .arguments()"
 * "return typed from .returns()"
 * 
 * When called through Data API, arguments come from event.arguments
 */
// Handler type is inferred from the function body
// Using explicit type causes issues with .returns(a.json()) in Amplify Gen 2
export const handler = async (event: Parameters<Schema['sendInvitationEmail']['functionHandler']>[0]) => {
  try {
    // Arguments come from event.arguments when called through Data API
    // This is typed from the schema definition in data/resource.ts
    const { to, inviterName, inviterEmail, accountName, acceptUrl } = event.arguments;

    if (!to || !inviterName || !accountName) {
      throw new Error('Missing required fields: to, inviterName, and accountName are required');
    }

    // For now, we'll use a simple accept URL - you can customize this
    const defaultAcceptUrl = acceptUrl || 'https://your-app-url.com/accept-invitation';

    const { data, error } = await resend.emails.send({
      from: 'Furnace <porter@getfurnace.io>', // Update this with your verified domain
      to: [to],
      subject: `You've been invited to join ${accountName} on Furnace`,
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Team Invitation</title>
          </head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #f33203 0%, #f85102 100%); padding: 30px; text-align: center; border-radius: 8px 8px 0 0;">
              <h1 style="color: white; margin: 0; font-size: 28px;">You've been invited!</h1>
            </div>
            <div style="background: #ffffff; padding: 30px; border: 1px solid #e5e5e5; border-top: none; border-radius: 0 0 8px 8px;">
              <p style="font-size: 16px; margin-bottom: 20px;">
                <strong>${inviterName}</strong> (${inviterEmail}) has invited you to join <strong>${accountName}</strong> on Furnace.
              </p>
              <p style="font-size: 16px; margin-bottom: 30px;">
                Furnace helps you build and manage automated lead generation campaigns. Click the button below to accept the invitation and get started.
              </p>
              <div style="text-align: center; margin: 30px 0;">
                <a href="${defaultAcceptUrl}" style="display: inline-block; background: #f33203; color: white; text-decoration: none; padding: 14px 28px; border-radius: 6px; font-weight: 600; font-size: 16px;">
                  Accept Invitation
                </a>
              </div>
              <p style="font-size: 14px; color: #666; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e5e5;">
                If you didn't expect this invitation, you can safely ignore this email.
              </p>
            </div>
            <div style="text-align: center; margin-top: 20px; color: #999; font-size: 12px;">
              <p>This email was sent by Furnace</p>
            </div>
          </body>
        </html>
      `,
      text: `
You've been invited to join ${accountName} on Furnace

${inviterName} (${inviterEmail}) has invited you to join ${accountName} on Furnace.

Furnace helps you build and manage automated lead generation campaigns.

Accept your invitation: ${defaultAcceptUrl}

If you didn't expect this invitation, you can safely ignore this email.
      `.trim(),
    });

    if (error) {
      console.error('Resend error:', error);
      throw new Error(`Failed to send email: ${JSON.stringify(error)}`);
    }

    // Return data directly (Data API will wrap it)
    // Schema says .returns(a.json()), so we return the JSON object
    return { 
      success: true, 
      messageId: data?.id || '',
      message: 'Invitation email sent successfully' 
    };
  } catch (error) {
    console.error('Handler error:', error);
    const msg = error instanceof Error ? error.message : String(error);
    reportErrorToSlack('Send invitation email failed', { severity: 'warning', error: msg });
    throw error;
  }
};

