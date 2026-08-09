/**
 * Seeds a Master Inbox thread whose email_threads.subject still holds raw spintax
 * while the delivered email_messages.subject is the exact rendered value.
 *
 * Used for browser/composer QA and the read-only verifier.
 * Does not send through any external mailbox provider.
 */
import type { SeedModule } from '../../types';
import {
  THREADING_SUBJECT_CAMPAIGN_ID,
  THREADING_SUBJECT_ENROLLMENT_ID,
  THREADING_SUBJECT_INBOUND_MESSAGE_ID,
  THREADING_SUBJECT_JOB_ID,
  THREADING_SUBJECT_LEAD_ID,
  THREADING_SUBJECT_MAILBOX_ID,
  THREADING_SUBJECT_PROVIDER_ID,
  THREADING_SUBJECT_RAW_TEMPLATE,
  THREADING_SUBJECT_RENDERED,
  THREADING_SUBJECT_SENT_MESSAGE_ID,
  THREADING_SUBJECT_SOURCE,
  THREADING_SUBJECT_THREAD_ID,
} from '../../constants/threadingSubjectComposer';

async function resolveAccountId(ctx: { supabase: any; log: (...a: unknown[]) => void }): Promise<string> {
  const accountId = process.env.SEED_ACCOUNT_ID?.trim() || process.env.CAMPAIGN_TEST_ACCOUNT_ID?.trim();
  if (accountId) return accountId;
  const { data, error } = await ctx.supabase.from('accounts').select('id').limit(1).maybeSingle();
  if (error || !data?.id) {
    throw new Error('threading-subject-composer seed requires SEED_ACCOUNT_ID or an existing accounts row');
  }
  return data.id as string;
}

