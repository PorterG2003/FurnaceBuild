import { reportErrorToSlack } from '@furnace/slack-lib';
import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';
import { ImapFlow } from 'imapflow';
import { formatImapError, type ImapErrorDetails } from '../../../lib/mailbox/connectionErrors';
import { buildImapFlowOptions } from '../../../lib/mailbox/imapClientOptions';
import { verifyImapInboxAccess } from '../../../lib/mailbox/imapInbox';
import type { Schema } from '../../data/resource';

function isFunctionUrlEvent(event: any): event is { headers: Record<string, string>; body?: string | null; isBase64Encoded?: boolean } {
  return event && typeof event.headers === 'object' && !event.arguments;
}

interface TestMailboxConnectionArgs {
  // SMTP
  smtp_host: string;
  smtp_port: number;
  smtp_username: string;
  smtp_password: string;
  smtp_use_tls: boolean;
  smtp_use_ssl: boolean;
  // IMAP
  imap_host: string;
  imap_port: number;
  imap_username: string;
  imap_password: string;
  imap_use_ssl: boolean;
}

type ImapTestDetails = ImapErrorDetails;

/**
 * Test SMTP connection
 */
async function testSMTP(config: {
  host: string;
  port: number;
  username: string;
  password: string;
  useTLS: boolean;
  useSSL: boolean;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.useSSL, // true for 465, false for other ports
      auth: {
        user: config.username,
        pass: config.password,
      },
      tls: {
        rejectUnauthorized: false, // Allow self-signed certificates
      },
      connectionTimeout: 15_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });

    // Test the connection
    await transporter.verify();

    return { success: true };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'SMTP connection failed',
    };
  }
}

/**
 * Test IMAP connection
 */
async function testIMAP(config: {
  host: string;
  port: number;
  username: string;
  password: string;
  useSSL: boolean;
  smtpHost: string;
  smtpPort: number;
}): Promise<{ success: boolean; error?: string; details?: ImapTestDetails }> {
  let client: ImapFlow | null = null;
  const details: ImapTestDetails = {
    stage: 'unknown',
    host: config.host,
    port: config.port,
    secure: config.useSSL,
    sameHostAsSmtp: config.host.toLowerCase() === config.smtpHost.toLowerCase(),
    samePortAsSmtp: config.port === config.smtpPort,
  };

  try {
    client = new ImapFlow(
      buildImapFlowOptions({
        host: config.host,
        port: config.port,
        username: config.username,
        password: config.password,
        useSSL: config.useSSL,
      }),
    );

    details.stage = 'connect';
    await client.connect();
    details.serverName = (client as { serverInfo?: { name?: string } }).serverInfo?.name;

    details.stage = 'mailboxOpen';
    await verifyImapInboxAccess(client);

    return { success: true, details };
  } catch (error: unknown) {
    const formatted = formatImapError(error, details);
    return {
      success: false,
      error: formatted.error,
      details: formatted.details,
    };
  } finally {
    if (client) {
      try {
        await client.logout();
      } catch (e) {
        // Ignore logout errors
      }
    }
  }
}

async function testMailboxConnectionLogic(args: TestMailboxConnectionArgs) {
  const [smtpResult, imapResult] = await Promise.all([
    testSMTP({
      host: args.smtp_host,
      port: args.smtp_port,
      username: args.smtp_username,
      password: args.smtp_password,
      useTLS: args.smtp_use_tls,
      useSSL: args.smtp_use_ssl,
    }),
    testIMAP({
      host: args.imap_host,
      port: args.imap_port,
      username: args.imap_username,
      password: args.imap_password,
      useSSL: args.imap_use_ssl,
      smtpHost: args.smtp_host,
      smtpPort: args.smtp_port,
    }),
  ]);

  const allSuccess = smtpResult.success && imapResult.success;
  const errors: string[] = [];
  if (!smtpResult.success) errors.push(`SMTP: ${smtpResult.error}`);
  if (!imapResult.success) errors.push(`IMAP: ${imapResult.error}`);

  return {
    success: allSuccess,
    smtp: smtpResult,
    imap: imapResult,
    message: allSuccess ? 'Both SMTP and IMAP connections successful' : `Connection test failed: ${errors.join('; ')}`,
  };
}

export const handler: Schema['testMailboxConnection']['functionHandler'] = async (event) => {
  const isUrlInvocation = isFunctionUrlEvent(event);
  try {
    if (isUrlInvocation) {
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
        console.warn('testMailboxConnection auth failed:', authError?.message ?? 'no user');
        return { statusCode: 401, body: JSON.stringify({ error: 'Invalid or expired token' }) };
      }
      const body = event.body ? (event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : event.body) : '{}';
      const args = JSON.parse(body) as TestMailboxConnectionArgs;
      const result = await testMailboxConnectionLogic(args);
      console.log('testMailboxConnection result', {
        success: result.success,
        smtp: result.smtp.success,
        imap: result.imap.success,
      });
      return { statusCode: 200, body: JSON.stringify(result) };
    }

    const args: TestMailboxConnectionArgs = event.arguments;

    if (!args.smtp_host || !args.smtp_username || !args.smtp_password) {
      throw new Error('SMTP host, username, and password are required');
    }
    if (!args.imap_host || !args.imap_username || !args.imap_password) {
      throw new Error('IMAP host, username, and password are required');
    }

    return await testMailboxConnectionLogic(args);
  } catch (error: any) {
    console.error('Test mailbox connection error:', error);
    const msg = error?.message ?? String(error);
    reportErrorToSlack('Test mailbox connection failed', { severity: 'warning', error: msg });
    if (isUrlInvocation) {
      return { statusCode: 500, body: JSON.stringify({ error: msg }) };
    }
    throw error;
  }
};

