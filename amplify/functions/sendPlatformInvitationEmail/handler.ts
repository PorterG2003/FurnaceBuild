import { reportErrorToSlack } from '@furnace/slack-lib';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

function isFunctionUrlEvent(
  event: any
): event is { headers: Record<string, string>; body?: string | null; isBase64Encoded?: boolean } {
  return event && typeof event.headers === 'object';
}

async function sendPlatformInvitationEmailLogic(args: {
  to: string;
  inviterName: string;
  monthlyRetainerCents: number;
  acceptUrl: string;
  proposalTitle?: string;
  accountName?: string;
}) {
  const { to, inviterName, monthlyRetainerCents, acceptUrl, proposalTitle, accountName } = args;

  if (!to || !inviterName || !acceptUrl || !monthlyRetainerCents) {
    throw new Error('Missing required fields.');
  }

  const monthlyPrice = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(monthlyRetainerCents / 100);

  const offerTitle = proposalTitle?.trim() || 'Your Furnace invite is ready';
  const companyLine = accountName?.trim() ? `<p><strong>Workspace:</strong> ${accountName.trim()}</p>` : '';

  const { data, error } = await resend.emails.send({
    from: 'Furnace <porter@getfurnace.io>',
    to: [to],
    subject: `${offerTitle} - review and activate Furnace`,
    html: `
      <!DOCTYPE html>
      <html>
        <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;line-height:1.6;color:#1f2937;max-width:600px;margin:0 auto;padding:24px;background:#f8fafc;">
          <div style="background:#121212;border-radius:16px;overflow:hidden;border:1px solid #1f2937;">
            <div style="padding:28px 28px 20px;background:linear-gradient(135deg,#f33203 0%,#f85102 100%);color:white;">
              <p style="margin:0 0 8px;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;opacity:0.8;">Furnace Invite</p>
              <h1 style="margin:0;font-size:28px;line-height:1.2;">${offerTitle}</h1>
            </div>
            <div style="padding:28px;background:#ffffff;">
              <p><strong>${inviterName}</strong> invited you to review your Furnace invite and activate your account.</p>
              ${companyLine}
              <p><strong>Monthly retainer:</strong> ${monthlyPrice}</p>
              <p>You will review the agreement, set your password, and complete payment to activate your workspace.</p>
              <div style="margin:32px 0;text-align:center;">
                <a href="${acceptUrl}" style="display:inline-block;background:#f33203;color:white;text-decoration:none;padding:14px 24px;border-radius:10px;font-weight:600;">
                  Review invite and continue
                </a>
              </div>
              <p style="font-size:14px;color:#6b7280;">If you were not expecting this email, you can ignore it.</p>
            </div>
          </div>
        </body>
      </html>
    `,
    text: [
      `${offerTitle}`,
      '',
      `${inviterName} invited you to review your Furnace invite and activate your account.`,
      accountName?.trim() ? `Workspace: ${accountName.trim()}` : '',
      `Monthly retainer: ${monthlyPrice}`,
      '',
      `Review and continue: ${acceptUrl}`,
    ]
      .filter(Boolean)
      .join('\n'),
  });

  if (error) {
    throw new Error(`Failed to send email: ${JSON.stringify(error)}`);
  }

  return { success: true, messageId: data?.id || '', message: 'Platform invitation email sent successfully' };
}

export const handler = async (
  event: { headers: Record<string, string>; body?: string | null; isBase64Encoded?: boolean }
) => {
  try {
    if (!isFunctionUrlEvent(event)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Unsupported invocation' }) };
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
    if (!supabaseUrl || !supabaseSecretKey) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Server configuration error' }) };
    }

    const auth = event.headers?.authorization || event.headers?.Authorization;
    const token = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : null;
    if (!token) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Missing or invalid Authorization header' }) };
    }

    const supabase = createClient(supabaseUrl, supabaseSecretKey);
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Invalid or expired token' }) };
    }
    const { data: adminFlag, error: flagError } = await supabase
      .from('user_access_flags')
      .select('user_id')
      .eq('user_id', user.id)
      .eq('flag_key', 'platform_admin')
      .maybeSingle();
    if (flagError) {
      return { statusCode: 500, body: JSON.stringify({ error: flagError.message }) };
    }
    if (!adminFlag) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized' }) };
    }

    const body = event.body ? (event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : event.body) : '{}';
    const args = JSON.parse(body) as {
      to: string;
      inviterName: string;
      monthlyRetainerCents: number;
      acceptUrl: string;
      proposalTitle?: string;
      accountName?: string;
    };

    const result = await sendPlatformInvitationEmailLogic(args);
    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    reportErrorToSlack('Send platform invitation email failed', { severity: 'warning', error: msg });
    return { statusCode: 500, body: JSON.stringify({ error: msg }) };
  }
};
