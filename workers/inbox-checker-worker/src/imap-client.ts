import { reportErrorToSlack } from '@furnace/slack-lib';
import {
  buildImapFlowOptions,
  createImapFlowErrorGuard,
} from '@furnace/mailbox-lib';
import { openImapInbox } from '@furnace/mailbox-lib';
import { normalizeThreadTopic, parseMessageIds } from '@furnace/email-lib';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { countReferenceTokens, getHeaderCi, logParseDiagnostics } from './parse-diagnostics.js';
import type { Mailbox, ProcessedMessage } from './types.js';

/**
 * IMAP client for connecting to mailboxes and fetching messages
 */
export class ImapClient {
  /**
   * Connect to IMAP and fetch new messages since last_synced_at
   */
  async fetchNewMessages(
    mailbox: Mailbox,
    lastSyncedAt: Date | null
  ): Promise<ProcessedMessage[]> {
    const client = new ImapFlow(
      buildImapFlowOptions({
        host: mailbox.imap_host,
        port: mailbox.imap_port,
        username: mailbox.imap_username,
        password: mailbox.imap_password,
        useSSL: mailbox.imap_use_ssl,
      }),
    );
    const guard = createImapFlowErrorGuard(client);

    try {
      await client.connect();
      guard.throwIfError();
      await openImapInbox(client);
      guard.throwIfError();

      // Build search criteria: messages since last_synced_at (or last 7 days if never synced)
      let searchCriteria: any;
      if (lastSyncedAt) {
        searchCriteria = { since: lastSyncedAt };
        console.log(`[IMAP] Searching ${mailbox.email_address} since=${lastSyncedAt.toISOString()}`);
      } else {
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        searchCriteria = { since: sevenDaysAgo };
        console.log(`[IMAP] Searching ${mailbox.email_address} (first sync) since=${sevenDaysAgo.toISOString()}`);
      }

      const messages = await client.search(searchCriteria, { uid: true });
      guard.throwIfError();

      // Handle search result (can be false or number[])
      if (!messages || (Array.isArray(messages) && messages.length === 0)) {
        console.log(`[IMAP] Search returned 0 UIDs for ${mailbox.email_address}`);
        return [];
      }

      const messageUids: number[] = Array.isArray(messages) ? messages : [];
      console.log(`[IMAP] Search returned ${messageUids.length} UID(s) for ${mailbox.email_address}`);
      if (messageUids.length === 0) {
        return [];
      }

      // Fetch and parse messages
      const processedMessages: ProcessedMessage[] = [];
      
      for (const uid of messageUids) {
        try {
          // Pass { uid: true } as options so ImapFlow sends "UID FETCH" not "FETCH".
          // (search returns UIDs; using them as sequence numbers causes "Invalid messageset".)
          const message = await client.fetchOne(uid, {
            source: true,
            uid: true,
            bodyStructure: true,
          }, { uid: true });

          guard.throwIfError();
          if (!message) continue;

          // Parse message
          const parsed = await this.parseMessage(uid, message, client, mailbox);
          guard.throwIfError();
          processedMessages.push(parsed);
        } catch (error) {
          console.error(`Error processing message ${uid} in mailbox ${mailbox.id}:`, error);
          const msg = error instanceof Error ? error.message : String(error);
          reportErrorToSlack('Inbox-checker: initial email parse failed (download or MIME parse)', {
            severity: 'warning',
            mailbox_id: mailbox.id,
            email_address: mailbox.email_address,
            imap_uid: String(uid),
            error: msg,
          });
          // Continue with next message
        }
      }

      return processedMessages;
    } finally {
      guard.dispose();
      try {
        await client.logout();
      } catch (e) {
        // Ignore logout errors
      }
    }
  }

