import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type { Mailbox } from './types.js';

interface CachedTransporter {
  transporter: Transporter;
  mailboxId: string;
  messagesSent: number;
  lastUsedAt: number;
  createdAt: number;
}

/**
 * SMTP Connection Pool Manager
 * 
 * Manages a cache of SMTP transporters to reuse connections across multiple emails.
 * Uses LRU eviction to limit memory usage.
 */
export class SmtpPool {
  private cache: Map<string, CachedTransporter> = new Map();
  private readonly maxCacheSize: number;
  private readonly maxIdleTime: number = 60 * 1000; // 1 minute in milliseconds

  constructor(maxCacheSize: number = 100) {
    this.maxCacheSize = maxCacheSize;
  }

  /**
   * Get or create a transporter for a mailbox
   * Reuses existing transporter if available and healthy
   */
  async getTransporter(mailbox: Mailbox): Promise<Transporter> {
    const cached = this.cache.get(mailbox.id);

    // Check if we have a cached transporter
    if (cached) {
      // Check if transporter has exceeded maxMessages limit
      const maxMessages = mailbox.smtp_messages_per_connection ?? 100;
      if (cached.messagesSent >= maxMessages) {
        console.log(`[SMTP POOL] Transporter for mailbox ${mailbox.id} reached maxMessages (${maxMessages}), recreating`);
        this.removeTransporter(mailbox.id);
        return this.createAndCacheTransporter(mailbox);
      }

      // Check if connection is still healthy (if idle > 1 minute)
      const idleTime = Date.now() - cached.lastUsedAt;
      if (idleTime > this.maxIdleTime) {
        // Try to verify connection is still alive
        try {
          await cached.transporter.verify();
          console.log(`[SMTP POOL] Verified connection for mailbox ${mailbox.id} is still healthy`);
        } catch (error) {
          console.log(`[SMTP POOL] Connection for mailbox ${mailbox.id} is unhealthy, recreating:`, error);
          this.removeTransporter(mailbox.id);
          return this.createAndCacheTransporter(mailbox);
        }
      }

      // Update last used time and return cached transporter
      cached.lastUsedAt = Date.now();
      return cached.transporter;
    }

    // No cached transporter - create new one
    // Check if we need to evict (LRU)
    if (this.cache.size >= this.maxCacheSize) {
      this.evictLRU();
    }

    return this.createAndCacheTransporter(mailbox);
  }

  /**
   * Create a new transporter and cache it
   */
  private createAndCacheTransporter(mailbox: Mailbox): Transporter {
    const transporter = nodemailer.createTransport({
      host: mailbox.smtp_host,
      port: mailbox.smtp_port,
      secure: mailbox.smtp_use_ssl,
      requireTLS: mailbox.smtp_use_tls,
      auth: {
        user: mailbox.smtp_username,
        pass: mailbox.smtp_password,
      },
      pool: true,
      maxConnections: mailbox.smtp_connection_limit ?? 5,
      maxMessages: mailbox.smtp_messages_per_connection ?? 100,
    });

    const cached: CachedTransporter = {
      transporter,
      mailboxId: mailbox.id,
      messagesSent: 0,
      lastUsedAt: Date.now(),
      createdAt: Date.now(),
    };

    this.cache.set(mailbox.id, cached);
    console.log(`[SMTP POOL] Created and cached transporter for mailbox ${mailbox.id} (cache size: ${this.cache.size})`);

    return transporter;
  }

  /**
   * Mark that a message was sent using this transporter
   * Call this after successfully sending an email
   */
  markMessageSent(mailboxId: string): void {
    const cached = this.cache.get(mailboxId);
    if (cached) {
      cached.messagesSent++;
      cached.lastUsedAt = Date.now();
    }
  }

  /**
   * Remove transporter from cache (e.g., on error)
   */
  removeTransporter(mailboxId: string): void {
    const cached = this.cache.get(mailboxId);
    if (cached) {
      try {
        // Close the transporter's connections
        cached.transporter.close();
      } catch (error: any) {
        // Ignore errors when closing
        console.warn(`[SMTP POOL] Error closing transporter for mailbox ${mailboxId}:`, error);
      }
      this.cache.delete(mailboxId);
      console.log(`[SMTP POOL] Removed transporter for mailbox ${mailboxId} from cache`);
    }
  }

  /**
   * Evict least recently used transporter (LRU eviction)
   */
  private evictLRU(): void {
    if (this.cache.size === 0) return;

    let oldest: { mailboxId: string; lastUsedAt: number } | null = null;

    for (const [mailboxId, cached] of this.cache.entries()) {
      if (!oldest || cached.lastUsedAt < oldest.lastUsedAt) {
        oldest = { mailboxId, lastUsedAt: cached.lastUsedAt };
      }
    }

    if (oldest) {
      console.log(`[SMTP POOL] Evicting LRU transporter for mailbox ${oldest.mailboxId} (cache at limit: ${this.maxCacheSize})`);
      this.removeTransporter(oldest.mailboxId);
    }
  }

  /**
   * Close all transporters (for graceful shutdown)
   */
  async closeAll(): Promise<void> {
    console.log(`[SMTP POOL] Closing all ${this.cache.size} cached transporters...`);

    for (const [mailboxId, cached] of this.cache.entries()) {
      try {
        cached.transporter.close();
      } catch (error: any) {
        console.warn(`[SMTP POOL] Error closing transporter for mailbox ${mailboxId}:`, error);
      }
    }

    this.cache.clear();
    console.log(`[SMTP POOL] All transporters closed`);
  }

  /**
   * Get cache stats (for debugging)
   */
  getStats(): { size: number; maxSize: number; mailboxes: string[] } {
    return {
      size: this.cache.size,
      maxSize: this.maxCacheSize,
      mailboxes: Array.from(this.cache.keys()),
    };
  }
}
