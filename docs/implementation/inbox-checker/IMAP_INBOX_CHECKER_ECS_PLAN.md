# IMAP Inbox Checker - ECS Worker Implementation Plan

**Date**: January 21, 2026  
**Status**: Planning  
**Replaces**: Lambda-based inbox checker (moved to ECS for scale)

---

## Executive Summary

**Problem**: Lambda-based inbox checker cannot handle thousands of mailboxes due to:
- 5-minute timeout limit
- Sequential processing (too slow)
- Need for long-running process

**Solution**: ECS Fargate worker (similar to send-worker/scheduler-worker) that:
- Runs continuously (no timeout limits)
- Processes mailboxes in parallel
- Uses atomic claiming to prevent duplicates
- Scales based on queue depth

---

## Architecture Overview

### High-Level Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    Supabase Database                         │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  mailboxes table                                     │   │
│  │  - status = 'connected'                              │   │
│  │  - email_address NOT LIKE '%@furnace.test'            │   │
│  │  - last_synced_at < NOW() - 5 minutes                │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                          │
                          │ claim_mailboxes_to_check()
                          │ (atomic UPDATE)
                          ▼
┌─────────────────────────────────────────────────────────────┐
│              Inbox Checker Worker (ECS)                      │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  1. Poll database for mailboxes to check             │   │
│  │  2. Claim batch (e.g., 50 mailboxes)                 │   │
│  │  3. Process in parallel (concurrency limit: 10)       │   │
│  │     - Connect to IMAP                                │   │
│  │     - Fetch new messages                              │   │
│  │     - Detect replies/bounces/unsubscribes            │   │
│  │     - Create email_threads/email_messages            │   │
│  │     - Update enrollments (stop on reply/bounce)      │   │
│  │     - Update mailbox.last_synced_at                   │   │
│  │  4. Repeat                                           │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Worker Pattern (Similar to Send Worker)

```typescript
class InboxCheckerWorker {
  async start() {
    while (running) {
      // 1. Claim mailboxes that need checking
      const mailboxes = await databaseClient.claimMailboxesToCheck(50);
      
      if (mailboxes.length > 0) {
        // 2. Process with concurrency limit
        await pLimit(10)(
          mailboxes.map(m => this.processMailbox(m))
        );
      } else {
        // 3. Adaptive polling when idle
        await sleep(30000); // 30 seconds
      }
    }
  }
}
```

---

## Database Schema Changes

### 1. Create Atomic Claiming Function

**File**: `supabase/migrations/YYYYMMDDHHMMSS_create_claim_mailboxes_to_check_function.sql`

```sql
-- ============================================
-- Migration: Create claim_mailboxes_to_check function
-- ============================================
-- Atomically claims mailboxes that need IMAP checking
-- Uses UPDATE-based locking to prevent duplicate processing

CREATE OR REPLACE FUNCTION claim_mailboxes_to_check(
  p_batch_size INTEGER DEFAULT 50,
  p_check_interval_minutes INTEGER DEFAULT 5,
  p_processing_timeout_minutes INTEGER DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  account_id UUID,
  user_id UUID,
  email_address TEXT,
  imap_host TEXT,
  imap_port INTEGER,
  imap_username TEXT,
  imap_password TEXT,
  imap_use_ssl BOOLEAN,
  last_synced_at TIMESTAMPTZ,
  status TEXT,
  -- ... other mailbox fields (sync eligibility by pattern: exclude *@furnace.test)
) AS $$
DECLARE
  v_processing_timeout TIMESTAMPTZ;
BEGIN
  -- Calculate timeout: if last_synced_at was set but processing timed out
  v_processing_timeout := NOW() - (p_processing_timeout_minutes || ' minutes')::INTERVAL;
  
  -- Atomically claim mailboxes via UPDATE
  -- This prevents multiple workers from processing the same mailbox
  RETURN QUERY
  UPDATE mailboxes
  SET last_synced_at = NOW(),  -- Mark as "processing"
      updated_at = NOW()
  WHERE id IN (
    SELECT id FROM mailboxes
    WHERE status = 'connected'
      AND email_address NOT LIKE '%@furnace.test'
      AND (
        -- Never synced
        last_synced_at IS NULL
        OR
        -- Needs checking (last check was > interval ago)
        last_synced_at < NOW() - (p_check_interval_minutes || ' minutes')::INTERVAL
        OR
        -- Processing timed out (worker crashed)
        (last_synced_at < v_processing_timeout AND last_synced_at > NOW() - INTERVAL '1 hour')
      )
    ORDER BY 
      -- Prioritize: never synced > timed out > oldest first
      CASE 
        WHEN last_synced_at IS NULL THEN 1
        WHEN last_synced_at < v_processing_timeout THEN 2
        ELSE 3
      END,
      last_synced_at ASC NULLS FIRST
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED  -- Prevent contention
  )
  RETURNING *;
END;
$$ LANGUAGE plpgsql;

-- Add comment
COMMENT ON FUNCTION claim_mailboxes_to_check IS 
  'Atomically claims mailboxes that need IMAP checking. Uses UPDATE-based locking to prevent duplicate processing. Returns mailboxes that need checking (never synced, or last_synced_at > interval ago, or processing timed out).';
```