export const threadingSubjectComposerModule: SeedModule = {
  id: 'threadingSubjectComposer_seed',
  description: 'Thread with raw spintax title + rendered delivered subject for composer QA',
  async run(ctx) {
    if (ctx.dryRun) {
      ctx.log(`scenario=${ctx.scenarioId} module=threadingSubjectComposer [dry-run]`);
      return;
    }

    const accountId = await resolveAccountId(ctx);
    const now = new Date().toISOString();
    const mailboxEmail = `threading-composer-${THREADING_SUBJECT_MAILBOX_ID.slice(-4)}@furnace.test`;
    const leadEmail = 'casey.threading@example.com';

    ctx.log('upserting mailbox/campaign/lead/thread for threading-subject-composer');

    await ctx.supabase.from('mailboxes').upsert(
      {
        id: THREADING_SUBJECT_MAILBOX_ID,
        account_id: accountId,
        email_address: mailboxEmail,
        display_name: 'Threading Composer Seed',
        provider: 'custom',
        status: 'connected',
        smtp_host: 'smtp.example.com',
        smtp_port: 587,
        smtp_username: 'seed',
        smtp_password: 'seed',
        smtp_use_tls: true,
        imap_host: 'imap.example.com',
        imap_port: 993,
        imap_username: 'seed',
        imap_password: 'seed',
        imap_use_ssl: true,
        updated_at: now,
      } as any,
      { onConflict: 'id' },
    );

    await ctx.supabase.from('campaigns').upsert(
      {
        id: THREADING_SUBJECT_CAMPAIGN_ID,
        account_id: accountId,
        name: '[seed] Threading Subject Composer',
        status: 'paused',
        source: THREADING_SUBJECT_SOURCE,
        updated_at: now,
      } as any,
      { onConflict: 'id' },
    );

    await ctx.supabase.from('leads').upsert(
      {
        id: THREADING_SUBJECT_LEAD_ID,
        account_id: accountId,
        email: leadEmail,
        first_name: 'Casey',
        last_name: 'Threading',
        name: 'Casey Threading',
        source: THREADING_SUBJECT_SOURCE,
        updated_at: now,
      } as any,
      { onConflict: 'id' },
    );

    await ctx.supabase.from('enrollments').upsert(
      {
        id: THREADING_SUBJECT_ENROLLMENT_ID,
        account_id: accountId,
        campaign_id: THREADING_SUBJECT_CAMPAIGN_ID,
        lead_id: THREADING_SUBJECT_LEAD_ID,
        state: 'active',
        updated_at: now,
      } as any,
      { onConflict: 'id' },
    );

    await ctx.supabase.from('message_jobs').upsert(
      {
        id: THREADING_SUBJECT_JOB_ID,
        account_id: accountId,
        campaign_id: THREADING_SUBJECT_CAMPAIGN_ID,
        enrollment_id: THREADING_SUBJECT_ENROLLMENT_ID,
        lead_id: THREADING_SUBJECT_LEAD_ID,
        mailbox_id: THREADING_SUBJECT_MAILBOX_ID,
        status: 'sent',
        message_type: 'campaign',
        scheduled_at: now,
        sent_at: now,
        provider_message_id: THREADING_SUBJECT_PROVIDER_ID,
        message_data: {
          source: THREADING_SUBJECT_SOURCE,
          sent_subject: THREADING_SUBJECT_RENDERED,
          node_config: {
            subject: THREADING_SUBJECT_RAW_TEMPLATE,
            body_html: '<p>Seed body</p>',
            body_text: 'Seed body',
          },
        },
        updated_at: now,
      } as any,
      { onConflict: 'id' },
    );

    // Intentionally store RAW template on the thread row to reproduce the composer defect.
    await ctx.supabase.from('email_threads').upsert(
      {
        id: THREADING_SUBJECT_THREAD_ID,
        account_id: accountId,
        campaign_id: THREADING_SUBJECT_CAMPAIGN_ID,
        lead_id: THREADING_SUBJECT_LEAD_ID,
        enrollment_id: THREADING_SUBJECT_ENROLLMENT_ID,
        mailbox_id: THREADING_SUBJECT_MAILBOX_ID,
        message_job_id: THREADING_SUBJECT_JOB_ID,
        subject: THREADING_SUBJECT_RAW_TEMPLATE,
        participants: [mailboxEmail, leadEmail],
        message_count: 2,
        has_reply: true,
        last_message_at: now,
        updated_at: now,
      } as any,
      { onConflict: 'id' },
    );

    await ctx.supabase.from('email_messages').upsert(
      {
        id: THREADING_SUBJECT_SENT_MESSAGE_ID,
        thread_id: THREADING_SUBJECT_THREAD_ID,
        account_id: accountId,
        message_job_id: THREADING_SUBJECT_JOB_ID,
        direction: 'sent',
        from_email: mailboxEmail,
        to_email: leadEmail,
        subject: THREADING_SUBJECT_RENDERED,
        body_text: 'Seed body',
        body_html: '<p>Seed body</p>',
        message_id: THREADING_SUBJECT_PROVIDER_ID.replace(/^<|>$/g, ''),
        received_at: now,
      } as any,
      { onConflict: 'id' },
    );

    await ctx.supabase.from('email_messages').upsert(
      {
        id: THREADING_SUBJECT_INBOUND_MESSAGE_ID,
        thread_id: THREADING_SUBJECT_THREAD_ID,
        account_id: accountId,
        direction: 'received',
        from_email: leadEmail,
        to_email: mailboxEmail,
        subject: `Re: ${THREADING_SUBJECT_RENDERED}`,
        body_text: 'Inbound reply for composer QA',
        body_html: '<p>Inbound reply for composer QA</p>',
        message_id: 'inbound-threading-subject@mail.example.com',
        in_reply_to: THREADING_SUBJECT_PROVIDER_ID.replace(/^<|>$/g, ''),
        received_at: new Date(Date.now() + 1000).toISOString(),
      } as any,
      { onConflict: 'id' },
    );

    ctx.log(
      `seeded thread ${THREADING_SUBJECT_THREAD_ID} (raw thread.subject, rendered message.subject=${THREADING_SUBJECT_RENDERED})`,
    );
  },
};
