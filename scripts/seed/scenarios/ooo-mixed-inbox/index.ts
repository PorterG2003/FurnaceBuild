import type { SeedContext, SeedModule } from '../../types';
import {
  DEFAULT_SEED_OOO_CAMPAIGN_ID,
  headerMessageId,
  OOO_INBOX_CASE_KEYS,
  OOO_INTERVAL_TIME_ISO,
  OOO_SEED_SOURCE,
  OOO_SEED_WORKER_ID,
  OOO_THREAD_IDS,
  type OooInboxCaseKey,
} from '../../constants/oooMixedInbox';
import { oooCampaignName, OOO_CASE_COPY, oooLeadEmailLocalPart, oooMailboxEmailLocalPart } from '../../theme/falloutOooCopy';
import { SMOKE_VARIANT_IDS } from '../../constants/campaignSmoke';
import { buildSmokeFlowData, smokeSchedule } from '../campaign-smoke/buildFlow';

type OooCaseState = {
  mailboxId: string;
  mailboxEmail: string;
  leadId: string;
  leadEmail: string;
  enrollmentId: string;
  messageJobId: string;
  threadId: string;
  sentAt: string;
  replyAt: string;
};

const oooStore: {
  accountId: string;
  ownerUserId: string;
  campaignId: string;
  bucketId: string;
  emailNodeDbId: string;
  cases: Record<OooInboxCaseKey, OooCaseState>;
} = {
  accountId: '',
  ownerUserId: '',
  campaignId: '',
  bucketId: '',
  emailNodeDbId: '',
  cases: {} as Record<OooInboxCaseKey, OooCaseState>,
};

function resetOooStore() {
  oooStore.accountId = '';
  oooStore.ownerUserId = '';
  oooStore.campaignId = '';
  oooStore.bucketId = '';
  oooStore.emailNodeDbId = '';
  oooStore.cases = {} as Record<OooInboxCaseKey, OooCaseState>;
}

function caseCopy(key: OooInboxCaseKey) {
  const copy = OOO_CASE_COPY.find((entry) => entry.key === key);
  if (!copy) {
    throw new Error(`ooo-mixed-inbox: missing copy for case ${key}`);
  }
  return copy;
}

async function ensureMailbox(
  ctx: SeedContext,
  key: OooInboxCaseKey
): Promise<{ id: string; email: string }> {
  const { supabase } = ctx;
  const copy = caseCopy(key);
  const emailLocal = oooMailboxEmailLocalPart(oooStore.campaignId, copy.mailboxLocalBase);
  const email = `${emailLocal}@furnace.test`;
  const now = new Date().toISOString();

  const { data: found, error: findErr } = await supabase
    .from('mailboxes')
    .select('id')
    .eq('email_address', email)
    .maybeSingle();

  if (findErr) {
    throw new Error(`ooo-mixed-inbox: mailbox lookup failed: ${findErr.message}`);
  }

  if (found?.id) {
    const { error: upErr } = await supabase
      .from('mailboxes')
      .update({
        account_id: oooStore.accountId,
        user_id: oooStore.ownerUserId,
        display_name: copy.mailboxDisplayName,
        status: 'connected',
        deleted_at: null,
        updated_at: now,
      })
      .eq('id', found.id);
    if (upErr) {
      throw new Error(`ooo-mixed-inbox: mailbox update failed: ${upErr.message}`);
    }
    return { id: found.id as string, email };
  }

  const { data: inserted, error: insErr } = await supabase
    .from('mailboxes')
    .insert({
      account_id: oooStore.accountId,
      user_id: oooStore.ownerUserId,
      email_address: email,
      display_name: copy.mailboxDisplayName,
      provider: 'gmail',
      smtp_host: 'smtp.gmail.com',
      smtp_port: 587,
      smtp_username: email,
      smtp_password: 'test-password',
      smtp_use_tls: true,
      smtp_use_ssl: false,
      imap_host: 'imap.gmail.com',
      imap_port: 993,
      imap_username: email,
      imap_password: 'test-password',
      imap_use_ssl: true,
      status: 'connected',
      created_at: now,
      updated_at: now,
    })
    .select('id')
    .single();

  if (insErr || !inserted) {
    throw new Error(`ooo-mixed-inbox: mailbox insert failed: ${insErr?.message}`);
  }
  return { id: inserted.id as string, email };
}