**Key Features**:
- Atomic UPDATE prevents duplicate processing
- `FOR UPDATE SKIP LOCKED` prevents contention
- Handles timeouts (if worker crashes, mailbox becomes eligible again)
- Prioritizes never-synced and timed-out mailboxes

---

## Worker Implementation

### Directory Structure

```
workers/inbox-checker-worker/
├── Dockerfile
├── package.json
├── tsconfig.json
├── README.md
├── push-to-ecr.sh
└── src/
    ├── index.ts              # Entry point
    ├── worker.ts             # Main worker loop
    ├── database.ts           # Database client (claiming)
    ├── imap-client.ts        # IMAP connection & message fetching
    ├── message-processor.ts  # Reply/bounce/unsubscribe detection
    ├── thread-manager.ts     # Email thread/message creation
    ├── supabase.ts           # Supabase client setup
    └── types.ts              # TypeScript types
```

### 1. Database Client (`src/database.ts`)

```typescript
import { SupabaseClient } from '@supabase/supabase-js';
import type { Mailbox } from './types.js';

export interface DatabaseConfig {
  supabase: SupabaseClient;
  batchSize?: number;
  checkIntervalMinutes?: number;
  processingTimeoutMinutes?: number;
}

export class DatabaseClient {
  private supabase: SupabaseClient;
  private batchSize: number;
  private checkIntervalMinutes: number;
  private processingTimeoutMinutes: number;

  constructor(config: DatabaseConfig) {
    this.supabase = config.supabase;
    this.batchSize = config.batchSize ?? 50;
    this.checkIntervalMinutes = config.checkIntervalMinutes ?? 5;
    this.processingTimeoutMinutes = config.processingTimeoutMinutes ?? 10;
  }

  /**
   * Atomically claim mailboxes that need IMAP checking
   * Returns array of mailboxes, or empty array if none found
   */
  async claimMailboxesToCheck(): Promise<Mailbox[]> {
    try {
      const { data, error } = await this.supabase
        .rpc('claim_mailboxes_to_check', {
          p_batch_size: this.batchSize,
          p_check_interval_minutes: this.checkIntervalMinutes,
          p_processing_timeout_minutes: this.processingTimeoutMinutes,
        });

      if (error) {
        console.error('[DATABASE] Error claiming mailboxes:', error);
        throw error;
      }

      const mailboxes = (data as Mailbox[]) || [];
      if (mailboxes.length > 0) {
        console.log(`[DATABASE] Claimed ${mailboxes.length} mailbox(es) to check`);
      }
      return mailboxes;
    } catch (error) {
      console.error('Error claiming mailboxes from database:', error);
      throw error;
    }
  }
}
```

### 2. IMAP Client (`src/imap-client.ts`)

