/**
 * Queue a real multi-step campaign sequence on the dev seed account.
 *
 * Creates a running campaign (email → wait → email → wait → email), enrolls one lead,
 * and lets the scheduler + send worker drive sends and stats.
 *
 * Usage:
 *   npm run send:campaign-sequence-qa -- --to porterg2003@outlook.com
 *   npm run send:campaign-sequence-qa -- --to you@example.com --wait-minutes 20 --steps 3
 *   npm run send:campaign-sequence-qa -- --dry-run
 */
import { createClient } from '@supabase/supabase-js';
import type { Json } from '../lib/supabase/types/database.js';
import { CAMPAIGN_HTML_QA_SENDER } from '../lib/email/campaignHtmlQaSamples.js';
import { loadSeedEnv } from './seed/env.js';

loadSeedEnv();

const NODE_SYNC_TIMEOUT_MS = 30_000;
const NODE_SYNC_POLL_MS = 250;
const DEFAULT_WAIT_MINUTES = 25;
const DEFAULT_STEPS = 3;
const SENDING_INTERVAL_SECONDS = 300;

type Args = {
  to: string;
  from: string;
  accountId: string | null;
  ownerUserId: string | null;
  waitMinutes: number;
  steps: number;
  dryRun: boolean;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(argv: string[]): Args {
  let to = process.env.QA_EMAIL_TO?.trim() ?? '';
  let from = process.env.QA_EMAIL_FROM?.trim() || CAMPAIGN_HTML_QA_SENDER;
  let accountId: string | null = null;
  let ownerUserId = process.env.SEED_OWNER_USER_ID?.trim() || null;
  let waitMinutes = DEFAULT_WAIT_MINUTES;
  let steps = DEFAULT_STEPS;
  let dryRun = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--to' && argv[i + 1]) {
      to = argv[++i]!.trim();
    } else if (arg === '--from' && argv[i + 1]) {
      from = argv[++i]!.trim();
    } else if (arg === '--account-id' && argv[i + 1]) {
      accountId = argv[++i]!.trim();
    } else if (arg === '--owner-user-id' && argv[i + 1]) {
      ownerUserId = argv[++i]!.trim();
    } else if (arg === '--wait-minutes' && argv[i + 1]) {
      waitMinutes = Number.parseInt(argv[++i]!, 10);
    } else if (arg === '--steps' && argv[i + 1]) {
      steps = Number.parseInt(argv[++i]!, 10);
    } else if (arg === '--dry-run') {
      dryRun = true;
    }
  }

  return { to, from, accountId, ownerUserId, waitMinutes, steps, dryRun };
}

function buildSequenceFlowData(steps: number, waitMinutes: number): Json {
  const waitSeconds = waitMinutes * 60;
  const nodes: Record<string, unknown>[] = [
    {
      id: 'leadSource-1',
      type: 'leadSource',
      position: { x: 0, y: 0 },
      data: { label: 'Lead Source' },
    },
  ];
  const edges: Record<string, unknown>[] = [];

  for (let step = 1; step <= steps; step += 1) {
    const emailId = `email-${step}`;
    nodes.push({
      id: emailId,
      type: 'email',
      position: { x: 220 + (step - 1) * 480, y: 0 },
      data: {
        label: step === 1 ? 'Opener' : step === steps ? 'Final follow-up' : 'Follow-up',
        send_mode: 'new',
        variants: [
          {
            id: `10000000-0000-4000-8000-${String(step).padStart(12, '0')}`,
            label: 'A',
            subject: `[Seq QA ${step}/${steps}] Quick note for {{first_name}}`,
            template:
              step === 1
                ? 'Hi {{first_name}},\n\nThis is step 1 of a live Furnace sequence QA send from {{company_name}}. Reply if you got it.'
                : step === steps
                  ? 'Hi {{first_name}},\n\nFinal touch in this QA sequence. Thanks for helping us test stats and pacing.'
                  : 'Hi {{first_name}},\n\nFollowing up on my last note — checking whether this landed in your inbox.',
            isActive: true,
            order: 0,
          },
        ],
      },
    });

    if (step === 1) {
      edges.push({ id: 'e-lead-email-1', source: 'leadSource-1', target: emailId });
    } else {
      const waitId = `waitTime-${step - 1}`;
      edges.push({ id: `e-wait-${step - 1}-email-${step}`, source: waitId, target: emailId });
    }

    if (step < steps) {
      const waitId = `waitTime-${step}`;
      nodes.push({
        id: waitId,
        type: 'waitTime',
        position: { x: 340 + (step - 1) * 480, y: 0 },
        data: {
          label: `Wait ${waitMinutes}m`,
          wait_duration_seconds: waitSeconds,
        },
      });
      edges.push({ id: `e-email-${step}-wait-${step}`, source: emailId, target: waitId });
    }
  }

  return { nodes, edges } as Json;
}