async function pollEmailNodeId(ctx: SeedContext): Promise<string> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const { data, error } = await ctx.supabase
      .from('nodes')
      .select('id')
      .eq('campaign_id', oooStore.campaignId)
      .eq('flow_node_id', 'email-1')
      .is('deleted_at', null)
      .maybeSingle();
    if (error) {
      throw new Error(`ooo-mixed-inbox: nodes poll failed: ${error.message}`);
    }
    if (data?.id) {
      return data.id as string;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('ooo-mixed-inbox: timed out waiting for email node sync');
}

async function cleanupCampaignSlice(ctx: SeedContext) {
  const { supabase } = ctx;

  const { data: threads, error: threadErr } = await supabase
    .from('email_threads')
    .select('id')
    .eq('campaign_id', oooStore.campaignId);
  if (threadErr) {
    throw new Error(`ooo-mixed-inbox: thread cleanup lookup failed: ${threadErr.message}`);
  }
  const threadIds = (threads ?? []).map((row) => row.id as string);
  if (threadIds.length > 0) {
    const { error: msgErr } = await supabase.from('email_messages').delete().in('thread_id', threadIds);
    if (msgErr) {
      throw new Error(`ooo-mixed-inbox: email_messages cleanup failed: ${msgErr.message}`);
    }
  }
  const { error: delThreadErr } = await supabase
    .from('email_threads')
    .delete()
    .eq('campaign_id', oooStore.campaignId);
  if (delThreadErr) {
    throw new Error(`ooo-mixed-inbox: email_threads cleanup failed: ${delThreadErr.message}`);
  }

  const { data: enrollments, error: enrErr } = await supabase
    .from('enrollments')
    .select('id')
    .eq('campaign_id', oooStore.campaignId);
  if (enrErr) {
    throw new Error(`ooo-mixed-inbox: enrollment cleanup lookup failed: ${enrErr.message}`);
  }
  const enrollmentIds = (enrollments ?? []).map((row) => row.id as string);
  if (enrollmentIds.length > 0) {
    const { error: jobErr } = await supabase
      .from('message_jobs')
      .delete()
      .in('enrollment_id', enrollmentIds);
    if (jobErr) {
      throw new Error(`ooo-mixed-inbox: message_jobs cleanup failed: ${jobErr.message}`);
    }
  }

  const { error: delEnrErr } = await supabase
    .from('enrollments')
    .delete()
    .eq('campaign_id', oooStore.campaignId);
  if (delEnrErr) {
    throw new Error(`ooo-mixed-inbox: enrollments cleanup failed: ${delEnrErr.message}`);
  }

  const { error: delLeadErr } = await supabase
    .from('leads')
    .delete()
    .eq('campaign_id', oooStore.campaignId);
  if (delLeadErr) {
    throw new Error(`ooo-mixed-inbox: leads cleanup failed: ${delLeadErr.message}`);
  }

  const { error: delLinkErr } = await supabase
    .from('campaign_mailboxes')
    .delete()
    .eq('campaign_id', oooStore.campaignId);
  if (delLinkErr) {
    throw new Error(`ooo-mixed-inbox: campaign_mailboxes cleanup failed: ${delLinkErr.message}`);
  }
}

async function markThreadOutOfOffice(
  ctx: SeedContext,
  threadId: string,
  outOfOffice: boolean,
  resumeRequested: boolean,
  resumeAt: string | null
) {
  const { error } = await ctx.supabase.rpc('mark_email_thread_out_of_office', {
    p_thread_id: threadId,
    p_out_of_office: outOfOffice,
    p_resume_requested: resumeRequested,
    p_resume_at: resumeAt,
  });
  if (error) {
    throw new Error(`ooo-mixed-inbox: mark_email_thread_out_of_office failed: ${error.message}`);
  }
}

