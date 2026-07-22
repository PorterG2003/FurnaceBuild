/**
 * Create Bravara "Eval & Draft July 2026" as a draft native campaign.
 *
 * Usage:
 *   SELF_RECOVERY_TARGET_ENV=prod npx tsx scripts/setup-bravara-eval-draft-campaign.ts
 *   SELF_RECOVERY_TARGET_ENV=prod npx tsx scripts/setup-bravara-eval-draft-campaign.ts --dry-run
 */
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { prepareFlowSave } from '../lib/campaigns/flow/prepareFlowSave.js';
import type { CampaignFlowData } from '../lib/campaigns/flow/types.js';
import { canonicalizeEmailContentForSave } from '../lib/email/emailHtmlMode.js';
import type { Database } from '../lib/supabase/types/database.js';
import { updateCampaignFlowDataWithClient } from '../lib/supabase/services/campaigns/update-campaign-flow-with-client.js';
import {
  fetchSecretFromParameterStore,
  loadSelfRecoveryEnv,
  resolveSecretParamPathForTarget,
  resolveSelfRecoveryTargetEnv,
  resolveSupabaseUrlForTarget,
} from './self-recovery-env.js';

loadSelfRecoveryEnv();

type DbClient = SupabaseClient<Database>;

const BRAVARA_ACCOUNT_ID = 'db4ddb6a-a6b8-4748-8cea-ca43e1a40ef2';
const OWNER_USER_ID = 'aaddaba0-19e1-4a8e-afec-05e02c779325';
const CAMPAIGN_NAME = 'Eval & Draft July 2026';
const SENDING_INTERVAL_SECONDS = 1500;
const SCHEDULE = {
  timezone: 'America/Chicago',
  start_hour: 9,
  start_minute: 0,
  end_hour: 18,
  end_minute: 0,
  days_of_week: [1, 2, 3, 4, 5, 6, 0],
};

const EMAIL_1_SUBJECT =
  '{Eval and Draft Question|Eval and Draft question|Evals and Draft Question|Evals & Draft Question|Eval & Draft Question|Quick Eval and Draft Question}';

const EMAIL_1_BODY = `Hi {{first_name}},

{I'm a coach, my name is Mike|My name is Mike, and I'm a coach|I'm Mike - I'm a coach}. {I built|I put together|I created} a {tool|simple tool|system} for {board members|league board members|volunteer board members} to make {evaluations and forming teams|player evals and team formation|evals and building teams} {way easier|a lot easier|much easier}.

{Coaches|Your coaches} just {score|rate} players on their phones, {everything gets merged behind the scenes|all the scores get merged automatically|scores sync and get averaged automatically}, and teams end up {a lot more fair|much more balanced|way more even}.

{It's already being used by|We're already working with|It's live with} {200+|over 200|200-plus} leagues.

{Even if you don't run evals|Even if your league skips evaluations|And even if you don't do evals}, it can still {automatically generate|auto-build|generate} {balanced teams|even teams|fair rosters} using {any criteria|whatever criteria you want|your own criteria}, and it {works with|integrates with|plugs into} your {current registration software|existing registration software|registration system}.

{Want me to shoot over a quick link?|Want me to send over a quick link?|Mind if I shoot over a quick link?}

{If it's not a priority right now, just let me know and you won't hear from me.|If this isn't a priority right now, just say so and I won't follow up.|No worries if timing is off - just let me know and I'll leave you alone.}`;

const EMAIL_2_BODY =
  '{Just let me know!|Happy to send the link over if useful!|Want me to send that link?}';

function parseArgs(argv: string[]): { dryRun: boolean } {
  return { dryRun: argv.includes('--dry-run') };
}