```typescript
import { ImapFlow } from 'imapflow';
import type { Mailbox, ProcessedMessage } from './types.js';

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
      logger: false,
    });

    try {
      await client.connect();
      await client.mailboxOpen('INBOX');

      // Search for messages since last_synced_at (or all if never synced)
      const searchCriteria: any[] = [];
      if (lastSyncedAt) {
        searchCriteria.push(['SINCE', lastSyncedAt]);
      } else {
        // First sync: only get recent messages (last 7 days) to avoid processing old emails
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        searchCriteria.push(['SINCE', sevenDaysAgo]);
      }

      const messages = await client.search(searchCriteria, { uid: true });
      
      if (messages.length === 0) {
        return [];
      }

      // Fetch and parse messages
      const processedMessages: ProcessedMessage[] = [];
      
      for (const uid of messages) {
        try {
          const message = await client.fetchOne(uid, {
            envelope: true,      // Headers (from, to, subject, date)
            bodyStructure: true, // MIME structure
            source: true,        // Raw message
          });

          if (!message) continue;

          // Parse message (use mailparser library for production)
          const parsed = await this.parseMessage(uid, message);
          processedMessages.push(parsed);
        } catch (error) {
          console.error(`Error processing message ${uid}:`, error);
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

  private async parseMessage(uid: number, message: any): Promise<ProcessedMessage> {
    // Implementation: parse raw email, extract headers, body, attachments
    // (Can use mailparser library for better parsing)
    // ...
  }
}
```

### 3. Message Processor (`src/message-processor.ts`)

```typescript
import type { ProcessedMessage } from './types.js';

export class MessageProcessor {
  /**
   * Check if message is a bounce
   */
  isBounce(message: ProcessedMessage): boolean {
    const subject = message.subject.toLowerCase();
    const fromEmail = message.from.address.toLowerCase();
    const bodyText = (message.bodyText || '').toLowerCase();
    
    // Subject patterns
    const bounceSubjects = [
      'undelivered', 'delivery status', 'mail delivery failed',
      'delivery failure', 'returned mail', 'mail system error',
    ];
    if (bounceSubjects.some(pattern => subject.includes(pattern))) {
      return true;
    }
    
    // From address patterns
    const bounceFroms = ['mailer-daemon', 'postmaster', 'mail delivery subsystem'];
    if (bounceFroms.some(pattern => fromEmail.includes(pattern))) {
      return true;
    }
    
    // SMTP error codes in body
    const smtpErrorCodes = ['550', '551', '552', '553', '554', '5.1.1', '5.1.2'];
    if (smtpErrorCodes.some(code => bodyText.includes(code))) {
      return true;
    }
    
    return false;
  }

  /**
   * Check if message is an unsubscribe request
   */
  isUnsubscribe(message: ProcessedMessage): boolean {
    const listUnsubscribe = message.headers['list-unsubscribe'];
    if (listUnsubscribe) return true;
    
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
}
```

### 4. Thread Manager (`src/thread-manager.ts`)

