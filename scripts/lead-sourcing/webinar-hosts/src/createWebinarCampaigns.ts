/**
 * Create the three Webinar Host campaigns in Furnace prod and import leads.
 *
 * Required env (prod Supabase — Client API key alone cannot create campaigns or set flow_data):
 *   FURNACE_SUPABASE_URL
 *   FURNACE_SUPABASE_SERVICE_ROLE_KEY
 *   FURNACE_ACCOUNT_ID
 *   FURNACE_OWNER_USER_ID
 *
 * Optional:
 *   FURNACE_MAILBOX_IDS          comma-separated; defaults to all active account mailboxes
 *   FURNACE_WAIT_DAYS            days between emails (default 3)
 *   FURNACE_CAMPAIGN_STATUS      draft | running (default draft)
 *   FURNACE_RUN_DIR              default output/runs/stage1-live
 *   FURNACE_IMPORT_ONLY          if set, skip campaign creation; use *_CAMPAIGN_ID env vars
 *   FURNACE_CORE_CAMPAIGN_ID / FURNACE_REVENUE_CAMPAIGN_ID / FURNACE_COMMUNITY_CAMPAIGN_ID
 *
 * Usage:
 *   cd scripts/lead-sourcing/webinar-hosts
 *   FURNACE_SUPABASE_URL=... FURNACE_SUPABASE_SERVICE_ROLE_KEY=... \
 *     FURNACE_ACCOUNT_ID=... FURNACE_OWNER_USER_ID=... \
 *     npm run create-campaigns -- --dry-run
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { parse } from 'csv-parse/sync';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, '..');

loadEnv({ path: join(PACKAGE_ROOT, '.env') });
loadEnv({ path: join(PACKAGE_ROOT, '.env.local'), override: true });

type SequenceKey = 'CORE' | 'REVENUE' | 'COMMUNITY';

type EmailCopy = {
  subject: string;
  body: string;
};

type SequenceCopy = {
  key: SequenceKey;
  emails: [EmailCopy, EmailCopy, EmailCopy];
};

type CampaignSpec = {
  key: SequenceKey;
  name: string;
  importFile: string;
  envCampaignIdKey: string;
};

const CAMPAIGNS: CampaignSpec[] = [
  {
    key: 'CORE',
    name: 'Webinar — Core',
    importFile: 'campaign-import/furnace_import_core.csv',
    envCampaignIdKey: 'FURNACE_CORE_CAMPAIGN_ID',
  },
  {
    key: 'REVENUE',
    name: 'Webinar — Revenue',
    importFile: 'campaign-import/furnace_import_revenue.csv',
    envCampaignIdKey: 'FURNACE_REVENUE_CAMPAIGN_ID',
  },
  {
    key: 'COMMUNITY',
    name: 'Webinar — Community',
    importFile: 'campaign-import/furnace_import_community.csv',
    envCampaignIdKey: 'FURNACE_COMMUNITY_CAMPAIGN_ID',
  },
];

const DEFAULT_SCHEDULE = {
  timezone: 'America/New_York',
  start_hour: 8,
  start_minute: 0,
  end_hour: 17,
  end_minute: 0,
  days_of_week: [1, 2, 3, 4, 5],
};

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Fix merge tokens; strip auto-appended signature placeholder. */
function normalizeCopyText(text: string): string {
  return text
    .split('\n')
    .filter((line) => line.trim() !== '{SENDER_EMAIL_SIGNATURE}')
    .join('\n')
    .replace(/\{company_name\}/g, '{{company_name}}')
    .trim();
}

