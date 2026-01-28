import { SupabaseClient, createClient } from '@supabase/supabase-js';
import { ImapFlow } from 'imapflow';
import type { EventBridgeHandler } from 'aws-lambda';

/**
 * Inbox Checker Lambda Handler
 * 
 * This function runs periodically (every 5 minutes) to:
 * 1. Query active mailboxes from Supabase
 * 2. For each mailbox, connect via IMAP and check for new messages
 * 3. Process replies/bounces/unsubscribes
 * 4. Create email threads and messages
 * 5. Update enrollment states (stop on reply/bounce/unsubscribe)
 * 6. Update last_synced_at
 */

interface ProcessedMessage {
  uid: number;
  messageId: string | null;
  inReplyTo: string | null;
  references: string | null;
  from: { name?: string; address: string };
  to: { name?: string; address: string }[];
  subject: string;
  bodyText: string | null;
  bodyHtml: string | null;
  date: Date;
  headers: Record<string, string | string[]>;
  attachments: Array<{ filename: string; contentType: string; size: number }>;
}

/**
 * Connect to IMAP and fetch messages since last_synced_at
 */
async function fetchNewMessages(
  mailbox: any,
  lastSyncedAt: Date | null
): Promise<ProcessedMessage[]> {
  const client = new ImapFlow({
    host: mailbox.imap_host,
    port: mailbox.imap_port,
    secure: mailbox.imap_use_ssl,
    auth: {
      user: mailbox.imap_username,
      pass: mailbox.imap_password,
    },
    logger: false, // Disable verbose logging
  });

  try {
    await client.connect();
    await client.mailboxOpen('INBOX');

    // Build search criteria: messages since last_synced_at (or last 7 days if never synced)
    let searchCriteria: any;
    if (lastSyncedAt) {
      searchCriteria = { since: lastSyncedAt };
    } else {
      // First sync: only get recent messages (last 7 days) to avoid processing old emails
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      searchCriteria = { since: sevenDaysAgo };
    }

    // Search for messages (imapflow search() accepts SearchObject; returns false | number[] when uid: true)
    const searchResult: false | number[] = await client.search(searchCriteria as any, { uid: true });
    const messageUids: number[] = Array.isArray(searchResult) ? searchResult : [];
    if (!messageUids.length) {
      return [];
    }

    // Fetch message data
    const processedMessages: ProcessedMessage[] = [];
    
    for (const uid of messageUids) {
      try {
        // Pass { uid: true } so ImapFlow sends "UID FETCH" not "FETCH" (search returns UIDs).
        const message = await client.fetchOne(uid, {
          source: true,
          uid: true,
          bodyStructure: true,
        }, { uid: true });

        if (!message) continue;

        // Download full RFC822 (part undefined). Options.uid so range is UID not sequence.
        const parsed = await client.download(uid, undefined, { uid: true });
        const chunks: Buffer[] = [];
        for await (const chunk of parsed.content) {
          chunks.push(Buffer.from(chunk));
        }
        const rawMessage = Buffer.concat(chunks).toString('utf-8');
        
        // Simple email parsing (for production, consider using a proper email parser)
        const headers: Record<string, string | string[]> = {};
        const headerEnd = rawMessage.indexOf('\r\n\r\n');
        const headerText = rawMessage.substring(0, headerEnd);
        const bodyText = rawMessage.substring(headerEnd + 4);

        // Parse headers
        for (const line of headerText.split('\r\n')) {
          const colonIndex = line.indexOf(':');
          if (colonIndex === -1) continue;
          const key = line.substring(0, colonIndex).trim().toLowerCase();
          const value = line.substring(colonIndex + 1).trim();
          
          if (headers[key]) {
            // Multiple values - convert to array
            const existing = headers[key];
            headers[key] = Array.isArray(existing) ? [...existing, value] : [existing, value];
          } else {
            headers[key] = value;
          }
        }

        // Extract key headers
        const messageId = extractHeaderValue(headers['message-id']);
        const inReplyTo = extractHeaderValue(headers['in-reply-to']);
        const references = extractHeaderValue(headers['references']);
        const fromHeader = parseEmailAddress(extractHeaderValue(headers['from']));
        const toHeader = parseEmailAddressList(extractHeaderValue(headers['to']));
        const subject = extractHeaderValue(headers['subject']) || '(No Subject)';
        const dateHeader = extractHeaderValue(headers['date']);
        const date = dateHeader ? new Date(dateHeader) : new Date();

        // Extract body (simple - for production, use proper MIME parser)
        const bodyTextContent = extractBodyText(bodyText);
        const bodyHtmlContent = extractBodyHtml(bodyText);

        // Extract attachments info
        const attachments: Array<{ filename: string; contentType: string; size: number }> = [];
        if (message.bodyStructure?.childNodes) {
          for (const node of message.bodyStructure.childNodes) {
            if (node.disposition === 'attachment' || node.disposition === 'inline') {
              // Type assertion needed - imapflow types don't expose contentType directly
              const nodeAny = node as any;
              attachments.push({
                filename: node.dispositionParameters?.filename || 'attachment',
                contentType: nodeAny.contentType || 'application/octet-stream',
                size: node.size || 0,
              });
            }
          }
        }

        processedMessages.push({
          uid,
          messageId,
          inReplyTo,
          references,
          from: fromHeader,
          to: toHeader,
          subject,
          bodyText: bodyTextContent,
          bodyHtml: bodyHtmlContent,
          date,
          headers: headers as Record<string, string | string[]>,
          attachments,
        });
      } catch (error) {
        console.error(`Error processing message ${uid} in mailbox ${mailbox.id}:`, error);
        // Continue with next message
      }
    }

    return processedMessages;
  } finally {
    try {
      await client.logout();
    } catch (e) {
      // Ignore logout errors
    }
  }
}

