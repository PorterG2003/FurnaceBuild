import { DEFAULT_SEED_CAMPAIGN_ID, campaignIdShort } from './constants/campaignSmoke';
import {
  DEFAULT_SEED_OOO_CAMPAIGN_ID,
  type OooInboxCaseKey,
} from './constants/oooMixedInbox';
import {
  DEFAULT_SEED_SMART_HANDLING_AI_CAMPAIGN_ID,
  DEFAULT_SEED_SMART_HANDLING_MANUAL_CAMPAIGN_ID,
  smartHandlingMailboxLocalPart,
} from './constants/smartHandlingFlow';
import {
  DEFAULT_SEED_REPLACE_LEAD_ATTACH_CAMPAIGN_ID,
  replaceLeadAttachMailboxEmail,
} from './constants/replaceLeadAttach';
import {
  DEV_DEFAULT_CAMPAIGN_IDS,
  DEV_DEFAULT_MAILBOX_SPECS,
} from '../../lib/test/campaign/productionLikeSeed';
import {
  DEMO_HUB_CAMPAIGN_IDS,
  DEMO_HUB_MAILBOX_SPECS,
} from '../../lib/test/campaign/demoHubSeed';
import { smokeMailboxLocalPart } from './theme/falloutCopy';
import {
  OOO_CASE_COPY,
  oooMailboxEmailLocalPart,
} from './theme/falloutOooCopy';
import type { SeedContext } from './types';

export type ResetScope =
  | 'campaign-smoke'
  | 'ooo-mixed-inbox'
  | 'dev-default'
  | 'demo-hub'
  | 'smart-handling-flow'
  | 'replace-lead-attach';

export type ScopePlan = {
  scope: ResetScope;
  campaignId: string;
  accountId: string;
  mailboxEmails: string[];
};

export type ScopeCounts = {
  emailMessages: number;
  emailThreads: number;
  messageJobs: number;
  enrollments: number;
  leads: number;
  campaignMailboxes: number;
  mailboxes: number;
  campaignExists: number;
};

