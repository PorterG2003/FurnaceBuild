/**
 * One-shot: cancel pending automated Link / campaign_priority jobs for
 * Wave1 Group B recipients who already received a manual apology+link reply,
 * so the scheduler cannot double-send.
 *
 * Usage (prod):
 *   SELF_RECOVERY_TARGET_ENV=prod npx tsx scripts/ops/nexttherapist-july-wave1/cancel-pending-link-for-wave1-b.ts
 *   SELF_RECOVERY_TARGET_ENV=prod APPLY=true npx tsx scripts/ops/nexttherapist-july-wave1/cancel-pending-link-for-wave1-b.ts
 */

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import {
  fetchSecretFromParameterStore,
  loadSelfRecoveryEnv,
  resolveSecretParamPathForTarget,
  resolveSelfRecoveryTargetEnv,
  resolveSupabaseUrlForTarget,
} from '../../self-recovery-env.js';

loadSelfRecoveryEnv();

const CAMPAIGN_ID = '7548f6de-f2a1-4e30-b005-f3dc71186829';
const LINK_FLOW_NODE_ID = '1783355366467-mnslwswrn';
const CANCEL_REASON = 'wave1_b_manual_link_sent';
const APPLY = process.env.APPLY === 'true';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SENDLOG = path.join(__dirname, 'sendlog_B_final.csv');

type SendlogRow = {
  lead_email: string;
  thread_id: string;
  lead_id: string;
  first_name: string;
  status: string;
  job_id: string;
};

async function readSendlog(filePath: string): Promise<SendlogRow[]> {
  const rows: SendlogRow[] = [];
  const rl = createInterface({ input: createReadStream(filePath), crlfDelay: Infinity });
  let header: string[] | null = null;
  for await (const line of rl) {
    if (!line.trim()) continue;
    const cols = parseCsvLine(line);
    if (!header) {
      header = cols;
      continue;
    }
    const obj: Record<string, string> = {};
    header.forEach((h, i) => {
      obj[h] = cols[i] ?? '';
    });
    if (obj.status && obj.status !== 'queued') continue;
    rows.push({
      lead_email: obj.lead_email,
      thread_id: obj.thread_id,
      lead_id: obj.lead_id,
      first_name: obj.first_name,
      status: obj.status,
      job_id: obj.job_id,
    });
  }
  return rows;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function main() {
  const target = resolveSelfRecoveryTargetEnv();
  const { url } = resolveSupabaseUrlForTarget(target);
  const param = resolveSecretParamPathForTarget(target);
  if (!url || !param) throw new Error('missing supabase url/secret path for target');
  const key = await fetchSecretFromParameterStore(param, process.env.AWS_REGION || 'us-west-2');
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const sendlog = await readSendlog(SENDLOG);
  const threadIds = [...new Set(sendlog.map((r) => r.thread_id).filter(Boolean))];
  console.log(JSON.stringify({ target, apply: APPLY, sendlogQueued: sendlog.length, threadIds: threadIds.length }));

  const { data: linkNode, error: nodeErr } = await sb
    .from('nodes')
    .select('id')
    .eq('campaign_id', CAMPAIGN_ID)
    .eq('flow_node_id', LINK_FLOW_NODE_ID)
    .is('deleted_at', null)
    .maybeSingle();
  if (nodeErr) throw nodeErr;
  if (!linkNode?.id) throw new Error(`Link node not found for flow_node_id=${LINK_FLOW_NODE_ID}`);
  const linkNodeId = linkNode.id as string;

  const pendingStatuses = ['queued', 'pending', 'deferred', 'held', 'scheduled'];
  const found: Array<{
    id: string;
    enrollment_id: string;
    status: string;
    message_type: string | null;
    scheduled_at: string | null;
    thread_id: string | null;
  }> = [];

  for (const ids of chunk(threadIds, 50)) {
    const { data: threads, error: tErr } = await sb
      .from('email_threads')
      .select('id, enrollment_id')
      .in('id', ids);
    if (tErr) throw tErr;
    const enrollmentIds = [...new Set((threads ?? []).map((t) => t.enrollment_id).filter(Boolean))];
    if (enrollmentIds.length === 0) continue;

    const { data: jobs, error: jErr } = await sb
      .from('message_jobs')
      .select('id, enrollment_id, status, message_type, scheduled_at, node_id')
      .eq('campaign_id', CAMPAIGN_ID)
      .in('enrollment_id', enrollmentIds)
      .in('status', pendingStatuses)
      .or(`node_id.eq.${linkNodeId},message_type.eq.campaign_priority`);
    if (jErr) throw jErr;

    const threadByEnrollment = new Map(
      (threads ?? []).map((t) => [t.enrollment_id as string, t.id as string]),
    );
    for (const job of jobs ?? []) {
      found.push({
        id: job.id,
        enrollment_id: job.enrollment_id,
        status: job.status,
        message_type: job.message_type,
        scheduled_at: job.scheduled_at,
        thread_id: threadByEnrollment.get(job.enrollment_id) ?? null,
      });
    }
  }

  console.log(JSON.stringify({ pendingLinkOrPriorityJobs: found.length, sample: found.slice(0, 10) }, null, 2));

  if (!APPLY) {
    console.log('Dry-run only. Re-run with APPLY=true to cancel.');
    return;
  }

  if (found.length === 0) {
    console.log('Nothing to cancel.');
    return;
  }

  let cancelled = 0;
  for (const batch of chunk(found, 25)) {
    const { error } = await sb
      .from('message_jobs')
      .update({
        status: 'cancelled',
        status_reason: CANCEL_REASON,
        updated_at: new Date().toISOString(),
      } as any)
      .in(
        'id',
        batch.map((j) => j.id),
      )
      .in('status', pendingStatuses);
    if (error) throw error;
    cancelled += batch.length;
  }
  console.log(JSON.stringify({ cancelled }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
