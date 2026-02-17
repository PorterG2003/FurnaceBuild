import { SupabaseClient, createClient } from '@supabase/supabase-js';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import type { EventBridgeHandler } from 'aws-lambda';
import { isBounce as isBounceShared, extractCandidateEmails, classifyBounce } from './bounce-detection/index.js';

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
  attachments: Array<{ filename: string; contentType: string; size: number; part: string; imapUid: number }>;
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
        const rawBuffer = Buffer.concat(chunks);

        // Parse RFC822 safely: decodes quoted-printable/base64/charset correctly.
        const mail = await simpleParser(rawBuffer);
        const refs = mail.references;
        const references = refs == null ? null : Array.isArray(refs) ? refs[0] ?? null : refs;
        const fromHeader = addressToFrom(mail.from);
        const toHeader = addressesToTo(mail.to);
        const subject = mail.subject ?? '(No Subject)';
        const date = mail.date ?? new Date();
        const bodyTextContent = typeof mail.text === 'string' ? mail.text.trim() : null;
        const bodyHtmlContent = typeof mail.html === 'string' ? mail.html.trim() : null;
        const headers = mailHeadersToRecord(mail.headers as Map<string, unknown>);

        // Extract attachments info (with part and imapUid for on-demand fetching)
        const extractAttachments = (
          nodes: any[],
          parentPart = ''
        ): Array<{ filename: string; contentType: string; size: number; part: string; imapUid: number }> => {
          const result: Array<{ filename: string; contentType: string; size: number; part: string; imapUid: number }> = [];
          if (!nodes?.length) return result;
          nodes.forEach((node, index) => {
            const partIndex = index + 1;
            const part = parentPart ? `${parentPart}.${partIndex}` : `${partIndex}`;
            if (node.disposition === 'attachment' || node.disposition === 'inline') {
              const nodeAny = node as any;
              result.push({
                filename: node.dispositionParameters?.filename || 'attachment',
                contentType: nodeAny.contentType || 'application/octet-stream',
                size: node.size || 0,
                part,
                imapUid: uid,
              });
            }
            if (node.childNodes?.length) {
              result.push(...extractAttachments(node.childNodes, part));
            }
          });
          return result;
        };
        const attachments = message.bodyStructure?.childNodes
          ? extractAttachments(message.bodyStructure.childNodes)
          : [];

        processedMessages.push({
          uid,
          messageId: mail.messageId ?? null,
          inReplyTo: mail.inReplyTo ?? null,
          references,
          from: fromHeader,
          to: toHeader,
          subject,
          bodyText: bodyTextContent || null,
          bodyHtml: bodyHtmlContent || null,
          date,
          headers,
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

function addressToFrom(addr: any): { name?: string; address: string } {
  if (!addr?.value?.[0]) return { address: '' };
  const v = addr.value[0];
  return {
    name: v.name || undefined,
    address: v.address || (typeof v === 'string' ? v : ''),
  };
}

function addressesToTo(addr: any): Array<{ name?: string; address: string }> {
  if (!addr?.value) return [];
  return addr.value.map((v: any) => ({
    name: v.name || undefined,
    address: v.address || (typeof v === 'string' ? v : ''),
  }));
}

function mailHeadersToRecord(headers: Map<string, unknown>): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  if (!headers) return out;
  for (const [key, value] of headers.entries()) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      out[key] = value.map((v) => (typeof v === 'string' ? v : String(v)));
    } else if (typeof value === 'string') {
      out[key] = value;
    } else if (typeof (value as any)?.text === 'string') {
      out[key] = (value as any).text;
    } else {
      out[key] = String(value);
    }
  }
  return out;
}