export const oooInboxEnvModule: SeedModule = {
  id: 'oooInbox_env',
  description: 'Validate env and initialize ooo-mixed-inbox store',
  async run(ctx) {
    const accountId = process.env.SEED_ACCOUNT_ID?.trim();
    const ownerUserId = process.env.SEED_OWNER_USER_ID?.trim();
    if (!accountId || !ownerUserId) {
      throw new Error(
        'ooo-mixed-inbox requires SEED_ACCOUNT_ID and SEED_OWNER_USER_ID (existing account/users rows).'
      );
    }
    resetOooStore();
    oooStore.accountId = accountId;
    oooStore.ownerUserId = ownerUserId;
    oooStore.campaignId =
      process.env.SEED_OOO_CAMPAIGN_ID?.trim() ||
      process.env.SEED_CAMPAIGN_ID?.trim() ||
      DEFAULT_SEED_OOO_CAMPAIGN_ID;

    if (ctx.dryRun) {
      ctx.log(
        `[dry-run] would use accountId=${accountId} ownerUserId=${ownerUserId} oooCampaignId=${oooStore.campaignId}`
      );
    }
  },
};

export const oooInboxBaseGraphModule: SeedModule = {
  id: 'oooInbox_baseGraph',
  description: 'Create deterministic campaign/mailboxes/leads/enrollments/jobs for inbox OOO tests',
  deps: ['oooInbox_env'],
  async run(ctx) {
    if (ctx.dryRun) {
      ctx.log(`[dry-run] would build base graph for campaign=${oooStore.campaignId}`);
      return;
    }

    const now = new Date().toISOString();
    const { supabase } = ctx;
    const flowData = buildSmokeFlowData(SMOKE_VARIANT_IDS[0], SMOKE_VARIANT_IDS[1]);
    const schedule = smokeSchedule();

    const { data: existing, error: selErr } = await supabase
      .from('campaigns')
      .select('id, bucket_id')
      .eq('id', oooStore.campaignId)
      .maybeSingle();
    if (selErr) {
      throw new Error(`ooo-mixed-inbox: campaign lookup failed: ${selErr.message}`);
    }

    if (existing?.id) {
      const { error: upErr } = await supabase
        .from('campaigns')
        .update({
          name: oooCampaignName(oooStore.campaignId),
          owner_id: oooStore.ownerUserId,
          account_id: oooStore.accountId,
          organization_id: null,
          status: 'running',
          flow_data: flowData,
          schedule,
          sending_interval_seconds: 300,
          deleted_at: null,
          updated_at: now,
        })
        .eq('id', oooStore.campaignId);
      if (upErr) {
        throw new Error(`ooo-mixed-inbox: campaign update failed: ${upErr.message}`);
      }
      oooStore.bucketId = (existing.bucket_id as string) || '';
    } else {
      const { data: inserted, error: insErr } = await supabase
        .from('campaigns')
        .insert({
          id: oooStore.campaignId,
          name: oooCampaignName(oooStore.campaignId),
          owner_id: oooStore.ownerUserId,
          account_id: oooStore.accountId,
          organization_id: null,
          status: 'running',
          flow_data: flowData,
          schedule,
          sending_interval_seconds: 300,
          created_at: now,
          updated_at: now,
        })
        .select('bucket_id')
        .single();
      if (insErr || !inserted) {
        throw new Error(`ooo-mixed-inbox: campaign insert failed: ${insErr?.message}`);
      }
      oooStore.bucketId = inserted.bucket_id as string;
    }

    if (!oooStore.bucketId) {
      const { data: row, error: bucketErr } = await supabase
        .from('campaigns')
        .select('bucket_id')
        .eq('id', oooStore.campaignId)
        .single();
      if (bucketErr || !row?.bucket_id) {
        throw new Error(`ooo-mixed-inbox: missing bucket_id: ${bucketErr?.message}`);
      }
      oooStore.bucketId = row.bucket_id as string;
    }

    await cleanupCampaignSlice(ctx);

    const mailboxRows: { campaign_id: string; mailbox_id: string; account_id: string }[] = [];
    for (const key of OOO_INBOX_CASE_KEYS) {
      const mailbox = await ensureMailbox(ctx, key);
      oooStore.cases[key] = {
        mailboxId: mailbox.id,
        mailboxEmail: mailbox.email,
        leadId: '',
        leadEmail: '',
        enrollmentId: '',
        messageJobId: '',
        threadId: OOO_THREAD_IDS[key],
        sentAt: '',
        replyAt: '',
      };
      mailboxRows.push({
        campaign_id: oooStore.campaignId,
        mailbox_id: mailbox.id,
        account_id: oooStore.accountId,
      });
    }

    const { error: linkErr } = await supabase.from('campaign_mailboxes').insert(mailboxRows);
    if (linkErr) {
      throw new Error(`ooo-mixed-inbox: campaign_mailboxes insert failed: ${linkErr.message}`);
    }

    oooStore.emailNodeDbId = await pollEmailNodeId(ctx);

    for (const key of OOO_INBOX_CASE_KEYS) {
      const copy = caseCopy(key);
      const leadEmail = `${oooLeadEmailLocalPart(oooStore.campaignId, key)}@furnace.test`;
      const { data: lead, error: leadErr } = await supabase
        .from('leads')
        .insert({
          campaign_id: oooStore.campaignId,
          bucket_id: oooStore.bucketId,
          account_id: oooStore.accountId,
          email: leadEmail,
          name: copy.leadName,
          first_name: copy.firstName,
          last_name: copy.lastName,
          company_name: copy.companyName,
          status: 'new',
          source: OOO_SEED_SOURCE,
          mailbox_id: oooStore.cases[key].mailboxId,
        })
        .select('id')
        .single();
      if (leadErr || !lead) {
        throw new Error(`ooo-mixed-inbox: lead insert failed: ${leadErr?.message}`);
      }

      const { data: enrollment, error: enrErr } = await supabase
        .from('enrollments')
        .insert({
          campaign_id: oooStore.campaignId,
          account_id: oooStore.accountId,
          lead_id: lead.id,
          current_node_id: oooStore.emailNodeDbId,
          state: 'active',
          next_run_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
          flow_position: {},
        })
        .select('id')
        .single();
      if (enrErr || !enrollment) {
        throw new Error(`ooo-mixed-inbox: enrollment insert failed: ${enrErr?.message}`);
      }

      oooStore.cases[key].leadId = lead.id as string;
      oooStore.cases[key].leadEmail = leadEmail;
      oooStore.cases[key].enrollmentId = enrollment.id as string;
    }

    const { error: intErr } = await supabase.from('campaign_intervals').upsert(
      {
        campaign_id: oooStore.campaignId,
        account_id: oooStore.accountId,
        interval_time: OOO_INTERVAL_TIME_ISO,
        status: 'available',
      },
      { onConflict: 'campaign_id,interval_time', ignoreDuplicates: true }
    );
    if (intErr) {
      throw new Error(`ooo-mixed-inbox: campaign_intervals upsert failed: ${intErr.message}`);
    }

    const jobData = OOO_INBOX_CASE_KEYS.map((key) => ({
      enrollment_id: oooStore.cases[key].enrollmentId,
      lead_id: oooStore.cases[key].leadId,
      mailbox_id: oooStore.cases[key].mailboxId,
      node_id: oooStore.emailNodeDbId,
      message_data: {
        node_config: {},
        lead_data: {
          email: oooStore.cases[key].leadEmail,
          name: caseCopy(key).leadName,
          first_name: caseCopy(key).firstName,
          last_name: caseCopy(key).lastName,
        },
      },
      jitter_percentage: 10,
    }));

    const { error: rpcErr } = await supabase.rpc('batch_assign_jobs_to_interval', {
      p_campaign_id: oooStore.campaignId,
      p_job_data: jobData as unknown[],
      p_worker_id: OOO_SEED_WORKER_ID,
      p_required_mailbox_count: OOO_INBOX_CASE_KEYS.length,
    });
    if (rpcErr) {
      throw new Error(`ooo-mixed-inbox: batch_assign_jobs_to_interval failed: ${rpcErr.message}`);
    }

    const { data: jobs, error: jobsErr } = await supabase
      .from('message_jobs')
      .select('id, enrollment_id')
      .eq('campaign_id', oooStore.campaignId);
    if (jobsErr) {
      throw new Error(`ooo-mixed-inbox: message_jobs fetch failed: ${jobsErr.message}`);
    }
    const jobsByEnrollment = new Map((jobs ?? []).map((row) => [row.enrollment_id as string, row.id as string]));

    for (const [index, key] of OOO_INBOX_CASE_KEYS.entries()) {
      const jobId = jobsByEnrollment.get(oooStore.cases[key].enrollmentId);
      if (!jobId) {
        throw new Error(`ooo-mixed-inbox: missing message_job for case ${key}`);
      }
      const sentAt = new Date(Date.now() - (index + 1) * 60 * 60 * 1000).toISOString();
      const { error: upJobErr } = await supabase
        .from('message_jobs')
        .update({
          status: 'sent',
          sent_at: sentAt,
          scheduled_at: sentAt,
          provider_message_id: headerMessageId(key, 'sent'),
          updated_at: now,
        })
        .eq('id', jobId);
      if (upJobErr) {
        throw new Error(`ooo-mixed-inbox: message_job update failed: ${upJobErr.message}`);
      }
      oooStore.cases[key].messageJobId = jobId;
      oooStore.cases[key].sentAt = sentAt;
      oooStore.cases[key].replyAt = new Date(Date.parse(sentAt) + 15 * 60 * 1000).toISOString();
    }

    ctx.log(`ooo base graph ready campaign=${oooStore.campaignId} cases=${OOO_INBOX_CASE_KEYS.length}`);
  },
};

