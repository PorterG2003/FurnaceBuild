import nodemailer from 'nodemailer';
import { ImapFlow } from 'imapflow';
import type { Schema } from '../../data/resource';

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
}): Promise<{ success: boolean; error?: string }> {
  let client: ImapFlow | null = null;
  try {
    client = new ImapFlow({
      host: config.host,
      port: config.port,
      secure: config.useSSL,
      auth: {
        user: config.username,
        pass: config.password,
      },
      logger: false, // Disable logging
    });

    // Connect and authenticate
    await client.connect();
    
    // Try to access a mailbox to verify authentication
    const mailbox = await client.mailboxOpen('INBOX');
    
    return { success: true };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'IMAP connection failed',
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

export const handler: Schema['testMailboxConnection']['functionHandler'] = async (event) => {
  try {
    const args: TestMailboxConnectionArgs = event.arguments;

    // Validate required fields
    if (!args.smtp_host || !args.smtp_username || !args.smtp_password) {
      throw new Error('SMTP host, username, and password are required');
    }
    if (!args.imap_host || !args.imap_username || !args.imap_password) {
      throw new Error('IMAP host, username, and password are required');
    }

    // Test both connections in parallel
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
      }),
    ]);

    const allSuccess = smtpResult.success && imapResult.success;
    const errors: string[] = [];
    if (!smtpResult.success) {
      errors.push(`SMTP: ${smtpResult.error}`);
    }
    if (!imapResult.success) {
      errors.push(`IMAP: ${imapResult.error}`);
    }

    return {
      success: allSuccess,
      smtp: smtpResult,
      imap: imapResult,
      message: allSuccess
        ? 'Both SMTP and IMAP connections successful'
        : `Connection test failed: ${errors.join('; ')}`,
    };
  } catch (error: any) {
    console.error('Test mailbox connection error:', error);
    throw error;
  }
};