function isBounce(message: ProcessedMessage): boolean {
  return isBounceShared({
    subject: message.subject,
    from: message.from,
    to: message.to,
    bodyText: message.bodyText,
    bodyHtml: message.bodyHtml,
    headers: message.headers,
    messageId: message.messageId,
    uid: message.uid,
  });
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
      imap_uid: message.uid,
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

  const isCampaignReply =
    originalJob.message_type !== 'inbox_reply' &&
    originalJob.message_type !== 'inbox_forward' &&
    originalJob.message_data?.source !== 'inbox_reply' &&
    originalJob.message_data?.source !== 'inbox_forward';

  if (isCampaignReply) {
    await supabase.from('events').insert({
      campaign_id: originalJob.campaign_id,
      lead_id: originalJob.lead_id,
      enrollment_id: originalJob.enrollment_id,
      message_job_id: originalJob.id,
      event_type: 'replied',
      event_data: { detected_at: new Date().toISOString() },
    });
    const isPositive = thread.category === 'Interested';
    await supabase.rpc('increment_campaign_stats_replied', {
      p_campaign_id: originalJob.campaign_id,
      p_is_positive: isPositive,
    });
  }

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
 * Handle a bounce: idempotency, match to message_jobs, events (with severity/code),
 * campaign_stats, narrow fallback (stop only best-guess when no match), lead suppression on hard bounce.
 */
async function handleBounce(
  supabase: SupabaseClient,
  mailbox: any,
  message: ProcessedMessage
): Promise<void> {
  if (message.messageId) {
    const { data: existingByMsgId } = await supabase
      .from('events')
      .select('id')
      .eq('event_type', 'bounced')
      .eq('mailbox_id', mailbox.id)
      .filter('event_data', 'cs', { bounce_message_id: message.messageId })
      .limit(1)
      .maybeSingle();
    if (existingByMsgId?.id) {
      console.log(`[INBOX CHECKER] Bounce already processed (idempotency), skipping messageId: ${message.messageId}`);
      return;
    }
  } else if (message.uid != null) {
    const { data: existingByUid } = await supabase
      .from('events')
      .select('id')
      .eq('event_type', 'bounced')
      .eq('mailbox_id', mailbox.id)
      .filter('event_data', 'cs', { bounce_uid: message.uid })
      .limit(1)
      .maybeSingle();
    if (existingByUid?.id) {
      console.log(`[INBOX CHECKER] Bounce already processed (idempotency), skipping uid: ${message.uid}`);
      return;
    }
  }

  const candidateEmails = extractCandidateEmails({
    subject: message.subject,
    from: message.from,
    to: message.to,
    bodyText: message.bodyText,
    bodyHtml: message.bodyHtml,
    headers: message.headers,
    messageId: message.messageId,
    uid: message.uid,
  });
  if (candidateEmails.length === 0) return;

  const classification = classifyBounce({ bodyText: message.bodyText, bodyHtml: message.bodyHtml });
  const eventDataBase: Record<string, unknown> = {
    detected_at: new Date().toISOString(),
    severity: classification.severity,
    ...(classification.smtpCode && { smtp_code: classification.smtpCode }),
    ...(message.messageId && { bounce_message_id: message.messageId }),
    ...(message.uid != null && { bounce_uid: message.uid }),
  };

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: jobsWithLeads } = await supabase
    .from('message_jobs')
    .select('id, campaign_id, enrollment_id, lead_id, sent_at')
    .eq('mailbox_id', mailbox.id)
    .eq('status', 'sent')
    .gte('sent_at', since)
    .order('sent_at', { ascending: false })
    .limit(100);

  if (!jobsWithLeads || jobsWithLeads.length === 0) return;

  const { data: account } = await supabase
    .from('accounts')
    .select('suppress_bounced_emails')
    .eq('id', mailbox.account_id)
    .single();
  const suppressBouncedEmails = account?.suppress_bounced_emails !== false;

  const leadIds = [...new Set(jobsWithLeads.map((j) => j.lead_id))];
  const { data: leads } = await supabase
    .from('leads')
    .select('id, email')
    .in('id', leadIds);
  const leadEmailById = new Map((leads || []).map((l) => [l.id, (l.email || '').toLowerCase()]));

  const candidateSet = new Set(candidateEmails);
  const matchedJobs = jobsWithLeads.filter((j) => candidateSet.has(leadEmailById.get(j.lead_id) || ''));

  const campaignIdsUpdated = new Set<string>();
  const enrollmentsToStop: string[] = [];

  if (matchedJobs.length > 0) {
    enrollmentsToStop.push(...matchedJobs.map((j) => j.enrollment_id));
    for (const job of matchedJobs) {
      await supabase.from('events').insert({
        campaign_id: job.campaign_id,
        lead_id: job.lead_id,
        enrollment_id: job.enrollment_id,
        message_job_id: job.id,
        mailbox_id: mailbox.id,
        event_type: 'bounced',
        event_data: eventDataBase,
      });
      if (!campaignIdsUpdated.has(job.campaign_id)) {
        campaignIdsUpdated.add(job.campaign_id);
        await supabase.rpc('increment_campaign_stats_bounce', { p_campaign_id: job.campaign_id });
      }
      if (classification.severity === 'hard' && suppressBouncedEmails) {
        const leadEmail = leadEmailById.get(job.lead_id);
        if (leadEmail) {
          await supabase.from('block_list').upsert(
            { account_id: mailbox.account_id, value: leadEmail, type: 'email', reason: 'bounced' },
            { onConflict: 'account_id,value,type', ignoreDuplicates: true }
          );
        }
      }
    }
  } else {
    const bestGuess = jobsWithLeads[0];
    if (bestGuess) {
      enrollmentsToStop.push(bestGuess.enrollment_id);
      await supabase.from('events').insert({
        campaign_id: bestGuess.campaign_id,
        lead_id: bestGuess.lead_id,
        enrollment_id: bestGuess.enrollment_id,
        message_job_id: bestGuess.id,
        mailbox_id: mailbox.id,
        event_type: 'bounced',
        event_data: { ...eventDataBase, matched: false },
      });
      await supabase.rpc('increment_campaign_stats_bounce', { p_campaign_id: bestGuess.campaign_id });
      if (classification.severity === 'hard' && suppressBouncedEmails) {
        const leadEmail = leadEmailById.get(bestGuess.lead_id);
        if (leadEmail) {
          await supabase.from('block_list').upsert(
            { account_id: mailbox.account_id, value: leadEmail, type: 'email', reason: 'bounced' },
            { onConflict: 'account_id,value,type', ignoreDuplicates: true }
          );
        }
      }
    }
  }

  for (const enrollmentId of enrollmentsToStop) {
    await supabase.from('enrollments').update({ state: 'stopped' }).eq('id', enrollmentId);
  }

  console.log(`Bounce detected in mailbox ${mailbox.id}, stopped ${enrollmentsToStop.length} enrollments, severity=${classification.severity}`);
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

  // Runtime guard: disable Lambda ingestion when ECS inbox-checker-worker is active.
  if (String(process.env.INBOX_CHECKER_LAMBDA_ENABLED ?? 'true').toLowerCase() !== 'true') {
    console.log('INBOX_CHECKER_LAMBDA_ENABLED=false, skipping Lambda inbox check run');
    return;
  }

  // Initialize clients
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
  const awsRegion = process.env.AWS_REGION;

  if (!supabaseUrl || !supabaseSecretKey) {
    throw new Error('Missing required environment variables: EXPO_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY');
  }

  if (!awsRegion) {
    throw new Error('AWS_REGION is not set in Lambda runtime environment');
  }

  const supabase = createClient(supabaseUrl, supabaseSecretKey);

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
