/**
 * Preview or repair `email_threads.subject` and `email_messages.subject` rows
 * that hold an unrendered template or the UI's "(No subject)" placeholder.
 *
 * Both are contract violations: a stored subject must be the string that went on
 * the wire. Threads created before subject resolution existed froze raw spintax
 * into their titles, which then seeded composer replies and inbox cards.
 *
 * Dry run by default. Reports counts and samples before anything is written.
 *
 * Usage:
 *   npx tsx scripts/repair-unrendered-email-subjects.ts
 *   APPLY=true npx tsx scripts/repair-unrendered-email-subjects.ts
 *   LIMIT=5000 APPLY=true npx tsx scripts/repair-unrendered-email-subjects.ts
 *   SELF_RECOVERY_TARGET_ENV=prod npx tsx scripts/repair-unrendered-email-subjects.ts
 */

import { STANDARD_MERGE_FIELD_KEYS } from '../lib/email/leadVariables.js';
import {
  containsUnresolvedTemplate,
  isNoSubjectPlaceholder,
  resolveDeliveredSubject,
} from '../lib/email/threading/subject.js';
import {
  fetchSecretFromParameterStore,
  loadSelfRecoveryEnv,
  resolveSecretParamPathForTarget,
  resolveSelfRecoveryTargetEnv,
  resolveSupabaseUrlForTarget,
} from './self-recovery-env.js';

loadSelfRecoveryEnv();

/** Columns a subject template can merge from. */
const LEAD_MERGE_FIELD_COLUMNS = `id, ${STANDARD_MERGE_FIELD_KEYS.join(', ')}, custom_lead_data`;

type ThreadRow = {
  id: string;
  subject: string | null;
  campaign_id: string | null;
  lead_id: string | null;
  message_job_id: string | null;
};

type MessageRow = {
  id: string;
  subject: string | null;
  message_job_id: string | null;
  direction: string | null;
};

type JobRow = {
  id: string;
  message_data: Record<string, any> | null;
};

type LeadRow = Record<string, unknown> & { id: string };

type Fix = {
  id: string;
  from: string;
  to: string;
};

function needsRepair(subject: string | null | undefined): boolean {
  return containsUnresolvedTemplate(subject) || isNoSubjectPlaceholder(subject);
}

function describe(fixes: Fix[], label: string, sampleSize = 10): void {
  console.log(`\n${label}: ${fixes.length} row(s) need repair`);
  for (const fix of fixes.slice(0, sampleSize)) {
    console.log(`  ${fix.id}`);
    console.log(`    from: ${JSON.stringify(fix.from)}`);
    console.log(`      to: ${JSON.stringify(fix.to)}`);
  }
  if (fixes.length > sampleSize) {
    console.log(`  ... and ${fixes.length - sampleSize} more`);
  }
}

/**
 * Page through a table with an explicit range window.
 *
 * PostgREST caps a single response at its configured max rows (1000 by default)
 * and does so silently, so a bare `.limit(n)` above that quietly truncates the
 * scan and under-reports what needs repair.
 */
async function fetchAllRows<T>(
  supabase: any,
  table: string,
  columns: string,
  orderColumn: string,
  max: number,
  pageSize = 1000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < max; from += pageSize) {
    const to = Math.min(from + pageSize, max) - 1;
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .not('subject', 'is', null)
      .order(orderColumn, { ascending: false })
      .range(from, to);
    if (error) {
      throw new Error(`Failed to load ${table}: ${error.message}`);
    }
    const page = (data ?? []) as T[];
    out.push(...page);
    if (page.length < to - from + 1) break;
  }
  return out;
}

/** Fetch rows by id in chunks, since `in` filters have a practical size limit. */
async function fetchByIds<T>(
  supabase: any,
  table: string,
  columns: string,
  ids: string[],
  chunkSize = 200,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const { data, error } = await supabase.from(table).select(columns).in('id', chunk);
    if (error) {
      throw new Error(`Failed to load ${table}: ${error.message}`);
    }
    out.push(...((data ?? []) as T[]));
  }
  return out;
}