  /**
   * Parse a raw email message using mailparser for proper MIME decoding
   * (quoted-printable, base64, charsets). BodyStructure is still used for
   * attachment part identifiers (for on-demand fetch).
   */
  private async parseMessage(
    uid: number,
    message: any,
    client: ImapFlow,
    mailbox: Mailbox
  ): Promise<ProcessedMessage> {
    // Download full RFC822 message (part undefined). Options.uid so range is UID not sequence.
    const parsed = await client.download(uid, undefined, { uid: true });

    // Read the stream content as raw Buffer (mailparser handles encoding)
    const chunks: Buffer[] = [];
    for await (const chunk of parsed.content) {
      chunks.push(Buffer.from(chunk));
    }
    const rawBuffer = Buffer.concat(chunks);

    // Use mailparser for proper MIME decoding (quoted-printable, base64, charsets)
    const mail = await simpleParser(rawBuffer);

    const fromHeader = this.addressToFrom(mail.from);
    const toHeader = this.addressesToTo(mail.to);
    const headers = this.mailHeadersToRecord(mail.headers);

    const refs = mail.references;
    const referencesRawForDiag =
      refs == null ? null : Array.isArray(refs) ? refs.filter(Boolean).join(' ') : String(refs);

    const mailAddrs = mail as typeof mail & {
      sender?: { value?: Array<{ address?: string; name?: string }> };
    };

    logParseDiagnostics({
      mailboxId: mailbox.id,
      mailboxEmail: mailbox.email_address,
      imapUid: uid,
      subject: mail.subject ?? '',
      fromAddress: fromHeader.address,
      fromName: fromHeader.name,
      replyTo: mail.replyTo,
      sender: mailAddrs.sender,
      messageId: mail.messageId ?? null,
      inReplyTo: mail.inReplyTo ?? null,
      referencesRaw: referencesRawForDiag,
      referencesTokenCount: countReferenceTokens(referencesRawForDiag),
      returnPath: getHeaderCi(headers, 'return-path'),
    });

    // Extract attachments info (use bodyStructure for part IDs - required for on-demand fetch)
    // Helper function to recursively extract attachments with part identifiers
    const extractAttachments = (
      nodes: any[],
      parentPart: string = '',
      depth: number = 0
    ): Array<{ filename: string; contentType: string; size: number; part: string; imapUid: number }> => {
      const attachments: Array<{ filename: string; contentType: string; size: number; part: string; imapUid: number }> = [];
      
      if (!nodes || !Array.isArray(nodes)) return attachments;
      
      nodes.forEach((node, index) => {
        // Build part identifier (1-based index)
        const partIndex = index + 1;
        const part = parentPart ? `${parentPart}.${partIndex}` : `${partIndex}`;
        
        // Check if this node is an attachment
        if (node.disposition === 'attachment' || node.disposition === 'inline') {
          attachments.push({
            filename: node.dispositionParameters?.filename || 'attachment',
            contentType: node.contentType || 'application/octet-stream',
            size: node.size || 0,
            part: part, // MIME part identifier for on-demand fetching
            imapUid: uid, // Store message UID for on-demand fetching
          });
        }
        
        // Recursively process child nodes (for nested MIME structures)
        if (node.childNodes && Array.isArray(node.childNodes)) {
          const childAttachments = extractAttachments(node.childNodes, part, depth + 1);
          attachments.push(...childAttachments);
        }
      });
      
      return attachments;
    };
    
    const attachments = message.bodyStructure?.childNodes 
      ? extractAttachments(message.bodyStructure.childNodes)
      : [];

    // Preserve every References token (mailparser may return string | string[]).
    const references =
      refs == null
        ? null
        : Array.isArray(refs)
          ? refs.filter(Boolean).join(' ')
          : String(refs);
    const referenceMessageIds = parseMessageIds(refs ?? null);

    const threadTopic = normalizeThreadTopic(getHeaderCi(headers, 'thread-topic'));
    const threadIndexRaw = getHeaderCi(headers, 'thread-index');
    const threadIndex = threadIndexRaw?.trim() || null;

    const textBody = typeof mail.text === 'string' ? mail.text.trim() : null;
    const htmlBody = typeof mail.html === 'string' ? mail.html.trim() : null;

    return {
      uid,
      messageId: mail.messageId ?? null,
      inReplyTo: mail.inReplyTo ?? null,
      references,
      referenceMessageIds,
      threadTopic,
      threadIndex,
      from: fromHeader,
      to: toHeader,
      subject: mail.subject ?? '(No Subject)',
      bodyText: textBody || null,
      bodyHtml: htmlBody || null,
      date: mail.date ?? new Date(),
      headers,
      attachments,
    };
  }

  private addressToFrom(addr: any): { name?: string; address: string } {
    if (!addr?.value?.[0]) return { address: '' };
    const v = addr.value[0];
    return {
      name: v.name || undefined,
      address: v.address || (typeof v === 'string' ? v : ''),
    };
  }

  private addressesToTo(addr: any): Array<{ name?: string; address: string }> {
    if (!addr?.value) return [];
    return addr.value.map((v: any) => ({
      name: v.name || undefined,
      address: v.address || (typeof v === 'string' ? v : ''),
    }));
  }

  private mailHeadersToRecord(headers: Map<string, any>): Record<string, string | string[]> {
    const out: Record<string, string | string[]> = {};
    if (!headers) return out;
    for (const [key, value] of headers.entries()) {
      if (value == null) continue;
      if (Array.isArray(value)) {
        out[key] = value.map((v) => (typeof v === 'string' ? v : String(v)));
      } else if (typeof value === 'string') {
        out[key] = value;
      } else if (value?.text) {
        out[key] = value.text;
      } else {
        out[key] = String(value);
      }
    }
    return out;
  }
}