export function resolveScopePlans(
  accountId: string,
  requestedScope:
    | 'campaign-smoke'
    | 'ooo-mixed-inbox'
    | 'dev-default'
    | 'demo-hub'
    | 'smart-handling-flow'
    | 'replace-lead-attach'
    | 'all'
    | null
): ScopePlan[] {
  const plans: ScopePlan[] = [];
  const wantCampaignSmoke =
    requestedScope === 'campaign-smoke' ||
    requestedScope === 'all' ||
    (!requestedScope && !!process.env.SEED_CAMPAIGN_ID);
  const wantOoo =
    requestedScope === 'ooo-mixed-inbox' ||
    requestedScope === 'all' ||
    (!requestedScope && !!process.env.SEED_OOO_CAMPAIGN_ID);
  const wantDevDefault =
    requestedScope === 'dev-default' || requestedScope === 'all';
  const wantDemoHub = requestedScope === 'demo-hub' || requestedScope === 'all';
  const wantSmartHandling =
    requestedScope === 'smart-handling-flow' || requestedScope === 'all';
  const wantReplaceLeadAttach =
    requestedScope === 'replace-lead-attach' || requestedScope === 'all';

  if (
    !wantCampaignSmoke &&
    !wantOoo &&
    !wantDevDefault &&
    !wantDemoHub &&
    !wantSmartHandling &&
    !wantReplaceLeadAttach
  ) {
    throw new Error(
      'seed:reset requires an explicit scope (--scope=campaign-smoke|ooo-mixed-inbox|dev-default|demo-hub|smart-handling-flow|replace-lead-attach|all) or at least one scoped campaign env (SEED_CAMPAIGN_ID / SEED_OOO_CAMPAIGN_ID).'
    );
  }

  if (wantCampaignSmoke) {
    const campaignId = process.env.SEED_CAMPAIGN_ID?.trim() || DEFAULT_SEED_CAMPAIGN_ID;
    const slice = campaignIdShort(campaignId);
    plans.push({
      scope: 'campaign-smoke',
      campaignId,
      accountId,
      mailboxEmails: [
        `${smokeMailboxLocalPart(1, slice)}@furnace.test`,
        `${smokeMailboxLocalPart(2, slice)}@furnace.test`,
      ],
    });
  }

  if (wantOoo) {
    const campaignId =
      process.env.SEED_OOO_CAMPAIGN_ID?.trim() ||
      process.env.SEED_CAMPAIGN_ID?.trim() ||
      DEFAULT_SEED_OOO_CAMPAIGN_ID;
    plans.push({
      scope: 'ooo-mixed-inbox',
      campaignId,
      accountId,
      mailboxEmails: OOO_CASE_COPY.map((copy) =>
        `${oooMailboxEmailLocalPart(campaignId, copy.mailboxLocalBase)}@furnace.test`
      ),
    });
  }

  if (wantDevDefault) {
    for (const campaignId of DEV_DEFAULT_CAMPAIGN_IDS) {
      plans.push({
        scope: 'dev-default',
        campaignId,
        accountId,
        mailboxEmails: DEV_DEFAULT_MAILBOX_SPECS.map((mailbox) => mailbox.emailAddress),
      });
    }
  }

  if (wantDemoHub) {
    for (const campaignId of DEMO_HUB_CAMPAIGN_IDS) {
      plans.push({
        scope: 'demo-hub',
        campaignId,
        accountId,
        mailboxEmails: DEMO_HUB_MAILBOX_SPECS.map((mailbox) => mailbox.emailAddress),
      });
    }
  }

  if (wantSmartHandling) {
    const manualCampaignId =
      process.env.SEED_SMART_HANDLING_MANUAL_CAMPAIGN_ID?.trim() ||
      DEFAULT_SEED_SMART_HANDLING_MANUAL_CAMPAIGN_ID;
    const aiCampaignId =
      process.env.SEED_SMART_HANDLING_AI_CAMPAIGN_ID?.trim() ||
      DEFAULT_SEED_SMART_HANDLING_AI_CAMPAIGN_ID;
    plans.push({
      scope: 'smart-handling-flow',
      campaignId: manualCampaignId,
      accountId,
      mailboxEmails: [
        `${smartHandlingMailboxLocalPart('manual', manualCampaignId)}@furnace.test`,
      ],
    });
    plans.push({
      scope: 'smart-handling-flow',
      campaignId: aiCampaignId,
      accountId,
      mailboxEmails: [
        `${smartHandlingMailboxLocalPart('ai', aiCampaignId)}@furnace.test`,
      ],
    });
  }

  if (wantReplaceLeadAttach) {
    const campaignId =
      process.env.SEED_REPLACE_LEAD_ATTACH_CAMPAIGN_ID?.trim() ||
      DEFAULT_SEED_REPLACE_LEAD_ATTACH_CAMPAIGN_ID;
    plans.push({
      scope: 'replace-lead-attach',
      campaignId,
      accountId,
      mailboxEmails: [replaceLeadAttachMailboxEmail(campaignId)],
    });
  }

  return plans;
}

async function countByFilter(
  ctx: SeedContext,
  table: string,
  filter: (query: any) => any
): Promise<number> {
  let query = ctx.supabase.from(table).select('id', { count: 'exact', head: true });
  query = filter(query);
  const { count, error } = await query;
  if (error) {
    throw new Error(`seed:reset count failed for ${table}: ${error.message}`);
  }
  return count ?? 0;
}