async function pollNodeId(
  supabase: ReturnType<typeof createClient>,
  campaignId: string,
  flowNodeId: string,
): Promise<string> {
  const deadline = Date.now() + NODE_SYNC_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const { data, error } = await supabase
      .from('nodes')
      .select('id')
      .eq('campaign_id', campaignId)
      .eq('flow_node_id', flowNodeId)
      .is('deleted_at', null)
      .maybeSingle();

    if (error) {
      throw new Error(`Node lookup failed for ${flowNodeId}: ${error.message}`);
    }
    if (data?.id) {
      return data.id as string;
    }
    await sleep(NODE_SYNC_POLL_MS);
  }

  throw new Error(`Timed out waiting for node sync (${flowNodeId})`);
}

async function buildMergedMessageData(
  supabase: ReturnType<typeof createClient>,
  params: {
    campaignId: string;
    nodeId: string;
    leadData: Record<string, unknown>;
  },
): Promise<{ message_data: Record<string, unknown>; variant_id: string | null }> {
  const baseMessageData = { lead_data: params.leadData };
  const { data, error } = await supabase.rpc('merge_email_variant_into_message_job', {
    p_campaign_id: params.campaignId,
    p_node_id: params.nodeId,
    p_lead_data: params.leadData,
    p_base_message_data: baseMessageData,
  });

  if (error) {
    throw new Error(`Failed to merge email variant for node ${params.nodeId}: ${error.message}`);
  }

  const row = Array.isArray(data) ? data[0] : data;
  const mergedMessageData = (row?.merged_message_data ?? baseMessageData) as Record<string, unknown>;
  const variantId = (row?.chosen_variant_id as string | null | undefined) ?? null;

  return {
    message_data: mergedMessageData,
    variant_id: variantId,
  };
}