```typescript
import { SupabaseClient } from '@supabase/supabase-js';
import type { ProcessedMessage, Mailbox, MessageJob } from './types.js';

export class ThreadManager {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Handle a reply message
   */
  async handleReply(
    mailbox: Mailbox,
    message: ProcessedMessage
  ): Promise<boolean> {
    // Extract Message-ID from In-Reply-To
    const inReplyToMessageId = message.inReplyTo?.replace(/^<|>$/g, '');
    if (!inReplyToMessageId) return false;

    // Find original message_job
    const { data: originalJob } = await this.supabase
      .from('message_jobs')
      .select('*, enrollments(*), campaigns(*), leads(*), mailboxes(account_id, email_address)')
      .eq('provider_message_id', inReplyToMessageId)
      .eq('status', 'sent')
      .maybeSingle();

    if (!originalJob) return false; // Not a reply to our message

    // Get or create thread
    const thread = await this.getOrCreateThread(originalJob, mailbox);

    // Create email_message for reply
    await this.supabase.from('email_messages').insert({
      thread_id: thread.id,
      message_job_id: null,
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
    });

    // Update thread
    await this.supabase
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

    // Stop enrollment
    await this.supabase
      .from('enrollments')
      .update({ state: 'stopped' })
      .eq('id', originalJob.enrollment_id);

    return true;
  }

  /**
   * Get or create email thread
   */
  private async getOrCreateThread(
    messageJob: MessageJob,
    mailbox: Mailbox
  ): Promise<any> {
    // Check if thread exists
    const { data: existingThread } = await this.supabase
      .from('email_threads')
      .select('*')
      .eq('message_job_id', messageJob.id)
      .maybeSingle();

    if (existingThread) return existingThread;

    // Create new thread
    const messageData = messageJob.message_data || {};
    const subject = messageData.subject || messageData.node_config?.subject || '(No Subject)';
    const accountId = messageJob.mailboxes?.account_id || mailbox.account_id;
    const mailboxEmail = messageJob.mailboxes?.email_address || mailbox.email_address;
    const leadEmail = messageJob.leads?.email || '';

    const { data: newThread } = await this.supabase
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
        has_reply: false,
      })
      .select()
      .single();

    return newThread;
  }

  /**
   * Handle bounce message
   */
  async handleBounce(mailbox: Mailbox, message: ProcessedMessage): Promise<void> {
    // Find recent sent jobs from this mailbox (last 7 days)
    const { data: recentJobs } = await this.supabase
      .from('message_jobs')
      .select('enrollment_id')
      .eq('mailbox_id', mailbox.id)
      .eq('status', 'sent')
      .gte('sent_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
      .limit(50);

    if (!recentJobs || recentJobs.length === 0) return;

    // Stop enrollments (conservative approach)
    const enrollmentIds = new Set(recentJobs.map(j => j.enrollment_id));
    for (const enrollmentId of enrollmentIds) {
      await this.supabase
        .from('enrollments')
        .update({ state: 'stopped' })
        .eq('id', enrollmentId);
    }
  }

  /**
   * Handle unsubscribe message
   */
  async handleUnsubscribe(mailbox: Mailbox, message: ProcessedMessage): Promise<void> {
    // Similar to bounce - find recent enrollments and stop them
    // ...
  }
}
```

### 5. Main Worker (`src/worker.ts`)

