import { ImapFlow } from 'imapflow';
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
        console.log(`[IMAP] Searching ${mailbox.email_address} since=${lastSyncedAt.toISOString()}`);
      } else {
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        searchCriteria = { since: sevenDaysAgo };
        console.log(`[IMAP] Searching ${mailbox.email_address} (first sync) since=${sevenDaysAgo.toISOString()}`);
      }

      const messages = await client.search(searchCriteria, { uid: true });

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

          if (!message) continue;

          // Parse message
          const parsed = await this.parseMessage(uid, message, client);
          processedMessages.push(parsed);
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
   * Parse a raw email message
   */
  private async parseMessage(
    uid: number,
    message: any,
    client: ImapFlow
  ): Promise<ProcessedMessage> {
    // Download full RFC822 message (part undefined). Options.uid so range is UID not sequence.
    const parsed = await client.download(uid, undefined, { uid: true });
    
    // Read the stream content
    const chunks: Buffer[] = [];
    for await (const chunk of parsed.content) {
      chunks.push(Buffer.from(chunk));
    }
    const rawMessage = Buffer.concat(chunks).toString('utf-8');
    
    // Simple email parsing (for production, consider using mailparser library)
    const headers: Record<string, string | string[]> = {};
    const headerEnd = rawMessage.indexOf('\r\n\r\n');
    if (headerEnd === -1) {
      throw new Error('Invalid email format: no header/body separator');
    }
    const headerText = rawMessage.substring(0, headerEnd);
    const bodyText = rawMessage.substring(headerEnd + 4);

    // Parse headers
    for (const line of headerText.split('\r\n')) {
      // Handle line folding (continuation lines start with space/tab)
      if (line.match(/^\s/)) {
        // Continuation line - append to last header
        const lastKey = Object.keys(headers).pop();
        if (lastKey) {
          const existing = headers[lastKey];
          headers[lastKey] = (Array.isArray(existing) ? existing[existing.length - 1] : existing) + ' ' + line.trim();
        }
        continue;
      }

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
    const messageId = this.extractHeaderValue(headers['message-id']);
    const inReplyTo = this.extractHeaderValue(headers['in-reply-to']);
    const references = this.extractHeaderValue(headers['references']);
    const fromHeader = this.parseEmailAddress(this.extractHeaderValue(headers['from']));
    const toHeader = this.parseEmailAddressList(this.extractHeaderValue(headers['to']));
    const subject = this.extractHeaderValue(headers['subject']) || '(No Subject)';
    const dateHeader = this.extractHeaderValue(headers['date']);
    const date = dateHeader ? new Date(dateHeader) : new Date();

    // Extract body (simple - for production, use proper MIME parser)
    const bodyTextContent = this.extractBodyText(bodyText);
    const bodyHtmlContent = this.extractBodyHtml(bodyText);

    // Extract attachments info
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

    return {
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
    };
  }

  /**
   * Extract header value (handle arrays)
   */
  private extractHeaderValue(value: string | string[] | undefined): string | null {
    if (!value) return null;
    if (Array.isArray(value)) return value[0] || null;
    return value;
  }

  /**
   * Parse email address from header (simple version)
   */
  private parseEmailAddress(header: string | null): { name?: string; address: string } {
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
  private parseEmailAddressList(header: string | null): Array<{ name?: string; address: string }> {
    if (!header) return [];
    
    // Split by comma and parse each
    return header.split(',').map(addr => this.parseEmailAddress(addr.trim()));
  }

  /**
   * Extract plain text body (simple MIME parsing)
   */
  private extractBodyText(body: string): string | null {
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
  private extractBodyHtml(body: string): string | null {
    // Look for text/html part
    const textHtmlMatch = body.match(/Content-Type:\s*text\/html[^]*?\r\n\r\n([^]*?)(?:\r\n--|$)/is);
    if (textHtmlMatch) {
      return textHtmlMatch[1].trim();
    }
    
    return null;
  }
}
