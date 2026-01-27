import type { ProcessedMessage } from './types.js';

/**
 * Message processor for detecting replies, bounces, and unsubscribes
 */
export class MessageProcessor {
  /**
   * Check if message is a bounce
   */
  isBounce(message: ProcessedMessage): boolean {
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
   * Check if message is a reply (has In-Reply-To header)
   */
  isReply(message: ProcessedMessage): boolean {
    return !!message.inReplyTo;
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
