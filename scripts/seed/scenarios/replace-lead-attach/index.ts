import {
  buildCampaignEnrollment,
  buildCampaignJob,
  buildCampaignLead,
  buildCampaignThread,
} from '../../../../lib/test/campaign/fixtures';
import { materializeCampaignGraph } from '../../../../lib/test/campaign/harness';
import type { CampaignLeadSpec } from '../../../../lib/test/campaign/harness';
import {
  DEFAULT_SEED_REPLACE_LEAD_ATTACH_CAMPAIGN_ID,
  REPLACE_LEAD_ATTACH_CAMPAIGN_NAME,
  REPLACE_LEAD_ATTACH_DOMAIN,
  REPLACE_LEAD_ATTACH_SEED_SOURCE,
  replaceLeadAttachEmail,
  replaceLeadAttachMailboxEmail,
} from '../../constants/replaceLeadAttach';
import type { SeedModule } from '../../types';

function previewOrigin(): string {
  return process.env.SEED_PREVIEW_ORIGIN?.trim() || 'http://localhost:8081';
}

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function minutesFromNow(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function sourceLead(params: {
  key: string;
  emailLocal: string;
  firstName: string;
  lastName: string;
  subject: string;
  minutesAgoSent: number;
}): CampaignLeadSpec {
  const sentAt = minutesAgo(params.minutesAgoSent);
  const replyAt = minutesAgo(params.minutesAgoSent - 5);
  return buildCampaignLead({
    key: params.key,
    email: replaceLeadAttachEmail(params.emailLocal),
    firstName: params.firstName,
    lastName: params.lastName,
    companyName: `${params.lastName} Wrong Co`,
    source: REPLACE_LEAD_ATTACH_SEED_SOURCE,
    mailboxKey: 'mailbox-1',
    enrollment: buildCampaignEnrollment({
      state: 'active',
      currentFlowNodeId: 'email-1',
      nextRunAt: minutesFromNow(30),
    }),
    jobs: [
      buildCampaignJob({
        key: 'sent',
        status: 'sent',
        scheduledAt: sentAt,
        sentAt,
        providerMessageId: `<seed-replace-attach-${params.key}-sent@furnace.test>`,
      }),
      buildCampaignJob({
        key: 'queued',
        status: 'queued',
        scheduledAt: minutesFromNow(45),
      }),
    ],
    thread: buildCampaignThread({
      key: `${params.key}-thread`,
      subject: params.subject,
      lastMessageAt: replyAt,
      messageJobKey: 'sent',
      hasReply: true,
      messages: [
        {
          direction: 'sent',
          bodyText: `Hi ${params.firstName} — quick question about your team.`,
          receivedAt: sentAt,
          readAt: sentAt,
          messageId: `<seed-replace-attach-${params.key}-sent@furnace.test>`,
        },
        {
          direction: 'received',
          bodyText: `You've got the wrong person — I'm not the right contact.`,
          receivedAt: replyAt,
          readAt: null,
          messageId: `<seed-replace-attach-${params.key}-reply@furnace.test>`,
          inReplyTo: `<seed-replace-attach-${params.key}-sent@furnace.test>`,
        },
      ],
    }),
  });
}

function buildLeads(): CampaignLeadSpec[] {
  const targetEmail = replaceLeadAttachEmail('blake.attach');
  const siblingEmail = replaceLeadAttachEmail('dupes');
  const orphanEmail = replaceLeadAttachEmail('orphan');
  const blockedExistingEmail = replaceLeadAttachEmail('blocked.existing');

  return [
    // Inbox sources — open these threads and run Replace lead
    sourceLead({
      key: 'create-source',
      emailLocal: 'wrong.create',
      firstName: 'Wrong',
      lastName: 'Createpath',
      subject: '[Create] Wrong contact — type a brand-new email',
      minutesAgoSent: 120,
    }),
    sourceLead({
      key: 'attach-source',
      emailLocal: 'wrong.attach',
      firstName: 'Wrong',
      lastName: 'Attachpath',
      subject: '[Attach] Misaddressed — use blake.attach@…',
      minutesAgoSent: 110,
    }),
    sourceLead({
      key: 'forward-source',
      emailLocal: 'wrong.forward',
      firstName: 'Wrong',
      lastName: 'Forwardpath',
      subject: '[Attach+Forward] Misaddressed — use blake.attach@…',
      minutesAgoSent: 100,
    }),
    sourceLead({
      key: 'siblings-source',
      emailLocal: 'wrong.siblings',
      firstName: 'Wrong',
      lastName: 'Siblingpath',
      subject: '[Siblings] Misaddressed — use dupes@…',
      minutesAgoSent: 90,
    }),
    sourceLead({
      key: 'blocklist-source',
      emailLocal: 'wrong.blocklist',
      firstName: 'Wrong',
      lastName: 'Blocklistpath',
      subject: '[Blocklist] Misaddressed — use blocked.existing@…',
      minutesAgoSent: 80,
    }),
    sourceLead({
      key: 'no-enroll-source',
      emailLocal: 'wrong.noenroll',
      firstName: 'Wrong',
      lastName: 'Noenrollpath',
      subject: '[No enrollment] Misaddressed — use orphan@…',
      minutesAgoSent: 70,
    }),

    // Existing attach target (filled company + phone — should not be overwritten)
    buildCampaignLead({
      key: 'attach-target',
      email: targetEmail,
      firstName: 'Blake',
      lastName: 'Existing',
      companyName: 'Keep This Company',
      phoneNumber: '555-0100',
      source: REPLACE_LEAD_ATTACH_SEED_SOURCE,
      mailboxKey: 'mailbox-1',
      enrollment: buildCampaignEnrollment({
        state: 'active',
        currentFlowNodeId: 'email-1',
        nextRunAt: minutesFromNow(90),
      }),
      jobs: [
        buildCampaignJob({
          key: 'target-sent',
          status: 'sent',
          scheduledAt: minutesAgo(240),
          sentAt: minutesAgo(240),
        }),
        buildCampaignJob({
          key: 'target-queued',
          status: 'queued',
          scheduledAt: minutesFromNow(120),
        }),
      ],
    }),

    // Sibling duplicates for one address (primary = active)
    buildCampaignLead({
      key: 'sibling-primary',
      email: siblingEmail,
      firstName: 'Dupes',
      lastName: 'Primary',
      companyName: 'Dupes Primary Co',
      source: REPLACE_LEAD_ATTACH_SEED_SOURCE,
      mailboxKey: 'mailbox-1',
      enrollment: buildCampaignEnrollment({
        state: 'active',
        currentFlowNodeId: 'email-1',
        nextRunAt: minutesFromNow(60),
      }),
      jobs: [
        buildCampaignJob({
          key: 'sib-primary-queued',
          status: 'queued',
          scheduledAt: minutesFromNow(75),
        }),
      ],
      thread: buildCampaignThread({
        key: 'sibling-primary-thread',
        subject: 'Sibling primary prior thread (do not open for replace)',
        lastMessageAt: minutesAgo(30),
        hasReply: true,
      }),
    }),
    buildCampaignLead({
      key: 'sibling-paused',
      email: siblingEmail,
      firstName: 'Dupes',
      lastName: 'Paused',
      companyName: 'Dupes Paused Co',
      source: REPLACE_LEAD_ATTACH_SEED_SOURCE,
      mailboxKey: 'mailbox-1',
      enrollment: buildCampaignEnrollment({
        state: 'paused',
        currentFlowNodeId: 'email-1',
        nextRunAt: null,
      }),
      jobs: [
        buildCampaignJob({
          key: 'sib-paused-queued',
          status: 'queued',
          scheduledAt: minutesFromNow(80),
        }),
      ],
    }),
    buildCampaignLead({
      key: 'sibling-completed',
      email: siblingEmail,
      firstName: 'Dupes',
      lastName: 'Completed',
      companyName: 'Dupes Completed Co',
      source: REPLACE_LEAD_ATTACH_SEED_SOURCE,
      mailboxKey: 'mailbox-1',
      enrollment: buildCampaignEnrollment({
        state: 'completed',
        currentFlowNodeId: null,
        nextRunAt: null,
      }),
      jobs: [
        buildCampaignJob({
          key: 'sib-completed-sent',
          status: 'sent',
          scheduledAt: minutesAgo(400),
          sentAt: minutesAgo(400),
        }),
      ],
    }),

    // Existing contact that is also on the block list
    buildCampaignLead({
      key: 'blocked-existing',
      email: blockedExistingEmail,
      firstName: 'Blocked',
      lastName: 'Existing',
      companyName: 'Blocked Co',
      source: REPLACE_LEAD_ATTACH_SEED_SOURCE,
      mailboxKey: 'mailbox-1',
      enrollment: buildCampaignEnrollment({
        state: 'active',
        currentFlowNodeId: 'email-1',
        nextRunAt: minutesFromNow(100),
      }),
    }),

    // Target with no live enrollment — attach must refuse
    buildCampaignLead({
      key: 'orphan-target',
      email: orphanEmail,
      firstName: 'Orphan',
      lastName: 'Noenroll',
      companyName: 'Orphan Co',
      source: REPLACE_LEAD_ATTACH_SEED_SOURCE,
      mailboxKey: 'mailbox-1',
      enrollment: null,
    }),
  ];
}

async function upsertSeedBlockList(
  supabase: Parameters<typeof materializeCampaignGraph>[0]['supabase'],
  accountId: string,
): Promise<void> {
  const blockedEmail = replaceLeadAttachEmail('blocked.existing');

  const { error: deleteError } = await supabase
    .from('block_list')
    .delete()
    .eq('account_id', accountId)
    .eq('type', 'email')
    .eq('value', blockedEmail);
  if (deleteError) {
    throw new Error(`replace-lead-attach: block_list cleanup failed: ${deleteError.message}`);
  }

  const { error: insertError } = await supabase.from('block_list').insert({
    account_id: accountId,
    type: 'email',
    value: blockedEmail,
    reason: 'unsubscribed',
  } as any);
  if (insertError) {
    throw new Error(`replace-lead-attach: block_list insert failed: ${insertError.message}`);
  }
}

function inboxUrl(threadId: string): string {
  return `${previewOrigin()}/inbox/${threadId}`;
}

export const replaceLeadAttachSeedModule: SeedModule = {
  id: 'replaceLeadAttach_seed',
  description:
    'Seed a campaign with inbox threads for replace-lead create/attach/siblings/blocklist/no-enrollment smoke tests',
  async run(ctx) {
    const accountId = process.env.SEED_ACCOUNT_ID?.trim();
    const ownerUserId = process.env.SEED_OWNER_USER_ID?.trim();
    if (!accountId || !ownerUserId) {
      throw new Error(
        'replace-lead-attach requires SEED_ACCOUNT_ID and SEED_OWNER_USER_ID (existing account/users rows).',
      );
    }

    const campaignId =
      process.env.SEED_REPLACE_LEAD_ATTACH_CAMPAIGN_ID?.trim() ||
      DEFAULT_SEED_REPLACE_LEAD_ATTACH_CAMPAIGN_ID;
    const mailboxEmail = replaceLeadAttachMailboxEmail(campaignId);
    const leads = buildLeads();

    if (ctx.dryRun) {
      ctx.log(
        `[dry-run] would seed campaign=${campaignId} name=${REPLACE_LEAD_ATTACH_CAMPAIGN_NAME} leads=${leads.length} domain=${REPLACE_LEAD_ATTACH_DOMAIN}`,
      );
      return;
    }

    const graph = await materializeCampaignGraph({
      supabase: ctx.supabase,
      accountId,
      ownerUserId,
      resetExistingCampaignSlice: true,
      spec: {
        namespace: REPLACE_LEAD_ATTACH_SEED_SOURCE,
        campaignId,
        name: REPLACE_LEAD_ATTACH_CAMPAIGN_NAME,
        status: 'running',
        flowKind: 'emailOnly',
        mailboxes: [
          {
            key: 'mailbox-1',
            emailAddress: mailboxEmail,
            displayName: 'Replace Attach Smoke',
          },
        ],
        leads,
      },
    });

    await upsertSeedBlockList(ctx.supabase, accountId);

    const createThread = graph.leadsByKey.get('create-source')?.threadId;
    const attachThread = graph.leadsByKey.get('attach-source')?.threadId;
    const forwardThread = graph.leadsByKey.get('forward-source')?.threadId;
    const siblingsThread = graph.leadsByKey.get('siblings-source')?.threadId;
    const blocklistThread = graph.leadsByKey.get('blocklist-source')?.threadId;
    const noEnrollThread = graph.leadsByKey.get('no-enroll-source')?.threadId;

    ctx.log(`replace-lead-attach seeded campaign=${graph.campaignId}`);
    ctx.log('');
    ctx.log('Smoke checklist (open thread → Replace lead):');
    ctx.log('');
    ctx.log('1) Create path');
    ctx.log(`   ${createThread ? inboxUrl(createThread) : '(missing thread)'}`);
    ctx.log('   Type any brand-new email like newperson@example.com');
    ctx.log('   Expect CTAs: Replace + forward / Just replace');
    ctx.log('');
    ctx.log('2) Attach path');
    ctx.log(`   ${attachThread ? inboxUrl(attachThread) : '(missing thread)'}`);
    ctx.log(`   Type: ${replaceLeadAttachEmail('blake.attach')}`);
    ctx.log('   Expect notice + CTAs: Use existing contact (+ forward)');
    ctx.log('   Change company/phone in the form — Blake should keep "Keep This Company" / 555-0100');
    ctx.log('');
    ctx.log('3) Attach + forward');
    ctx.log(`   ${forwardThread ? inboxUrl(forwardThread) : '(missing thread)'}`);
    ctx.log(`   Type: ${replaceLeadAttachEmail('blake.attach')}`);
    ctx.log('   Use existing contact + forward with a short note');
    ctx.log('');
    ctx.log('4) Sibling retirement');
    ctx.log(`   ${siblingsThread ? inboxUrl(siblingsThread) : '(missing thread)'}`);
    ctx.log(`   Type: ${replaceLeadAttachEmail('dupes')}`);
    ctx.log('   Expect notice that other copies will stop sending');
    ctx.log('');
    ctx.log('5) Block list warning');
    ctx.log(`   ${blocklistThread ? inboxUrl(blocklistThread) : '(missing thread)'}`);
    ctx.log(`   Type: ${replaceLeadAttachEmail('blocked.existing')}`);
    ctx.log('   Expect attach notice + unsubscribed block-list warning; submit still allowed');
    ctx.log('');
    ctx.log('6) No-enrollment guard');
    ctx.log(`   ${noEnrollThread ? inboxUrl(noEnrollThread) : '(missing thread)'}`);
    ctx.log(`   Type: ${replaceLeadAttachEmail('orphan')}`);
    ctx.log('   Expect submit blocked (no live enrollment)');
    ctx.log('');
    ctx.log(`Campaign: /campaigns/${graph.campaignId}`);
    ctx.log(`Mailbox: ${mailboxEmail}`);
  },
};