export async function collectScopeCounts(
  ctx: SeedContext,
  plan: ScopePlan
): Promise<ScopeCounts> {
  const { data: threadRows, error: threadErr } = await ctx.supabase
    .from('email_threads')
    .select('id')
    .eq('campaign_id', plan.campaignId);
  if (threadErr) {
    throw new Error(`seed:reset thread lookup failed: ${threadErr.message}`);
  }
  const threadIds = (threadRows ?? []).map((row: any) => row.id as string);

  return {
    emailMessages:
      threadIds.length > 0
        ? await countByFilter(ctx, 'email_messages', (q) => q.in('thread_id', threadIds))
        : 0,
    emailThreads: threadIds.length,
    messageJobs: await countByFilter(ctx, 'message_jobs', (q) =>
      q.eq('campaign_id', plan.campaignId)
    ),
    enrollments: await countByFilter(ctx, 'enrollments', (q) =>
      q.eq('campaign_id', plan.campaignId)
    ),
    leads: await countByFilter(ctx, 'leads', (q) => q.eq('campaign_id', plan.campaignId)),
    campaignMailboxes: await countByFilter(ctx, 'campaign_mailboxes', (q) =>
      q.eq('campaign_id', plan.campaignId)
    ),
    mailboxes:
      plan.mailboxEmails.length > 0
        ? await countByFilter(ctx, 'mailboxes', (q) =>
            q.eq('account_id', plan.accountId).in('email_address', plan.mailboxEmails)
          )
        : 0,
    campaignExists: await countByFilter(ctx, 'campaigns', (q) => q.eq('id', plan.campaignId)),
  };
}

export async function resetScopePlan(
  ctx: SeedContext,
  plan: ScopePlan
): Promise<ScopeCounts> {
  const counts = await collectScopeCounts(ctx, plan);

  const { data: threadRows, error: threadErr } = await ctx.supabase
    .from('email_threads')
    .select('id')
    .eq('campaign_id', plan.campaignId);
  if (threadErr) {
    throw new Error(`seed:reset thread lookup failed: ${threadErr.message}`);
  }
  const threadIds = (threadRows ?? []).map((row: any) => row.id as string);

  if (threadIds.length > 0) {
    const { error: msgErr } = await ctx.supabase
      .from('email_messages')
      .delete()
      .in('thread_id', threadIds);
    if (msgErr) {
      throw new Error(`seed:reset email_messages delete failed: ${msgErr.message}`);
    }
  }

  const { error: threadDeleteErr } = await ctx.supabase
    .from('email_threads')
    .delete()
    .eq('campaign_id', plan.campaignId);
  if (threadDeleteErr) {
    throw new Error(`seed:reset email_threads delete failed: ${threadDeleteErr.message}`);
  }

  const { error: jobErr } = await ctx.supabase
    .from('message_jobs')
    .delete()
    .eq('campaign_id', plan.campaignId);
  if (jobErr) {
    throw new Error(`seed:reset message_jobs delete failed: ${jobErr.message}`);
  }

  const { error: enrollmentErr } = await ctx.supabase
    .from('enrollments')
    .delete()
    .eq('campaign_id', plan.campaignId);
  if (enrollmentErr) {
    throw new Error(`seed:reset enrollments delete failed: ${enrollmentErr.message}`);
  }

  const { error: leadsErr } = await ctx.supabase
    .from('leads')
    .delete()
    .eq('campaign_id', plan.campaignId);
  if (leadsErr) {
    throw new Error(`seed:reset leads delete failed: ${leadsErr.message}`);
  }

  const { error: linksErr } = await ctx.supabase
    .from('campaign_mailboxes')
    .delete()
    .eq('campaign_id', plan.campaignId);
  if (linksErr) {
    throw new Error(`seed:reset campaign_mailboxes delete failed: ${linksErr.message}`);
  }

  if (plan.mailboxEmails.length > 0) {
    const { error: mailboxErr } = await ctx.supabase
      .from('mailboxes')
      .update({
        deleted_at: new Date().toISOString(),
        status: 'disconnected',
        updated_at: new Date().toISOString(),
      })
      .eq('account_id', plan.accountId)
      .in('email_address', plan.mailboxEmails);
    if (mailboxErr) {
      throw new Error(`seed:reset mailboxes soft-delete failed: ${mailboxErr.message}`);
    }
  }

  const { error: campaignErr } = await ctx.supabase
    .from('campaigns')
    .delete()
    .eq('id', plan.campaignId)
    .eq('account_id', plan.accountId);
  if (campaignErr) {
    throw new Error(`seed:reset campaign delete failed: ${campaignErr.message}`);
  }

  return counts;
}