```typescript
import { SupabaseClient } from '@supabase/supabase-js';
import pLimit from 'p-limit';
import { DatabaseClient } from './database.js';
import { ImapClient } from './imap-client.js';
import { MessageProcessor } from './message-processor.js';
import { ThreadManager } from './thread-manager.js';
import type { Mailbox } from './types.js';

export interface WorkerConfig {
  supabase: SupabaseClient;
  databaseClient: DatabaseClient;
  concurrencyLimit?: number; // Max parallel mailbox processing
}

export class InboxCheckerWorker {
  private supabase: SupabaseClient;
  private databaseClient: DatabaseClient;
  private imapClient: ImapClient;
  private messageProcessor: MessageProcessor;
  private threadManager: ThreadManager;
  private running: boolean = false;
  private consecutiveEmptyPolls: number = 0;
  private concurrencyLimit: number;

  constructor(config: WorkerConfig) {
    this.supabase = config.supabase;
    this.databaseClient = config.databaseClient;
    this.imapClient = new ImapClient();
    this.messageProcessor = new MessageProcessor();
    this.threadManager = new ThreadManager(config.supabase);
    this.concurrencyLimit = config.concurrencyLimit ?? 10; // Process 10 mailboxes in parallel
  }

  /**
   * Start the worker (main loop)
   */
  async start(): Promise<void> {
    console.log('[INBOX CHECKER] Worker starting...');
    this.running = true;

    while (this.running) {
      try {
        // Claim mailboxes that need checking
        const mailboxes = await this.databaseClient.claimMailboxesToCheck();

        if (mailboxes.length > 0) {
          this.consecutiveEmptyPolls = 0;
          console.log(`[INBOX CHECKER] Found ${mailboxes.length} mailbox(es) to check`);

          // Process with concurrency limit
          const limit = pLimit(this.concurrencyLimit);
          const results = await Promise.allSettled(
            mailboxes.map(mailbox => 
              limit(() => this.processMailbox(mailbox))
            )
          );

          // Log results
          const successful = results.filter(r => r.status === 'fulfilled').length;
          const failed = results.filter(r => r.status === 'rejected').length;
          console.log(`[INBOX CHECKER] Processed ${mailboxes.length} mailbox(es): ${successful} successful, ${failed} failed`);

          // Log failures
          results.forEach((result, index) => {
            if (result.status === 'rejected') {
              console.error(`[INBOX CHECKER] Failed to process mailbox ${mailboxes[index].id}:`, result.reason);
            }
          });
        } else {
          // No mailboxes to check - adaptive polling
          this.consecutiveEmptyPolls++;
          const pollInterval = this.calculatePollInterval();
          await this.sleep(pollInterval);
        }
      } catch (error) {
        console.error('[INBOX CHECKER] Error in main loop:', error);
        await this.sleep(5000); // Wait before retrying
      }
    }
  }

  /**
   * Process a single mailbox
   */
  private async processMailbox(mailbox: Mailbox): Promise<void> {
    try {
      console.log(`[INBOX CHECKER] Processing mailbox ${mailbox.id} (${mailbox.email_address})`);

      const lastSyncedAt = mailbox.last_synced_at 
        ? new Date(mailbox.last_synced_at) 
        : null;

      // Fetch new messages
      const messages = await this.imapClient.fetchNewMessages(mailbox, lastSyncedAt);
      console.log(`[INBOX CHECKER] Found ${messages.length} new message(s) in mailbox ${mailbox.id}`);

      if (messages.length === 0) {
        // Update last_synced_at even if no messages (to avoid re-checking)
        await this.supabase
          .from('mailboxes')
          .update({ last_synced_at: new Date().toISOString() })
          .eq('id', mailbox.id);
        return;
      }

      // Process each message
      let replies = 0;
      let bounces = 0;
      let unsubscribes = 0;

      for (const message of messages) {
        try {
          // Check for bounce
          if (this.messageProcessor.isBounce(message)) {
            await this.threadManager.handleBounce(mailbox, message);
            bounces++;
            continue;
          }

          // Check for unsubscribe
          if (this.messageProcessor.isUnsubscribe(message)) {
            await this.threadManager.handleUnsubscribe(mailbox, message);
            unsubscribes++;
            continue;
          }

          // Check for reply
          if (this.messageProcessor.isReply(message)) {
            const handled = await this.threadManager.handleReply(mailbox, message);
            if (handled) {
              replies++;
            }
          }
        } catch (error) {
          console.error(`[INBOX CHECKER] Error processing message in mailbox ${mailbox.id}:`, error);
          // Continue with next message
        }
      }

      // Update last_synced_at after processing
      await this.supabase
        .from('mailboxes')
        .update({ last_synced_at: new Date().toISOString() })
        .eq('id', mailbox.id);

      console.log(`[INBOX CHECKER] Mailbox ${mailbox.id} processed: ${replies} replies, ${bounces} bounces, ${unsubscribes} unsubscribes`);
    } catch (error) {
      console.error(`[INBOX CHECKER] Error processing mailbox ${mailbox.id}:`, error);
      
      // Mark mailbox as error if authentication failed
      if (error instanceof Error && (
        error.message.includes('authentication') ||
        error.message.includes('login') ||
        error.message.includes('credentials')
      )) {
        await this.supabase
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
   * Calculate poll interval based on consecutive empty polls (adaptive polling)
   */
  private calculatePollInterval(): number {
    if (this.consecutiveEmptyPolls === 0) {
      return 5000; // 5 seconds when mailboxes found
    } else if (this.consecutiveEmptyPolls < 3) {
      return 10000; // 10 seconds after a few empty polls
    } else if (this.consecutiveEmptyPolls < 10) {
      return 30000; // 30 seconds when idle
    } else {
      return 60000; // 60 seconds when very idle
    }
  }

  /**
   * Stop the worker gracefully
   */
  stop(): void {
    console.log('[INBOX CHECKER] Stopping worker...');
    this.running = false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

### 6. Entry Point (`src/index.ts`)

```typescript
import { createClient } from '@supabase/supabase-js';
import { InboxCheckerWorker } from './worker.js';
import { DatabaseClient } from './database.js';
import { createSupabaseClient } from './supabase.js';