/**
 * Extract header value (handle arrays)
 */
function extractHeaderValue(value: string | string[] | undefined): string | null {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] || null;
  return value;
}

/**
 * Parse email address from header (simple version)
 */
function parseEmailAddress(header: string | null): { name?: string; address: string } {
  if (!header) return { address: '' };
  
  // Simple parsing: "Name <email@domain.com>" or "email@domain.com"
  const match = header.match(/^(?:([^<]+)<)?([^>]+@[^>]+)(?:>)?$/);
  if (match) {
    return {
      name: match[1]?.trim() || undefined,
      address: match[2]?.trim() || header.trim(),
    };
  }
  return { address: header.trim() };
}

/**
 * Parse email address list
 */
function parseEmailAddressList(header: string | null): Array<{ name?: string; address: string }> {
  if (!header) return [];
  
  // Split by comma and parse each
  return header.split(',').map(addr => parseEmailAddress(addr.trim()));
}

/**
 * Extract plain text body (simple MIME parsing)
 */
function extractBodyText(body: string): string | null {
  // Look for text/plain part
  const textPlainMatch = body.match(/Content-Type:\s*text\/plain[^]*?\r\n\r\n([^]*?)(?:\r\n--|$)/is);
  if (textPlainMatch) {
    return textPlainMatch[1].trim();
  }
  
  // If no MIME structure, return body as-is
  if (!body.includes('Content-Type:')) {
    return body.trim() || null;
  }
  
  return null;
}

/**
 * Extract HTML body (simple MIME parsing)
 */
function extractBodyHtml(body: string): string | null {
  // Look for text/html part
  const textHtmlMatch = body.match(/Content-Type:\s*text\/html[^]*?\r\n\r\n([^]*?)(?:\r\n--|$)/is);
  if (textHtmlMatch) {
    return textHtmlMatch[1].trim();
  }
  
  return null;
}

/**
 * Check if message is a bounce
 */
function isBounce(message: ProcessedMessage): boolean {
  const subject = message.subject.toLowerCase();
  const fromEmail = message.from.address.toLowerCase();
  const bodyText = (message.bodyText || '').toLowerCase();
  
  // Check subject patterns
  const bounceSubjects = [
    'undelivered',
    'delivery status',
    'mail delivery failed',
    'delivery failure',
    'returned mail',
    'mail system error',
  ];
  
  if (bounceSubjects.some(pattern => subject.includes(pattern))) {
    return true;
  }
  
  // Check from address patterns
  const bounceFroms = ['mailer-daemon', 'postmaster', 'mail delivery subsystem'];
  if (bounceFroms.some(pattern => fromEmail.includes(pattern))) {
    return true;
  }
  
  // Check body for SMTP error codes
  const smtpErrorCodes = ['550', '551', '552', '553', '554', '5.1.1', '5.1.2', '5.2.1', '5.2.2'];
  if (smtpErrorCodes.some(code => bodyText.includes(code))) {
    return true;
  }
  
  return false;
}