function parseSequencesMarkdown(markdown: string): Map<SequenceKey, SequenceCopy> {
  const sections = new Map<SequenceKey, SequenceCopy>();
  const sequenceBlocks = markdown.split(/^## /m).slice(1);

  for (const block of sequenceBlocks) {
    const [headerLine, ...rest] = block.split('\n');
    const key = headerLine.trim().toUpperCase() as SequenceKey;
    if (!['CORE', 'REVENUE', 'COMMUNITY'].includes(key)) continue;

    const emails: EmailCopy[] = [];
    const emailBlocks = rest.join('\n').split(/^### Email \d+/m).slice(1);

    for (const emailBlock of emailBlocks) {
      const lines = emailBlock.trim().split('\n');
      const subjectLine = lines.find((l) => l.startsWith('Subject:'));
      if (!subjectLine) continue;
      const subject = normalizeCopyText(subjectLine.replace(/^Subject:\s*/, ''));
      const bodyStart = lines.indexOf(subjectLine) + 1;
      const body = normalizeCopyText(lines.slice(bodyStart).join('\n'));
      emails.push({ subject, body });
    }

    if (emails.length !== 3) {
      throw new Error(`Expected 3 emails for ${key}, got ${emails.length}`);
    }

    sections.set(key, {
      key,
      emails: emails as [EmailCopy, EmailCopy, EmailCopy],
    });
  }

  for (const key of ['CORE', 'REVENUE', 'COMMUNITY'] as SequenceKey[]) {
    if (!sections.has(key)) {
      throw new Error(`Missing sequence section in copy markdown: ${key}`);
    }
  }

  return sections;
}

function buildThreeEmailFlow(
  sequence: SequenceCopy,
  waitDurationSeconds: number,
): Record<string, unknown> {
  const variantId = () => randomUUID();
  const [e1, e2, e3] = sequence.emails;

  return {
    nodes: [
      {
        id: 'leadSource-1',
        type: 'leadSource',
        position: { x: 0, y: 0 },
        data: { label: 'Lead Bucket', source: '', isRequired: true },
      },
      {
        id: 'email-1',
        type: 'email',
        position: { x: 220, y: 0 },
        data: {
          label: 'Email 1',
          send_mode: 'new',
          variants: [
            {
              id: variantId(),
              label: 'Primary',
              subject: e1.subject,
              template: e1.body,
              isActive: true,
              order: 0,
            },
          ],
        },
      },
      {
        id: 'waitTime-1',
        type: 'waitTime',
        position: { x: 460, y: 0 },
        data: { label: 'Wait', wait_duration_seconds: waitDurationSeconds },
      },
      {
        id: 'email-2',
        type: 'email',
        position: { x: 700, y: 0 },
        data: {
          label: 'Email 2',
          send_mode: 'reply',
          variants: [
            {
              id: variantId(),
              label: 'Primary',
              subject: e2.subject,
              template: e2.body,
              isActive: true,
              order: 0,
            },
          ],
        },
      },
      {
        id: 'waitTime-2',
        type: 'waitTime',
        position: { x: 940, y: 0 },
        data: { label: 'Wait', wait_duration_seconds: waitDurationSeconds },
      },
      {
        id: 'email-3',
        type: 'email',
        position: { x: 1180, y: 0 },
        data: {
          label: 'Email 3',
          send_mode: 'reply',
          variants: [
            {
              id: variantId(),
              label: 'Primary',
              subject: e3.subject,
              template: e3.body,
              isActive: true,
              order: 0,
            },
          ],
        },
      },
    ],
    edges: [
      { id: 'e1', source: 'leadSource-1', target: 'email-1' },
      { id: 'e2', source: 'email-1', target: 'waitTime-1' },
      { id: 'e3', source: 'waitTime-1', target: 'email-2' },
      { id: 'e4', source: 'email-2', target: 'waitTime-2' },
      { id: 'e5', source: 'waitTime-2', target: 'email-3' },
    ],
  };
}

type ImportLeadRow = {
  email: string;
  first_name?: string;
  last_name?: string;
  company_name?: string;
  custom_lead_data?: Record<string, string>;
};

function loadImportLeads(csvPath: string): ImportLeadRow[] {
  const raw = readFileSync(csvPath, 'utf8');
  const rows = parse(raw, { columns: true, skip_empty_lines: true, trim: true }) as Record<
    string,
    string
  >[];

  return rows.map((row) => {
    const custom: Record<string, string> = {};
    for (const [key, value] of Object.entries(row)) {
      if (!value?.trim()) continue;
      if (['Email', 'First Name', 'Last Name', 'Company'].includes(key)) continue;
      custom[key.toLowerCase().replace(/\s+/g, '_')] = decodeHtmlEntities(value.trim());
    }

    return {
      email: row.Email?.trim().toLowerCase(),
      first_name: decodeHtmlEntities(row['First Name']?.trim() ?? ''),
      last_name: decodeHtmlEntities(row['Last Name']?.trim() ?? ''),
      company_name: decodeHtmlEntities(row.Company?.trim() ?? ''),
      custom_lead_data: Object.keys(custom).length > 0 ? custom : undefined,
    };
  });
}

async function resolveMailboxIds(
  supabase: SupabaseClient,
  accountId: string,
): Promise<string[]> {
  const fromEnv = process.env.FURNACE_MAILBOX_IDS?.split(',').map((s) => s.trim()).filter(Boolean);
  if (fromEnv?.length) return fromEnv;

  const { data, error } = await supabase
    .from('mailboxes')
    .select('id, email_address, status')
    .eq('account_id', accountId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true });

  if (error) throw new Error(`Failed to list mailboxes: ${error.message}`);

  const active = (data ?? []).filter((m) => m.status !== 'disabled');
  if (active.length === 0) {
    throw new Error('No active mailboxes found for account — assign mailboxes before launching.');
  }

  return active.map((m) => m.id as string);
}

async function linkMailboxes(
  supabase: SupabaseClient,
  accountId: string,
  campaignId: string,
  mailboxIds: string[],
  dryRun: boolean,
): Promise<void> {
  if (dryRun) {
    console.log(`  [dry-run] would link ${mailboxIds.length} mailbox(es) to ${campaignId}`);
    return;
  }

  for (const mailboxId of mailboxIds) {
    const { error } = await supabase.from('campaign_mailboxes').upsert(
      {
        campaign_id: campaignId,
        mailbox_id: mailboxId,
        account_id: accountId,
      },
      { onConflict: 'campaign_id,mailbox_id' },
    );
    if (error) {
      throw new Error(`Failed to link mailbox ${mailboxId}: ${error.message}`);
    }
  }
}

async function createCampaign(
  supabase: SupabaseClient,
  params: {
    accountId: string;
    ownerUserId: string;
    name: string;
    flowData: Record<string, unknown>;
    status: string;
    dryRun: boolean;
  },
): Promise<string> {
  const { accountId, ownerUserId, name, flowData, status, dryRun } = params;
  const campaignId = randomUUID();
  const now = new Date().toISOString();

  if (dryRun) {
    console.log(`  [dry-run] would create campaign "${name}" (${campaignId}) status=${status}`);
    return campaignId;
  }

  const { data, error } = await supabase
    .from('campaigns')
    .insert({
      id: campaignId,
      name,
      owner_id: ownerUserId,
      account_id: accountId,
      organization_id: null,
      status,
      flow_data: flowData,
      schedule: DEFAULT_SCHEDULE,
      sending_interval_seconds: 300,
      created_at: now,
      updated_at: now,
    })
    .select('id, bucket_id')
    .single();

  if (error || !data?.id) {
    throw new Error(`Failed to create campaign "${name}": ${error?.message ?? 'no data'}`);
  }

  if (!data.bucket_id) {
    throw new Error(`Campaign "${name}" created without bucket_id`);
  }

  return data.id as string;
}

async function importLeads(
  supabase: SupabaseClient,
  accountId: string,
  campaignId: string,
  leads: ImportLeadRow[],
  dryRun: boolean,
): Promise<{ created: number; updated: number; enrolled: number; skipped: number; failed: number }> {
  const chunkSize = 500;
  let totals = { created: 0, updated: 0, enrolled: 0, skipped: 0, failed: 0 };

  for (let i = 0; i < leads.length; i += chunkSize) {
    const chunk = leads.slice(i, i + chunkSize);
    if (dryRun) {
      console.log(`  [dry-run] would import ${chunk.length} leads (rows ${i + 1}-${i + chunk.length})`);
      totals.enrolled += chunk.length;
      continue;
    }

    const { data, error } = await supabase.rpc('import_api_leads_to_campaign', {
      p_account_id: accountId,
      p_campaign_id: campaignId,
      p_leads: chunk,
      p_options: { emit_row_webhooks: false },
    });

    if (error) {
      throw new Error(`Lead import failed at offset ${i}: ${error.message}`);
    }

    const result = (data ?? {}) as Record<string, number>;
    totals.created += result.created ?? 0;
    totals.updated += result.updated ?? 0;
    totals.enrolled += result.enrolled ?? 0;
    totals.skipped += result.skipped ?? 0;
    totals.failed += result.failed ?? 0;

    console.log(
      `  imported chunk ${i + 1}-${i + chunk.length}: created=${result.created ?? 0} updated=${result.updated ?? 0} enrolled=${result.enrolled ?? 0} skipped=${result.skipped ?? 0} failed=${result.failed ?? 0}`,
    );
  }

  return totals;
}

type ImportTotals = { created: number; updated: number; enrolled: number; skipped: number; failed: number };

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const importOnly = args.includes('--import-only') || Boolean(process.env.FURNACE_IMPORT_ONLY?.trim());

  const runDir = resolve(PACKAGE_ROOT, process.env.FURNACE_RUN_DIR?.trim() || 'output/runs/stage1-live');
  const copyPath = join(runDir, 'webinar_sequences_copy_spintax.md');
  const sequences = parseSequencesMarkdown(readFileSync(copyPath, 'utf8'));

  const waitDays = Number(process.env.FURNACE_WAIT_DAYS ?? '3');
  const waitDurationSeconds = waitDays * 24 * 60 * 60;
  const status = process.env.FURNACE_CAMPAIGN_STATUS?.trim() || 'draft';

  console.log(`Run dir: ${runDir}`);
  console.log(`Mode: ${dryRun ? 'DRY RUN' : importOnly ? 'IMPORT ONLY' : 'CREATE + IMPORT'}`);
  console.log(`Wait between emails: ${waitDays} days`);
  console.log(`Campaign status: ${status}`);

  let supabase: SupabaseClient | null = null;
  let accountId = '';
  let ownerUserId = '';
  let mailboxIds: string[] = [];

  if (!dryRun || importOnly) {
    accountId = requireEnv('FURNACE_ACCOUNT_ID');
    if (!importOnly) {
      ownerUserId = requireEnv('FURNACE_OWNER_USER_ID');
    }
    const supabaseUrl = requireEnv('FURNACE_SUPABASE_URL');
    const serviceRoleKey = requireEnv('FURNACE_SUPABASE_SERVICE_ROLE_KEY');
    supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    if (!importOnly) {
      mailboxIds = await resolveMailboxIds(supabase, accountId);
      console.log(`Mailboxes: ${mailboxIds.length}`);
    }
  }

  const results: Array<{ name: string; campaignId: string; leads: number; import: ImportTotals }> = [];
  const emptyImport: ImportTotals = { created: 0, updated: 0, enrolled: 0, skipped: 0, failed: 0 };

  for (const spec of CAMPAIGNS) {
    const sequence = sequences.get(spec.key)!;
    const importPath = join(runDir, spec.importFile);
    const leads = loadImportLeads(importPath);

    console.log(`\n=== ${spec.name} (${spec.key}) — ${leads.length} leads ===`);

    let campaignId: string;

    if (importOnly) {
      campaignId = requireEnv(spec.envCampaignIdKey);
      console.log(`Using existing campaign ${campaignId}`);
    } else {
      const flowData = buildThreeEmailFlow(sequence, waitDurationSeconds);
      if (!supabase) {
        campaignId = randomUUID();
        console.log(`  [dry-run] flow: 3 emails, 2×${waitDays}d waits`);
      } else {
        campaignId = await createCampaign(supabase, {
          accountId,
          ownerUserId,
          name: spec.name,
          flowData,
          status,
          dryRun: false,
        });
        console.log(`Created campaign ${campaignId}`);
        await linkMailboxes(supabase, accountId, campaignId, mailboxIds, false);
      }
    }

    if (dryRun && !importOnly) {
      console.log(`  [dry-run] would import ${leads.length} leads from ${spec.importFile}`);
      results.push({ name: spec.name, campaignId, leads: leads.length, import: emptyImport });
      continue;
    }

    if (!supabase) continue;

    const importResult = await importLeads(supabase, accountId, campaignId, leads, dryRun);
    results.push({ name: spec.name, campaignId, leads: leads.length, import: importResult });
  }

  console.log('\n=== Summary ===');
  for (const row of results) {
    console.log(
      `${row.name}: campaign=${row.campaignId} leads=${row.leads} enrolled=${row.import.enrolled} skipped=${row.import.skipped} failed=${row.import.failed}`,
    );
  }

  if (status === 'draft') {
    console.log('\nCampaigns left in draft — review sequences in the builder, then set status to running.');
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