async function main() {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
    const awsRegion = process.env.AWS_REGION || 'us-west-2';

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
    }

    console.log('Initializing inbox checker worker...');
    console.log(`AWS Region: ${awsRegion}`);

    const supabase = createSupabaseClient();
    const databaseClient = new DatabaseClient({
      supabase,
      batchSize: 50, // Claim 50 mailboxes at a time
      checkIntervalMinutes: 5, // Check mailboxes every 5 minutes
      processingTimeoutMinutes: 10, // Timeout after 10 minutes
    });

    const worker = new InboxCheckerWorker({
      supabase,
      databaseClient,
      concurrencyLimit: 10, // Process 10 mailboxes in parallel
    });

    // Handle graceful shutdown
    process.on('SIGTERM', () => {
      console.log('SIGTERM received, shutting down gracefully...');
      worker.stop();
      process.exit(0);
    });

    process.on('SIGINT', () => {
      console.log('SIGINT received, shutting down gracefully...');
      worker.stop();
      process.exit(0);
    });

    // Start worker
    await worker.start();
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

main();
```

---

## Infrastructure (CDK)

### 1. Update Worker Stack (`infra/workers/lib/worker-stack.ts`)

Add inbox checker worker service:

```typescript
// Add to WorkerStackProps
desiredCount: {
  sendWorker: number;
  schedulerWorker: number;
  inboxCheckerWorker: number; // NEW
}

// Add ECR repository
public readonly inboxCheckerWorkerRepo: ecr.Repository;

// Add service
public readonly inboxCheckerWorkerService: ecs.FargateService;

// In constructor:
// 1. Create ECR repo
const inboxCheckerWorkerRepo = new ecr.Repository(this, 'InboxCheckerWorkerRepo', {
  repositoryName: `furnace/inbox-checker-worker-${environment}`,
  // ... same config as other repos
});

// 2. Create task definition
const inboxCheckerTaskDef = new ecs.FargateTaskDefinition(this, 'InboxCheckerTaskDef', {
  memoryLimitMiB: 512,
  cpu: 256,
  executionRole: taskExecutionRole,
  taskRole: taskRole,
});

inboxCheckerTaskDef.addContainer('inbox-checker', {
  image: ecs.ContainerImage.fromEcrRepository(inboxCheckerWorkerRepo, 'latest'),
  logging: ecs.LogDrivers.awsLogs({
    streamPrefix: 'inbox-checker',
    logGroup: inboxCheckerLogGroup,
  }),
  environment: {
    SUPABASE_URL: supabaseUrl,
    AWS_REGION: region,
  },
  secrets: {
    SUPABASE_SERVICE_KEY: ecs.Secret.fromSsmParameter(
      ssm.StringParameter.fromStringParameterName(
        this,
        'SupabaseServiceKeyParam',
        supabaseServiceKeyParamPath
      )
    ),
  },
});