/**
 * Check if message is an unsubscribe request
 */
function isUnsubscribe(message: ProcessedMessage): boolean {
  const subject = (message.subject || '').toLowerCase();
  const bodyText = (message.bodyText || '').toLowerCase();
  const listUnsubscribe = extractHeaderValue(message.headers['list-unsubscribe'] as string | string[] | undefined);
  
  // Check List-Unsubscribe header
  if (listUnsubscribe) {
    return true;
  }
  
  // Check subject/body patterns
  const unsubscribePatterns = ['unsubscribe', 'opt-out', 'remove me', 'stop emails'];
  const combinedText = `${subject} ${bodyText}`;
  
  return unsubscribePatterns.some(pattern => combinedText.includes(pattern));
}

/**
 * Process a mailbox: fetch messages and handle replies/bounces/unsubscribes
 */
async function processMailbox(
  supabase: SupabaseClient,
  mailbox: any
): Promise<{ processed: number; replies: number; bounces: number; unsubscribes: number; errors: number }> {
  const results = {
    processed: 0,
    replies: 0,
    bounces: 0,
    unsubscribes: 0,
    errors: 0,
  };

  try {
    // Get last_synced_at
    const lastSyncedAt = mailbox.last_synced_at ? new Date(mailbox.last_synced_at) : null;

    // Fetch new messages
    const messages = await fetchNewMessages(mailbox, lastSyncedAt);
    console.log(`Found ${messages.length} new messages in mailbox ${mailbox.id}`);

    if (messages.length === 0) {
      // Update last_synced_at even if no messages (to avoid re-checking old messages)
      await supabase
        .from('mailboxes')
        .update({ last_synced_at: new Date().toISOString() })
        .eq('id', mailbox.id);
      return results;
    }

    // Process each message
    for (const message of messages) {
      try {
        results.processed++;

        // Check for bounce
        if (isBounce(message)) {
          await handleBounce(supabase, mailbox, message);
          results.bounces++;
          continue;
        }

        // Check for unsubscribe
        if (isUnsubscribe(message)) {
          await handleUnsubscribe(supabase, mailbox, message);
          results.unsubscribes++;
          continue;
        }

        // Check for reply (if In-Reply-To header exists)
        if (message.inReplyTo) {
          const handled = await handleReply(supabase, mailbox, message);
          if (handled) {
            results.replies++;
          } else {
            // Not a reply to our message - might be spam or unrelated
            console.log(`Message ${message.messageId} has In-Reply-To but doesn't match any sent message`);
          }
        }
      } catch (error) {
        console.error(`Error processing message ${message.uid} in mailbox ${mailbox.id}:`, error);
        results.errors++;
        // Continue with next message
      }
    }

    // Update last_synced_at after processing
    await supabase
      .from('mailboxes')
      .update({ last_synced_at: new Date().toISOString() })
      .eq('id', mailbox.id);

    return results;
  } catch (error) {
    console.error(`Error processing mailbox ${mailbox.id}:`, error);
    
    // Mark mailbox as error if it's an authentication issue
    if (error instanceof Error && (
      error.message.includes('authentication') ||
      error.message.includes('login') ||
      error.message.includes('credentials')
    )) {
      await supabase
        .from('mailboxes')
        .update({ 
          status: 'error',
          error_message: error.message,
        })
        .eq('id', mailbox.id);
    }
    
    throw error;
  }
}

/**
 * Handle a reply message
 */