async function main(): Promise<void> {
  const { to, from, accountId: accountIdArg, ownerUserId: ownerUserIdArg, waitMinutes, steps, dryRun } =
    parseArgs(process.argv.slice(2));

  if (!to && !dryRun) {
    throw new Error(
      'Usage: npm run send:campaign-sequence-qa -- --to you@example.com [--from porter@furnaceoutbound.com] [--wait-minutes 25] [--steps 3]',
    );
  }
  if (steps < 2 || steps > 5) {
    throw new Error('--steps must be between 2 and 5');
  }
  if (waitMinutes < 1 || waitMinutes > 24 * 60) {
    throw new Error('--wait-minutes must be between 1 and 1440');
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY).');
  }

  const flowData = buildSequenceFlowData(steps, waitMinutes);
  const now = new Date().toISOString();
  const campaignName = `[QA] Sequence ${steps}x${waitMinutes}m ${now}`;

  console.log(`${dryRun ? 'Dry run' : 'Creating'} ${steps}-step sequence campaign`);
  console.log(`From: ${from}`);
  console.log(`To:   ${to || '(dry-run recipient omitted)'}`);
  console.log(`Wait: ${waitMinutes} minutes between emails`);

  if (dryRun) {
    console.log(JSON.stringify(flowData, null, 2));
    return;
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  let mailboxQuery = supabase
    .from('mailboxes')
    .select('id, account_id, user_id, email_address, display_name, status')
    .eq('email_address', from)
    .is('deleted_at', null);

  if (accountIdArg) {
    mailboxQuery = mailboxQuery.eq('account_id', accountIdArg);
  }

  const { data: mailbox, error: mailboxError } = await mailboxQuery
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (mailboxError) {
    throw new Error(`Failed to load sender mailbox: ${mailboxError.message}`);
  }
  if (!mailbox?.id) {
    throw new Error(
      `No connected mailbox found for ${from}${accountIdArg ? ` in account ${accountIdArg}` : ''}. Connect it in Senders first.`,
    );
  }

  const accountId = accountIdArg ?? (mailbox.account_id as string);
  const ownerUserId = ownerUserIdArg ?? (mailbox.user_id as string);

  if (!accountId || !ownerUserId) {
    throw new Error('Could not resolve account_id or owner user_id for the sender mailbox.');
  }

  console.log(`Account: ${accountId}`);

  const { data: campaign, error: campaignError } = await supabase
    .from('campaigns')
    .insert({
      name: campaignName,
      owner_id: ownerUserId,
      account_id: accountId,
      organization_id: null,
      status: 'running',
      flow_data: flowData,
      schedule: null,
      sending_interval_seconds: SENDING_INTERVAL_SECONDS,
      created_at: now,
      updated_at: now,
    })
    .select('id, bucket_id, name')
    .single();

  if (campaignError || !campaign) {
    throw new Error(`Failed to create QA campaign: ${campaignError?.message ?? 'unknown error'}`);
  }

  const { error: linkError } = await supabase.from('campaign_mailboxes').insert({
    campaign_id: campaign.id,
    mailbox_id: mailbox.id,
    account_id: accountId,
  });
  if (linkError) {
    throw new Error(`Failed to link campaign mailbox: ${linkError.message}`);
  }

  const flowNodeIds = ['leadSource-1'];
  for (let step = 1; step <= steps; step += 1) {
    flowNodeIds.push(`email-${step}`);
    if (step < steps) {
      flowNodeIds.push(`waitTime-${step}`);
    }
  }

  const nodeIds = new Map<string, string>();
  for (const flowNodeId of flowNodeIds) {
    nodeIds.set(flowNodeId, await pollNodeId(supabase, campaign.id, flowNodeId));
  }

  const { data: lead, error: leadError } = await supabase
    .from('leads')
    .insert({
      campaign_id: campaign.id,
      bucket_id: campaign.bucket_id,
      account_id: accountId,
      email: to,
      name: 'Porter Outlook QA',
      first_name: 'Porter',
      company_name: 'Furnace QA',
      mailbox_id: mailbox.id,
    })
    .select('id, email')
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
      current_node_id: null,
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

  const leadData = {
    email: lead.email,
    name: 'Porter Outlook QA',
    first_name: 'Porter',
    company_name: 'Furnace QA',
  };

  const { data: emailNodes, error: emailNodesError } = await supabase
    .from('nodes')
    .select('id, flow_node_id, node_data')
    .eq('campaign_id', campaign.id)
    .eq('node_type', 'email')
    .is('deleted_at', null)
    .order('created_at', { ascending: true });

  if (emailNodesError) {
    throw new Error(`Failed to load email nodes: ${emailNodesError.message}`);
  }

  const orderedEmailNodes = (emailNodes ?? [])
    .filter((node) => /^email-\d+$/.test(node.flow_node_id as string))
    .sort((left, right) => {
      const leftStep = Number.parseInt(String(left.flow_node_id).split('-')[1] ?? '0', 10);
      const rightStep = Number.parseInt(String(right.flow_node_id).split('-')[1] ?? '0', 10);
      return leftStep - rightStep;
    })
    .slice(0, steps);

  if (orderedEmailNodes.length !== steps) {
    throw new Error(`Expected ${steps} email nodes after sync, found ${orderedEmailNodes.length}.`);
  }

  const queuedJobIds: string[] = [];
  for (let step = 0; step < orderedEmailNodes.length; step += 1) {
    const emailNode = orderedEmailNodes[step]!;
    const scheduledAt = new Date(Date.now() + step * waitMinutes * 60_000).toISOString();
    const { message_data: messageData, variant_id: variantId } = await buildMergedMessageData(supabase, {
      campaignId: campaign.id,
      nodeId: emailNode.id as string,
      leadData,
    });

    const { data: messageJob, error: messageJobError } = await supabase
      .from('message_jobs')
      .insert({
        enrollment_id: enrollment.id,
        campaign_id: campaign.id,
        account_id: accountId,
        lead_id: lead.id,
        mailbox_id: mailbox.id,
        node_id: emailNode.id,
        status: 'queued',
        scheduled_at: scheduledAt,
        message_type: 'campaign',
        message_data: messageData,
        variant_id: variantId,
      })
      .select('id, scheduled_at')
      .single();

    if (messageJobError || !messageJob) {
      throw new Error(
        `Failed to queue step ${step + 1} message job: ${messageJobError?.message ?? 'unknown error'}`,
      );
    }

    queuedJobIds.push(messageJob.id as string);
    console.log(`  queued step ${step + 1}/${steps}: message_job=${messageJob.id} at ${messageJob.scheduled_at}`);
  }

  const lastEmailNodeId = orderedEmailNodes[orderedEmailNodes.length - 1]!.id as string;
  const { error: enrollmentParkError } = await supabase
    .from('enrollments')
    .update({
      current_node_id: lastEmailNodeId,
      next_run_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', enrollment.id);

  if (enrollmentParkError) {
    throw new Error(`Failed to park enrollment after queueing jobs: ${enrollmentParkError.message}`);
  }

  console.log('');
  console.log('Campaign sequence queued on send worker schedule.');
  console.log(`  campaign_id=${campaign.id}`);
  console.log(`  campaign_name=${campaign.name}`);
  console.log(`  enrollment_id=${enrollment.id}`);
  console.log(`  lead_id=${lead.id}`);
  console.log(`  mailbox=${mailbox.email_address} (${mailbox.status ?? 'unknown status'})`);
  console.log(`  message_jobs=${queuedJobIds.join(', ')}`);
  console.log('');
  console.log('Timeline (approx):');
  for (let step = 1; step <= steps; step += 1) {
    const offsetMinutes = (step - 1) * waitMinutes;
    console.log(`  Email ${step}/${steps}: ~${offsetMinutes} min from now`);
  }
  console.log('');
  console.log('Ensure dev send worker is running (infra/workers: npm run scale:dev).');
  console.log('Watch campaign stats in the app as each step sends.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
