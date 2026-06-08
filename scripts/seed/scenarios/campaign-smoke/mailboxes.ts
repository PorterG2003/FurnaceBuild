import type { SeedContext, SeedModule } from '../../types';
import { campaignIdShort } from '../../constants/campaignSmoke';
import { smokeMailboxDisplayName, smokeMailboxLocalPart } from '../../theme/falloutCopy';
import { campaignSmokeStore } from './store';

async function ensureMailbox(
  ctx: SeedContext,
  params: {
    email_address: string;
    display_name: string;
    smtp_username: string;
    imap_username: string;
  }
): Promise<string> {
  const { supabase } = ctx;
  const { accountId, ownerUserId } = campaignSmokeStore;
  const now = new Date().toISOString();

  const { data: found, error: findErr } = await supabase
    .from('mailboxes')
    .select('id')
    .eq('account_id', accountId)
    .eq('email_address', params.email_address)
    .maybeSingle();

  if (findErr) {
    throw new Error(`campaign-smoke: mailbox lookup failed: ${findErr.message}`);
  }

  if (found?.id) {
    const { error: upErr } = await supabase
      .from('mailboxes')
      .update({
        display_name: params.display_name,
        status: 'connected',
        deleted_at: null,
        updated_at: now,
      })
      .eq('id', found.id);
    if (upErr) {
      throw new Error(`campaign-smoke: mailbox update failed: ${upErr.message}`);
    }
    return found.id as string;
  }

  const { data: created, error: insErr } = await supabase
    .from('mailboxes')
    .insert({
      account_id: accountId,
      user_id: ownerUserId,
      email_address: params.email_address,
      display_name: params.display_name,
      provider: 'gmail',
      smtp_host: 'smtp.gmail.com',
      smtp_port: 587,
      smtp_username: params.smtp_username,
      smtp_password: 'test-password',
      smtp_use_tls: true,
      smtp_use_ssl: false,
      imap_host: 'imap.gmail.com',
      imap_port: 993,
      imap_username: params.imap_username,
      imap_password: 'test-password',
      imap_use_ssl: true,
      status: 'connected',
      created_at: now,
      updated_at: now,
    })
    .select('id')
    .single();

  if (insErr || !created) {
    throw new Error(`campaign-smoke: mailbox insert failed: ${insErr?.message}`);
  }
  return created.id as string;
}

export const campaignSmokeMailboxesModule: SeedModule = {
  id: 'campaignSmoke_mailboxes',
  description: 'Ensure two @furnace.test mailboxes and campaign_mailboxes links',
  deps: ['campaignSmoke_campaign'],
  async run(ctx) {
    const { supabase } = ctx;
    const { campaignId, accountId } = campaignSmokeStore;
    const slice = campaignIdShort(campaignId);

    if (ctx.dryRun) {
      ctx.log(`[dry-run] would ensure mailboxes + campaign_mailboxes for campaign=${campaignId}`);
      return;
    }

    const local1 = smokeMailboxLocalPart(1, slice);
    const local2 = smokeMailboxLocalPart(2, slice);
    const email1 = `${local1}@furnace.test`;
    const email2 = `${local2}@furnace.test`;

    const id1 = await ensureMailbox(ctx, {
      email_address: email1,
      display_name: smokeMailboxDisplayName(1),
      smtp_username: `${local1}@furnace.test`,
      imap_username: `${local1}@furnace.test`,
    });
    const id2 = await ensureMailbox(ctx, {
      email_address: email2,
      display_name: smokeMailboxDisplayName(2),
      smtp_username: `${local2}@furnace.test`,
      imap_username: `${local2}@furnace.test`,
    });

    campaignSmokeStore.mailboxIds = [id1, id2];

    const { error: delErr } = await supabase
      .from('campaign_mailboxes')
      .delete()
      .eq('campaign_id', campaignId);
    if (delErr) {
      throw new Error(`campaign-smoke: campaign_mailboxes delete failed: ${delErr.message}`);
    }

    const { error: linkErr } = await supabase.from('campaign_mailboxes').insert([
      { campaign_id: campaignId, mailbox_id: id1, account_id: accountId },
      { campaign_id: campaignId, mailbox_id: id2, account_id: accountId },
    ]);
    if (linkErr) {
      throw new Error(`campaign-smoke: campaign_mailboxes insert failed: ${linkErr.message}`);
    }

    ctx.log(`mailboxes linked campaign=${campaignId} mailboxIds=${id1},${id2}`);
  },
};