async function handleReply(
  supabase: SupabaseClient,
  mailbox: any,
  message: ProcessedMessage
): Promise<boolean> {
  // Extract Message-ID from In-Reply-To (remove < > brackets if present)
  const inReplyToMessageId = message.inReplyTo?.replace(/^<|>$/g, '');
  if (!inReplyToMessageId) return false;

  // Find the original message_job by provider_message_id
  const { data: originalJob, error: jobError } = await supabase
    .from('message_jobs')
    .select(`
      *,
      enrollments(*),
      campaigns(*),
      leads(*),
      mailboxes(account_id, email_address)
    `)
    .eq('provider_message_id', inReplyToMessageId)
    .eq('status', 'sent')
    .maybeSingle();

  if (jobError || !originalJob) {
    return false; // Not a reply to our message
  }

  // Get or create email thread
  let thread = await getOrCreateThread(supabase, originalJob, mailbox);

  // Create email_message for the reply
  const { data: emailMessage, error: messageError } = await supabase
    .from('email_messages')
    .insert({
      thread_id: thread.id,
      message_job_id: null, // This is a received message
      direction: 'received',
      from_email: message.from.address,
      from_name: message.from.name || null,
      to_email: message.to[0]?.address || mailbox.email_address,
      to_name: message.to[0]?.name || null,
      subject: message.subject,
      body_text: message.bodyText,
      body_html: message.bodyHtml,
      message_id: message.messageId,
      in_reply_to: message.inReplyTo,
      message_references: message.references,
      received_at: message.date.toISOString(),
      headers: message.headers as any,
      attachments: message.attachments as any,
    })
    .select()
    .single();

  if (messageError) {
    console.error('Error creating email_message:', messageError);
    throw messageError;
  }

  // Update thread: set has_reply = true, update last_message_at, increment message_count
  await supabase
    .from('email_threads')
    .update({
      has_reply: true,
      last_message_at: message.date.toISOString(),
      message_count: thread.message_count + 1,
      participants: Array.from(new Set([
        ...(thread.participants || []),
        message.from.address,
        ...message.to.map(t => t.address),
      ])),
    })
    .eq('id', thread.id);

  // Stop the enrollment
  await supabase
    .from('enrollments')
    .update({ state: 'stopped' })
    .eq('id', originalJob.enrollment_id);

  console.log(`Reply detected and processed: message_job ${originalJob.id}, enrollment ${originalJob.enrollment_id} stopped`);
  return true;
}

/**
 * Get or create email thread for a message_job
 */
async function getOrCreateThread(
  supabase: SupabaseClient,
  messageJob: any,
  mailbox: any
): Promise<any> {
  // Check if thread already exists
  const { data: existingThread } = await supabase
    .from('email_threads')
    .select('*')
    .eq('message_job_id', messageJob.id)
    .maybeSingle();

  if (existingThread) {
    return existingThread;
  }

  // Get message data
  const messageData = messageJob.message_data || {};
  const subject = messageData.subject || messageData.node_config?.subject || '(No Subject)';

  // Get account_id from mailbox (from the relation or directly)
  const accountId = messageJob.mailboxes?.account_id || mailbox.account_id;
  const mailboxEmail = messageJob.mailboxes?.email_address || mailbox.email_address;
  const leadEmail = messageJob.leads?.email || '';

  // Create new thread
  const { data: newThread, error: threadError } = await supabase
    .from('email_threads')
    .insert({
      account_id: accountId,
      campaign_id: messageJob.campaign_id,
      lead_id: messageJob.lead_id,
      enrollment_id: messageJob.enrollment_id,
      message_job_id: messageJob.id,
      mailbox_id: messageJob.mailbox_id,
      subject: subject,
      participants: [mailboxEmail, leadEmail].filter(Boolean),
      last_message_at: messageJob.sent_at || messageJob.created_at,
      message_count: 1,
      has_reply: false, // Will be set to true when reply is received
    })
    .select()
    .single();

  if (threadError) {
    console.error('Error creating email_thread:', threadError);
    throw threadError;
  }

  return newThread;
}

/**
 * Handle a bounce message
 */