export const oooInboxThreadsModule: SeedModule = {
  id: 'oooInbox_threads',
  description: 'Insert deterministic mixed inbox threads',
  deps: ['oooInbox_baseGraph'],
  async run(ctx) {
    if (ctx.dryRun) {
      ctx.log(`[dry-run] would insert mixed inbox threads for campaign=${oooStore.campaignId}`);
      return;
    }

    const rows = OOO_INBOX_CASE_KEYS.map((key) => ({
      id: oooStore.cases[key].threadId,
      account_id: oooStore.accountId,
      campaign_id: oooStore.campaignId,
      lead_id: oooStore.cases[key].leadId,
      enrollment_id: oooStore.cases[key].enrollmentId,
      message_job_id: oooStore.cases[key].messageJobId,
      mailbox_id: oooStore.cases[key].mailboxId,
      subject: caseCopy(key).subject,
      participants: [oooStore.cases[key].mailboxEmail, oooStore.cases[key].leadEmail],
      last_message_at: oooStore.cases[key].replyAt,
      message_count: 2,
      has_reply: true,
      out_of_office: false,
      ooo_resume_requested: false,
      ooo_resume_at: null,
      ooo_resume_processed_at: null,
      created_at: oooStore.cases[key].sentAt,
      updated_at: oooStore.cases[key].replyAt,
    }));

    const { error } = await ctx.supabase.from('email_threads').insert(rows);
    if (error) {
      throw new Error(`ooo-mixed-inbox: email_threads insert failed: ${error.message}`);
    }

    ctx.log(`threads inserted count=${rows.length}`);
  },
};