async function createSupabaseClient(): Promise<DbClient> {
  const targetEnv = resolveSelfRecoveryTargetEnv();
  const { url } = resolveSupabaseUrlForTarget(targetEnv);
  const awsRegion =
    process.env.AWS_REGION?.trim() ||
    process.env.CDK_DEFAULT_REGION?.trim() ||
    'us-west-2';

  let resolvedKey =
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    null;

  const secretParamPath = resolveSecretParamPathForTarget(targetEnv);
  if (secretParamPath) {
    resolvedKey = await fetchSecretFromParameterStore(secretParamPath, awsRegion);
  }

  if (!url || !resolvedKey) {
    throw new Error('Missing Supabase URL or service role key.');
  }

  return createClient(url, resolvedKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Convert plain-text paragraphs into richText HTML matching Bravara's Mike sequences. */
function plainTextToRichHtml(body: string): string {
  return body
    .trim()
    .split(/\n{2,}/)
    .map((paragraph) => {
      const withBreaks = escapeHtml(paragraph).replace(/\n/g, '<br />');
      return `<p>${withBreaks}</p>`;
    })
    .join('');
}

function buildEmailVariant(subject: string, bodyText: string) {
  const bodyHtml = plainTextToRichHtml(bodyText);
  const canonical = canonicalizeEmailContentForSave({
    editorMode: 'richText',
    bodyHtml,
    bodyText,
    template: bodyText,
  });
  return {
    id: randomUUID(),
    label: 'A',
    order: 0,
    subject,
    isActive: true,
    template: canonical.template,
    body_html: canonical.bodyHtml,
    body_text: canonical.bodyText,
    editor_mode: canonical.editorMode,
  };
}

function buildFlow(bucketId: string): CampaignFlowData {
  return {
    nodes: [
      {
        id: 'leadSource-1',
        type: 'leadSource',
        position: { x: 0, y: 0 },
        data: {
          label: 'Lead Bucket',
          bucketId,
          isRequired: true,
          mappedStandardFieldKeys: ['email', 'first_name', 'last_name', 'company_name'],
          customFieldKeys: [],
        },
        deletable: false,
      },
      {
        id: 'email-1',
        type: 'email',
        position: { x: 220, y: 0 },
        data: {
          label: 'Email 1',
          priority: false,
          mailboxId: '',
          variants: [buildEmailVariant(EMAIL_1_SUBJECT, EMAIL_1_BODY)],
        },
      },
      {
        id: 'waitTime-2',
        type: 'waitTime',
        position: { x: 440, y: 0 },
        data: {
          label: 'Wait 3 days',
          duration: '3',
          unit: 'days',
          wait_duration_seconds: 259200,
        },
      },
      {
        id: 'email-2',
        type: 'email',
        position: { x: 660, y: 0 },
        data: {
          label: 'Email 2',
          priority: false,
          mailboxId: '',
          // Empty subject continues the Email 1 thread.
          variants: [buildEmailVariant('', EMAIL_2_BODY)],
        },
      },
    ],
    edges: [
      { id: 'edge-leadSource-1-email-1', source: 'leadSource-1', target: 'email-1' },
      { id: 'edge-email-1-waitTime-2', source: 'email-1', target: 'waitTime-2' },
      { id: 'edge-waitTime-2-email-2', source: 'waitTime-2', target: 'email-2' },
    ],
  };
}

async function main() {
  const { dryRun } = parseArgs(process.argv.slice(2));
  const db = await createSupabaseClient();
  const targetEnv = resolveSelfRecoveryTargetEnv();

  const { data: mailboxes, error: mailboxError } = await db
    .from('mailboxes')
    .select('id, email_address, status')
    .eq('account_id', BRAVARA_ACCOUNT_ID)
    .is('deleted_at', null)
    .eq('status', 'connected')
    .order('email_address', { ascending: true });
  if (mailboxError) {
    throw new Error(`Failed to load mailboxes: ${mailboxError.message}`);
  }
  const mailboxIds = (mailboxes ?? []).map((row) => row.id);
  if (mailboxIds.length === 0) {
    throw new Error('No connected mailboxes available on Bravara account.');
  }

  const previewFlow = buildFlow(randomUUID());
  const preparedPreview = await prepareFlowSave({
    incomingFlow: previewFlow,
    existingFlow: { nodes: [], edges: [] },
    campaignStatus: 'draft',
    phase: 'draft',
  });

  console.log(
    JSON.stringify(
      {
        targetEnv,
        dryRun,
        campaignName: CAMPAIGN_NAME,
        accountId: BRAVARA_ACCOUNT_ID,
        ownerId: OWNER_USER_ID,
        mailboxCount: mailboxIds.length,
        schedule: SCHEDULE,
        sendingIntervalSeconds: SENDING_INTERVAL_SECONDS,
        flowNodes: preparedPreview.flow.nodes.length,
        flowEdges: preparedPreview.flow.edges.length,
        email1Subject: EMAIL_1_SUBJECT,
        email2Subject: '(empty / same thread)',
      },
      null,
      2,
    ),
  );

  if (dryRun) {
    return;
  }

  const now = new Date().toISOString();
  const { data: created, error: createError } = await db
    .from('campaigns')
    .insert({
      account_id: BRAVARA_ACCOUNT_ID,
      owner_id: OWNER_USER_ID,
      organization_id: null,
      name: CAMPAIGN_NAME,
      status: 'draft',
      source: 'manual',
      schedule: SCHEDULE,
      sending_interval_seconds: SENDING_INTERVAL_SECONDS,
      created_at: now,
      updated_at: now,
    } as never)
    .select('id, name, status, bucket_id, account_id')
    .single();

  if (createError || !created) {
    throw new Error(`Failed to create campaign: ${createError?.message ?? 'no row returned'}`);
  }
  if (!created.bucket_id) {
    throw new Error(`Campaign ${created.id} created without bucket_id`);
  }

  const flow = buildFlow(created.bucket_id);
  const prepared = await prepareFlowSave({
    incomingFlow: flow,
    existingFlow: { nodes: [], edges: [] },
    campaignStatus: 'draft',
    phase: 'draft',
  });

  await updateCampaignFlowDataWithClient(db, {
    campaignId: created.id,
    accountId: created.account_id,
    flowData: prepared.flow as never,
    changeSource: 'bravara_eval_draft_setup',
  });

  const { error: insertMailboxError } = await db.from('campaign_mailboxes').insert(
    mailboxIds.map((mailboxId) => ({
      campaign_id: created.id,
      mailbox_id: mailboxId,
      account_id: created.account_id,
    })) as never,
  );
  if (insertMailboxError) {
    throw new Error(`Failed to assign campaign mailboxes: ${insertMailboxError.message}`);
  }

  console.log(
    JSON.stringify(
      {
        status: 'draft',
        campaignId: created.id,
        campaignName: created.name,
        bucketId: created.bucket_id,
        mailboxCount: mailboxIds.length,
        flowRevision: prepared.flow_revision,
        launch: false,
        leads: 0,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error('[setup-bravara-eval-draft-campaign]', error instanceof Error ? error.message : error);
  process.exit(1);
});