async function handleBounce(
  supabase: SupabaseClient,
  mailbox: any,
  message: ProcessedMessage
): Promise<void> {
  // Try to find the original message_job by matching recipient email
  // Bounces usually have the original recipient in the body or headers
  const recipientEmail = message.to[0]?.address;
  if (!recipientEmail) return;

  // Find recent sent message_jobs to this recipient from this mailbox
  const { data: recentJobs } = await supabase
    .from('message_jobs')
    .select('*, enrollments(*)')
    .eq('mailbox_id', mailbox.id)
    .eq('status', 'sent')
    .gte('sent_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()) // Last 7 days
    .order('sent_at', { ascending: false })
    .limit(10);

  if (!recentJobs || recentJobs.length === 0) return;

  // Try to match by recipient (from lead email)
  // For now, stop all recent enrollments from this mailbox (conservative approach)
  // In production, you might want more sophisticated matching
  for (const job of recentJobs) {
    await supabase
      .from('enrollments')
      .update({ state: 'stopped' })
      .eq('id', job.enrollment_id);
  }

  console.log(`Bounce detected in mailbox ${mailbox.id}, stopped ${recentJobs.length} enrollments`);
}

/**
 * Handle an unsubscribe message
 */
async function handleUnsubscribe(
  supabase: SupabaseClient,
  mailbox: any,
  message: ProcessedMessage
): Promise<void> {
  // Similar to bounce - find recent enrollments and stop them
  const recipientEmail = message.to[0]?.address;
  if (!recipientEmail) return;

  // Find recent sent message_jobs to this recipient
  const { data: recentJobs } = await supabase
    .from('message_jobs')
    .select('*, enrollments(*)')
    .eq('mailbox_id', mailbox.id)
    .eq('status', 'sent')
    .gte('sent_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()) // Last 30 days
    .order('sent_at', { ascending: false })
    .limit(50);

  if (!recentJobs || recentJobs.length === 0) return;

  // Stop enrollments for this recipient
  const enrollmentIds = new Set(recentJobs.map(j => j.enrollment_id));
  for (const enrollmentId of enrollmentIds) {
    await supabase
      .from('enrollments')
      .update({ state: 'stopped' })
      .eq('id', enrollmentId);
  }

  console.log(`Unsubscribe detected in mailbox ${mailbox.id}, stopped ${enrollmentIds.size} enrollments`);
}

export const handler: EventBridgeHandler<'Scheduled Event', null, void> = async (event) => {
  console.log('Inbox checker triggered:', JSON.stringify(event, null, 2));

  // Initialize clients
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
  const awsRegion = process.env.AWS_REGION;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing required environment variables: EXPO_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_KEY');
  }

  if (!awsRegion) {
    throw new Error('AWS_REGION is not set in Lambda runtime environment');
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // Query active mailboxes
    const { data: mailboxes, error: queryError } = await supabase
      .from('mailboxes')
      .select('*')
      .eq('sync_enabled', true)
      .eq('status', 'connected');

    if (queryError) {
      console.error('Error querying mailboxes:', queryError);
      throw queryError;
    }

    console.log(`Found ${mailboxes?.length || 0} active mailboxes to check`);

    if (!mailboxes || mailboxes.length === 0) {
      console.log('No active mailboxes to check');
      return;
    }

    // Process each mailbox
    const overallResults = {
      mailboxesProcessed: 0,
      mailboxesErrors: 0,
      totalMessages: 0,
      totalReplies: 0,
      totalBounces: 0,
      totalUnsubscribes: 0,
    };

    for (const mailbox of mailboxes) {
      try {
        console.log(`Processing mailbox ${mailbox.id} (${mailbox.email_address})`);
        
        const results = await processMailbox(supabase, mailbox);
        
        overallResults.mailboxesProcessed++;
        overallResults.totalMessages += results.processed;
        overallResults.totalReplies += results.replies;
        overallResults.totalBounces += results.bounces;
        overallResults.totalUnsubscribes += results.unsubscribes;

        console.log(`Mailbox ${mailbox.id} processed:`, results);
      } catch (error) {
        console.error(`Error processing mailbox ${mailbox.id}:`, error);
        overallResults.mailboxesErrors++;
        // Continue with next mailbox
      }
    }

    console.log('Inbox checker completed:', {
      ...overallResults,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Fatal error in inbox checker:', error);
    throw error;
  }
};