export const oooInboxMessagesModule: SeedModule = {
  id: 'oooInbox_messages',
  description: 'Insert sent + received email_messages for thread previews and OOO date prefill',
  deps: ['oooInbox_threads'],
  async run(ctx) {
    if (ctx.dryRun) {
      ctx.log(`[dry-run] would insert email_messages for campaign=${oooStore.campaignId}`);
      return;
    }

    const rows: Record<string, unknown>[] = [];
    for (const key of OOO_INBOX_CASE_KEYS) {
      const copy = caseCopy(key);
      rows.push(
        {
          thread_id: oooStore.cases[key].threadId,
          account_id: oooStore.accountId,
          message_job_id: oooStore.cases[key].messageJobId,
          direction: 'sent',
          from_email: oooStore.cases[key].mailboxEmail,
          from_name: copy.mailboxDisplayName,
          to_email: oooStore.cases[key].leadEmail,
          to_name: copy.leadName,
          subject: copy.subject,
          body_text: copy.sentBody.replace('{{name}}', copy.firstName),
          body_html: null,
          message_id: headerMessageId(key, 'sent'),
          in_reply_to: null,
          message_references: null,
          received_at: oooStore.cases[key].sentAt,
          read_at: oooStore.cases[key].sentAt,
          headers: {},
          attachments: [],
          created_at: oooStore.cases[key].sentAt,
          updated_at: oooStore.cases[key].sentAt,
        },
        {
          thread_id: oooStore.cases[key].threadId,
          account_id: oooStore.accountId,
          message_job_id: null,
          direction: 'received',
          from_email: oooStore.cases[key].leadEmail,
          from_name: copy.leadName,
          to_email: oooStore.cases[key].mailboxEmail,
          to_name: copy.mailboxDisplayName,
          subject: copy.subject,
          body_text: copy.receivedBody,
          body_html: null,
          message_id: headerMessageId(key, 'received'),
          in_reply_to: headerMessageId(key, 'sent'),
          message_references: headerMessageId(key, 'sent'),
          received_at: oooStore.cases[key].replyAt,
          read_at: null,
          headers: {},
          attachments: [],
          created_at: oooStore.cases[key].replyAt,
          updated_at: oooStore.cases[key].replyAt,
        }
      );
    }

    const { error } = await ctx.supabase.from('email_messages').insert(rows);
    if (error) {
      throw new Error(`ooo-mixed-inbox: email_messages insert failed: ${error.message}`);
    }

    ctx.log(`messages inserted count=${rows.length}`);
  },
};