// 3. Create service
const inboxCheckerService = new ecs.FargateService(this, 'InboxCheckerService', {
  cluster: cluster,
  taskDefinition: inboxCheckerTaskDef,
  desiredCount: desiredCount.inboxCheckerWorker,
  assignPublicIp: true, // Required for public subnets (no NAT)
  vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
});
```

### 2. Update Bin File (`infra/workers/bin/workers.ts`)

Add inbox checker worker to stack:

```typescript
// Add to desiredCount
desiredCount: {
  sendWorker: 1,
  schedulerWorker: 1,
  inboxCheckerWorker: 1, // NEW
}
```

---

## Scaling Strategy

### Manual Scaling

```bash
# Scale inbox checker workers
cd infra/workers
npm run scale:dev -- inbox-checker 3  # 3 inbox checker workers
```

### Auto-Scaling (Future)

Based on queue depth:
- Query: `SELECT COUNT(*) FROM mailboxes WHERE status = 'connected' AND email_address NOT LIKE '%@furnace.test' AND (last_synced_at IS NULL OR last_synced_at < NOW() - INTERVAL '5 minutes')`
- Scale up if count > threshold (e.g., 100 mailboxes pending)
- Scale down if count = 0 for sustained period

---

## Performance Estimates

### Single Worker
- Processes 10 mailboxes in parallel
- Each mailbox: ~10 seconds
- Batch of 50 mailboxes: ~50 seconds
- Throughput: ~600 mailboxes/hour
- 1,000 mailboxes: ~1.7 hours

### Multiple Workers
- 3 workers: ~34 minutes for 1,000 mailboxes
- 5 workers: ~20 minutes for 1,000 mailboxes
- 10 workers: ~10 minutes for 1,000 mailboxes

### Cost
- 1 worker 24/7: ~$0.10/day (Fargate spot)
- 5 workers 24/7: ~$0.50/day
- Much cheaper than 34+ Lambda invocations

---

## Migration from Lambda

### Steps

1. **Deploy database migration** (create `claim_mailboxes_to_check` function)
2. **Build and push ECS worker** (create `workers/inbox-checker-worker/`)
3. **Deploy CDK infrastructure** (add inbox checker service)
4. **Test with dev environment** (verify it works)
5. **Disable Lambda** (remove schedule or delete function)
6. **Monitor ECS worker** (check CloudWatch logs)

### Rollback Plan

- Keep Lambda function (just disable schedule)
- If ECS worker has issues, re-enable Lambda schedule
- Both can run simultaneously (atomic claiming prevents duplicates)

---

## Testing Strategy

### 1. Unit Tests
- Message parsing
- Reply/bounce/unsubscribe detection
- Thread creation logic

### 2. Integration Tests
- End-to-end: mailbox → IMAP → database
- Test with real IMAP server (Gmail test account)
- Verify atomic claiming prevents duplicates

### 3. Load Tests
- Test with 100+ mailboxes
- Verify parallel processing works
- Check memory/CPU usage

---

## Monitoring

### CloudWatch Metrics
- Mailboxes processed per minute
- Messages found per mailbox
- Replies/bounces/unsubscribes detected
- Processing errors
- Queue depth (pending mailboxes)

### Alarms
- High error rate (> 10% failures)
- Queue depth too high (> 500 mailboxes pending)
- Worker crashes

---

## Success Criteria

- ✅ Processes 1,000+ mailboxes without timeout
- ✅ No duplicate processing (atomic claiming works)
- ✅ Handles IMAP connection errors gracefully
- ✅ Detects replies/bounces/unsubscribes correctly
- ✅ Creates email threads and messages
- ✅ Stops enrollments on reply/bounce/unsubscribe
- ✅ Scales horizontally (multiple workers)
- ✅ Cost-effective (< $1/day for 1,000 mailboxes)

---

## Next Steps

1. **Create database migration** (claim function)
2. **Create worker directory structure**
3. **Implement core worker logic**
4. **Add to CDK infrastructure**
5. **Test with dev environment**
6. **Deploy to production**
7. **Disable Lambda function**

---

## Notes

- **Email Parsing**: Current implementation uses basic parsing. Consider adding `mailparser` library for production.
- **Connection Pooling**: Not needed (IMAP connections are short-lived per mailbox check)
- **Idempotency**: Atomic claiming + `last_synced_at` prevents duplicate processing
- **Error Recovery**: Mailboxes with auth errors are marked as 'error' status, can be retried manually
- **First Sync**: Only checks last 7 days to avoid processing very old emails on first sync