async function main() {
  const targetEnv = resolveSelfRecoveryTargetEnv();
  const { url, source: urlSource } = resolveSupabaseUrlForTarget(targetEnv);
  const apply = process.env.APPLY === 'true';
  const limit = Number(process.env.LIMIT || '100000');
  const awsRegion =
    process.env.AWS_REGION?.trim() || process.env.CDK_DEFAULT_REGION?.trim() || 'us-west-2';

  let key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    null;

  const secretParamPath = resolveSecretParamPathForTarget(targetEnv);
  if (secretParamPath) {
    try {
      key = await fetchSecretFromParameterStore(secretParamPath, awsRegion);
      process.env.SUPABASE_SECRET_KEY = key;
    } catch (error) {
      if (!key) throw error;
      console.warn(
        `[repair-unrendered-email-subjects] Failed to fetch ${secretParamPath}; falling back to existing secret env.`,
      );
    }
  }

  if (!url || !key) {
    console.error(
      'Missing Supabase credentials. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or configure Parameter Store).',
    );
    process.exit(1);
  }

  console.log(`Target env: ${targetEnv}`);
  console.log(`Resolved SUPABASE_URL from ${urlSource}.`);
  console.log(apply ? 'Mode: APPLY (writes enabled)' : 'Mode: DRY RUN (no writes)');

  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(url, key);

  const threads = await fetchAllRows<ThreadRow>(
    supabase,
    'email_threads',
    'id, subject, campaign_id, lead_id, message_job_id',
    'created_at',
    limit,
  );
  const messages = await fetchAllRows<MessageRow>(
    supabase,
    'email_messages',
    'id, subject, message_job_id, direction',
    'received_at',
    limit,
  );

  const badThreads = threads.filter((row) => needsRepair(row.subject));
  const badMessages = messages.filter((row) => needsRepair(row.subject));

  console.log(
    `\nScanned ${threads.length} thread(s) and ${messages.length} message(s) ` +
      `(LIMIT=${limit} per table).`,
  );

  if (badThreads.length === 0 && badMessages.length === 0) {
    console.log('No unrendered or placeholder subjects found. Nothing to repair.');
    return;
  }

  // The job that produced each row carries the recorded delivered subject and the
  // template to fall back on.
  const jobIds = [
    ...new Set(
      [
        ...badThreads.map((row) => row.message_job_id),
        ...badMessages.map((row) => row.message_job_id),
      ].filter((id): id is string => Boolean(id)),
    ),
  ];
  const jobs = await fetchByIds<JobRow>(supabase, 'message_jobs', 'id, message_data', jobIds);
  const jobById = new Map(jobs.map((job) => [job.id, job]));

  const leadIds = [
    ...new Set(badThreads.map((row) => row.lead_id).filter((id): id is string => Boolean(id))),
  ];
  const leads = await fetchByIds<LeadRow>(supabase, 'leads', LEAD_MERGE_FIELD_COLUMNS, leadIds);
  const leadById = new Map(leads.map((lead) => [lead.id, lead]));

  const resolveFor = (
    stored: string | null,
    jobId: string | null,
    lead: LeadRow | null,
  ): string => {
    const messageData = (jobId ? jobById.get(jobId)?.message_data : null) ?? {};
    return resolveDeliveredSubject({
      messageDataSentSubject: messageData.sent_subject ?? null,
      messageDataSubject: messageData.subject ?? null,
      nodeConfigSubject: messageData.node_config?.subject ?? stored ?? null,
      lead,
    });
  };

  const threadFixes: Fix[] = [];
  const unresolvableThreads: ThreadRow[] = [];
  for (const row of badThreads) {
    const lead = row.lead_id ? (leadById.get(row.lead_id) ?? null) : null;
    const next = resolveFor(row.subject, row.message_job_id, lead);
    if (next === (row.subject ?? '')) {
      unresolvableThreads.push(row);
      continue;
    }
    threadFixes.push({ id: row.id, from: row.subject ?? '', to: next });
  }

  const messageFixes: Fix[] = [];
  const unresolvableMessages: MessageRow[] = [];
  for (const row of badMessages) {
    const next = resolveFor(row.subject, row.message_job_id, null);
    if (next === (row.subject ?? '')) {
      unresolvableMessages.push(row);
      continue;
    }
    messageFixes.push({ id: row.id, from: row.subject ?? '', to: next });
  }

  describe(threadFixes, 'email_threads.subject');
  describe(messageFixes, 'email_messages.subject');

  if (unresolvableThreads.length > 0 || unresolvableMessages.length > 0) {
    console.log(
      `\nSkipping ${unresolvableThreads.length} thread(s) and ${unresolvableMessages.length} ` +
        'message(s) with no better subject available.',
    );
  }

  if (!apply) {
    console.log('\nDry run complete. Re-run with APPLY=true to write these changes.');
    return;
  }

  let threadsUpdated = 0;
  for (const fix of threadFixes) {
    const { error } = await supabase
      .from('email_threads')
      .update({ subject: fix.to })
      .eq('id', fix.id);
    if (error) {
      console.error(`Failed to update thread ${fix.id}: ${error.message}`);
      continue;
    }
    threadsUpdated += 1;
  }

  let messagesUpdated = 0;
  for (const fix of messageFixes) {
    const { error } = await supabase
      .from('email_messages')
      .update({ subject: fix.to })
      .eq('id', fix.id);
    if (error) {
      console.error(`Failed to update message ${fix.id}: ${error.message}`);
      continue;
    }
    messagesUpdated += 1;
  }

  console.log(
    `\nApplied: ${threadsUpdated}/${threadFixes.length} thread(s), ` +
      `${messagesUpdated}/${messageFixes.length} message(s).`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
