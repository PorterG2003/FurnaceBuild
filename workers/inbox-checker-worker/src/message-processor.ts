import type { ProcessedMessage } from './types.js';
import { isBounce as isBounceShared } from './bounce-detection/index.js';

/**
 * Message processor for detecting replies, bounces, and unsubscribes
 */
export class MessageProcessor {
  /**
   * Check if message is a bounce (uses shared bounce-detection module)
   */
  isBounce(message: ProcessedMessage): boolean {
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
  isUnsubscribe(message: ProcessedMessage): boolean {
    const listUnsubscribe = this.extractHeaderValue(message.headers['list-unsubscribe']);
    if (listUnsubscribe) {
      return true;
    }
    
    const subject = (message.subject || '').toLowerCase();
    const bodyText = (message.bodyText || '').toLowerCase();
    const combinedText = `${subject} ${bodyText}`;
    
    const unsubscribePatterns = ['unsubscribe', 'opt-out', 'remove me', 'stop emails'];
    return unsubscribePatterns.some(pattern => combinedText.includes(pattern));
  }

  /**
   * Check if message is a reply (has threading headers: In-Reply-To or References)
   */
  isReply(message: ProcessedMessage): boolean {
    return !!message.inReplyTo?.trim() || !!message.references?.trim();
  }

  /**
   * Extract header value (handle arrays)
   */
  private extractHeaderValue(value: string | string[] | undefined): string | null {
    if (!value) return null;
    if (Array.isArray(value)) return value[0] || null;
    return value;
  }
}