export const oooInboxOooStatesModule: SeedModule = {
  id: 'oooInbox_oooStates',
  description: 'Apply OOO flags for UI-only, future resume, and due resume cases',
  deps: ['oooInbox_messages'],
  async run(ctx) {
    if (ctx.dryRun) {
      ctx.log(`[dry-run] would apply OOO state to seeded threads for campaign=${oooStore.campaignId}`);
      return;
    }

    await markThreadOutOfOffice(ctx, oooStore.cases.ooo_only.threadId, true, false, null);

    const stoppedAt = new Date().toISOString();
    for (const key of ['ooo_future', 'ooo_due'] as const) {
      const { error } = await ctx.supabase
        .from('enrollments')
        .update({
          state: 'stopped',
          stopped_reason: 'replied',
          stopped_at: stoppedAt,
          next_run_at: null,
          updated_at: stoppedAt,
        })
        .eq('id', oooStore.cases[key].enrollmentId);
      if (error) {
        throw new Error(`ooo-mixed-inbox: enrollment stop failed for ${key}: ${error.message}`);
      }
    }

    await markThreadOutOfOffice(
      ctx,
      oooStore.cases.ooo_future.threadId,
      true,
      true,
      '2099-07-20T12:00:00.000Z'
    );

    const { error: dueErr } = await ctx.supabase
      .from('email_threads')
      .update({
        out_of_office: true,
        ooo_resume_requested: true,
        ooo_resume_at: '2000-01-01T12:00:00.000Z',
        ooo_resume_processed_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', oooStore.cases.ooo_due.threadId);
    if (dueErr) {
      throw new Error(`ooo-mixed-inbox: due OOO direct update failed: ${dueErr.message}`);
    }

    ctx.log('OOO states applied: ui-only, future resume, due resume');
  },
};
