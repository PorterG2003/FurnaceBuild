import { createClient } from '@supabase/supabase-js';
import {
  CAMPAIGN_HTML_QA_SENDER,
  CAMPAIGN_HTML_QA_SAMPLES,
  getCampaignHtmlQaSample,
  type CampaignHtmlQaSampleId,
} from '../lib/email/campaignHtmlQaSamples.js';
import { loadSeedEnv } from './seed/env.js';

loadSeedEnv();

type Args = {
  to: string;
  sample: CampaignHtmlQaSampleId;
  dryRun: boolean;
};

function parseArgs(argv: string[]): Args {
  let to = process.env.QA_EMAIL_TO?.trim() ?? '';
  let sample: CampaignHtmlQaSampleId = 'heavy';
  let dryRun = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--to' && argv[i + 1]) {
      to = argv[++i]!.trim();
    } else if (arg === '--sample' && argv[i + 1]) {
      const next = argv[++i]!.trim() as CampaignHtmlQaSampleId;
      if (!CAMPAIGN_HTML_QA_SAMPLES.some((entry) => entry.id === next)) {
        throw new Error(`--sample must be one of: ${CAMPAIGN_HTML_QA_SAMPLES.map((entry) => entry.id).join(', ')}`);
      }
      sample = next;
    } else if (arg === '--dry-run') {
      dryRun = true;
    }
  }

  return { to, sample, dryRun };
}

async function main(): Promise<void> {
  const { to, sample: sampleId, dryRun } = parseArgs(process.argv.slice(2));
  const supabaseUrl = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  const accountId = process.env.SEED_ACCOUNT_ID?.trim();
  const ownerUserId = process.env.SEED_OWNER_USER_ID?.trim();

  if (!to && !dryRun) {
    throw new Error('Usage: npm run send:campaign-html-qa -- --to you@example.com [--sample light|medium|heavy]');
  }
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing Supabase configuration. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY).');
  }
  if (!accountId || !ownerUserId) {
    throw new Error('Missing SEED_ACCOUNT_ID or SEED_OWNER_USER_ID for campaign live QA.');
  }

  const sample = getCampaignHtmlQaSample(sampleId);
  console.log(`${dryRun ? 'Dry run' : 'Queueing'} campaign HTML QA sample "${sample.label}"`);
  console.log(`From: ${CAMPAIGN_HTML_QA_SENDER}`);
  console.log(`To:   ${to || '(dry-run recipient omitted)'}`);

  if (dryRun) {
    console.log(`Subject: ${sample.subject}`);
    return;
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data: mailbox, error: mailboxError } = await supabase
    .from('mailboxes')
    .select('id, account_id, email_address, display_name')
    .eq('email_address', CAMPAIGN_HTML_QA_SENDER)
    .eq('account_id', accountId)
    .maybeSingle();

  if (mailboxError) {
    throw new Error(`Failed to load QA mailbox: ${mailboxError.message}`);
  }
  if (!mailbox?.id) {
    throw new Error(`No mailbox found for ${CAMPAIGN_HTML_QA_SENDER} in account ${accountId}.`);
  }

  const now = new Date().toISOString();
  const campaignName = `[QA] Campaign HTML ${sample.label} ${now}`;

  const { data: campaign, error: campaignError } = await supabase
    .from('campaigns')
    .insert({
      name: campaignName,
      owner_id: ownerUserId,
      account_id: accountId,
      organization_id: null,
      status: 'running',
      flow_data: { nodes: [], edges: [] },
      schedule: null,
      sending_interval_seconds: 300,
      created_at: now,
      updated_at: now,
    })
    .select('id, bucket_id')
    .single();

  if (campaignError || !campaign) {
    throw new Error(`Failed to create QA campaign: ${campaignError?.message ?? 'unknown error'}`);
  }

  const { data: lead, error: leadError } = await supabase
    .from('leads')
    .insert({
      campaign_id: campaign.id,
      bucket_id: campaign.bucket_id,
      account_id: accountId,
      email: to,
      name: 'Campaign HTML QA Recipient',
      first_name: 'Porter',
      company_name: 'Furnace QA',
    })
    .select('id, email, name')
    .single();

  if (leadError || !lead) {
    throw new Error(`Failed to create QA lead: ${leadError?.message ?? 'unknown error'}`);
  }

  const { data: enrollment, error: enrollmentError } = await supabase
    .from('enrollments')
    .insert({
      campaign_id: campaign.id,
      account_id: accountId,
      lead_id: lead.id,
      state: 'active',
      next_run_at: now,
      flow_position: {},
      created_at: now,
      updated_at: now,
    })
    .select('id')
    .single();

  if (enrollmentError || !enrollment) {
    throw new Error(`Failed to create QA enrollment: ${enrollmentError?.message ?? 'unknown error'}`);
  }

  const flowNodeId = `html-qa-${Date.now()}`;
  const nodeConfig = {
    subject: sample.subject,
    template: sample.bodyText,
    body_html: sample.bodyHtml,
    body_text: sample.bodyText,
    editor_mode: 'html' as const,
  };

  const { data: node, error: nodeError } = await supabase
    .from('nodes')
    .insert({
      campaign_id: campaign.id,
      account_id: accountId,
      flow_node_id: flowNodeId,
      node_type: 'email',
      node_data: nodeConfig,
      position_x: 0,
      position_y: 0,
    })
    .select('id')
    .single();

  if (nodeError || !node) {
    throw new Error(`Failed to create QA node: ${nodeError?.message ?? 'unknown error'}`);
  }

  const { data: messageJob, error: messageJobError } = await supabase
    .from('message_jobs')
    .insert({
      enrollment_id: enrollment.id,
      campaign_id: campaign.id,
      account_id: accountId,
      lead_id: lead.id,
      mailbox_id: mailbox.id,
      node_id: node.id,
      status: 'queued',
      scheduled_at: now,
      message_type: 'campaign',
      message_data: {
        node_config: nodeConfig,
        lead_data: {
          email: lead.email,
          name: lead.name,
          first_name: 'Porter',
          company_name: 'Furnace QA',
        },
      },
    })
    .select('id')
    .single();

  if (messageJobError || !messageJob) {
    throw new Error(`Failed to create QA message job: ${messageJobError?.message ?? 'unknown error'}`);
  }

  console.log(`Queued message_job=${messageJob.id} campaign=${campaign.id} mailbox=${mailbox.email_address}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
