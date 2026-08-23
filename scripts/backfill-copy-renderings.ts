#!/usr/bin/env npx tsx
/**
 * Stamp message_jobs.copy_rendering_id from parsed copy contents.
 *
 * Default is dry-run inventory. Live requires --account-id.
 *
 *   npx tsx scripts/backfill-copy-renderings.ts --account-id=<uuid>
 *   npx tsx scripts/backfill-copy-renderings.ts --account-id=<uuid> --live --limit=500
 *   npx tsx scripts/backfill-copy-renderings.ts --account-id=<uuid> --verify
 */
import { config } from 'dotenv';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { classifyCopyRenderingBackfillJob } from '../lib/copy/backfillCopyRenderings';
import { selectSubjectBranchKey } from '../lib/copy/expandSubjectSpintax';
import { upsertCopyRenderingForJob } from '../lib/copy/upsertCopyRendering';
import { buildSpintaxSeed } from '../lib/email/processSpintax';

config({ path: '.env.local' });
config();

type Args = {
  live: boolean;
  verify: boolean;
  accountId: string | null;
  limit: number | null;
  batchSize: number;
};

type Inventory = {
  eligible: number;
  already_stamped: number;
  unmapped: number;
  unparsed: number;
  inbox: number;
  contents: number;
};

function parseArgs(argv: string[]): Args {
  let accountId: string | null = null;
  let limit: number | null = null;
  let batchSize = 500;
  for (const arg of argv) {
    if (arg.startsWith('--account-id=')) accountId = arg.slice('--account-id='.length).trim() || null;
    if (arg.startsWith('--limit=')) limit = Number(arg.slice('--limit='.length));
    if (arg.startsWith('--batch-size=')) batchSize = Number(arg.slice('--batch-size='.length));
  }
  return {
    live: argv.includes('--live'),
    verify: argv.includes('--verify'),
    accountId,
    limit: Number.isInteger(limit) && Number(limit) > 0 ? Number(limit) : null,
    batchSize: Number.isInteger(batchSize) && batchSize > 0 ? batchSize : 500,
  };
}

function isOutbound(messageType: string | null | undefined): boolean {
  return messageType !== 'inbox_reply' && messageType !== 'inbox_forward';
}

async function loadCampaignIds(db: SupabaseClient, accountId: string): Promise<string[]> {
  const { data, error } = await db
    .from('campaigns')
    .select('id')
    .eq('account_id', accountId)
    .is('deleted_at', null)
    .neq('source', 'smartlead');
  if (error) throw error;
  return (data ?? []).map((row) => String((row as { id: string }).id));
}

type JobRow = {
  id: string;
  campaign_id: string;
  lead_id: string;
  variant_id: string | null;
  flow_version_number: number | null;
  node_id: string | null;
  message_type: string | null;
  copy_rendering_id: string | null;
  account_id: string;
};

async function fetchJobPage(
  db: SupabaseClient,
  campaignIds: string[],
  from: number,
  to: number,
  options: { unstampedOnly?: boolean; afterId?: string | null; accountId?: string } = {},
): Promise<JobRow[]> {
  if (campaignIds.length === 0) return [];
  let query = db
    .from('message_jobs')
    .select(
      'id, campaign_id, lead_id, variant_id, flow_version_number, node_id, message_type, copy_rendering_id, account_id',
    )
    .in('campaign_id', campaignIds)
    .eq('status', 'sent')
    .order('id', { ascending: true });
  if (options.accountId) {
    query = query.eq('account_id', options.accountId);
  }
  if (options.unstampedOnly) {
    query = query.is('copy_rendering_id', null);
  }
  if (options.afterId) {
    query = query.gt('id', options.afterId);
  }
  const { data, error } = await query.range(from, to);
  if (error) throw error;
  return (data ?? []) as unknown as JobRow[];
}

async function classifyJobs(
  db: SupabaseClient,
  jobs: JobRow[],
): Promise<Array<{ job: JobRow; class: ReturnType<typeof classifyCopyRenderingBackfillJob>; contentId: string | null; subject: string }>> {
  const nodeIds = [...new Set(jobs.map((job) => job.node_id).filter(Boolean))] as string[];
  const nodeMap = new Map<string, string>();
  if (nodeIds.length > 0) {
    const { data, error } = await db.from('nodes').select('id, flow_node_id').in('id', nodeIds);
    if (error) throw error;
    for (const row of data ?? []) {
      nodeMap.set(String((row as { id: string }).id), String((row as { flow_node_id?: string }).flow_node_id ?? ''));
    }
  }

  const mapKeys = jobs.map((job) => ({
    job,
    flowNodeId: job.node_id ? nodeMap.get(job.node_id) ?? '' : '',
  }));

  const contentByJob = new Map<string, { contentId: string; subject: string; parseStatus: string; occurrenceCount: number }>();
  const needed = mapKeys.filter((row) => row.job.variant_id && row.job.flow_version_number && row.flowNodeId);
  const contentIds = new Set<string>();
  if (needed.length > 0) {
    const mapSelect =
      'campaign_id, flow_node_id, variant_id, flow_version_number, content_id, copy_contents!inner(id, subject, parse_status)';
    const mapSelectLegacy =
      'campaign_id, variant_id, flow_version_number, content_id, copy_contents!inner(id, subject, parse_status)';
    let maps: unknown[] | null = null;
    {
      const first = await db
        .from('copy_variant_content_map')
        .select(mapSelect)
        .in('campaign_id', [...new Set(needed.map((row) => row.job.campaign_id))]);
      if (first.error && (first.error.code === '42703' || first.error.message.includes('flow_node_id'))) {
        const fallback = await db
          .from('copy_variant_content_map')
          .select(mapSelectLegacy)
          .in('campaign_id', [...new Set(needed.map((row) => row.job.campaign_id))]);
        if (fallback.error) throw fallback.error;
        maps = fallback.data ?? [];
      } else if (first.error) {
        throw first.error;
      } else {
        maps = first.data ?? [];
      }
    }
    const mapLookup = new Map<string, { contentId: string; subject: string; parseStatus: string }>();
    const tripleLookup = new Map<string, { contentId: string; subject: string; parseStatus: string }>();
    for (const row of maps ?? []) {
      const contents = (row as { copy_contents?: { subject?: string; parse_status?: string; id?: string } | Array<{ subject?: string; parse_status?: string; id?: string }> }).copy_contents;
      const content = Array.isArray(contents) ? contents[0] : contents;
      const contentId = String((row as { content_id?: string }).content_id ?? content?.id ?? '');
      const mapped = {
        contentId,
        subject: String(content?.subject ?? ''),
        parseStatus: String(content?.parse_status ?? ''),
      };
      const flowNodeId = String((row as { flow_node_id?: string | null }).flow_node_id ?? '');
      if (flowNodeId) {
        mapLookup.set(
          [
            String((row as { campaign_id: string }).campaign_id),
            flowNodeId,
            String((row as { variant_id: string }).variant_id),
            String((row as { flow_version_number: number }).flow_version_number),
          ].join('|'),
          mapped,
        );
      }
      const tripleKey = [
        String((row as { campaign_id: string }).campaign_id),
        String((row as { variant_id: string }).variant_id),
        String((row as { flow_version_number: number }).flow_version_number),
      ].join('|');
      if (!tripleLookup.has(tripleKey)) tripleLookup.set(tripleKey, mapped);
      if (contentId) contentIds.add(contentId);
    }
    const occurrenceCount = new Map<string, number>();
    if (contentIds.size > 0) {
      const { data: occ, error: occError } = await db
        .from('copy_piece_occurrences')
        .select('content_id')
        .in('content_id', [...contentIds]);
      if (occError) throw occError;
      for (const row of occ ?? []) {
        const id = String((row as { content_id: string }).content_id);
        occurrenceCount.set(id, (occurrenceCount.get(id) ?? 0) + 1);
      }
    }
    for (const row of needed) {
      const key = [
        row.job.campaign_id,
        row.flowNodeId,
        String(row.job.variant_id),
        String(row.job.flow_version_number),
      ].join('|');
      const mapped =
        mapLookup.get(key) ??
        tripleLookup.get(
          [
            row.job.campaign_id,
            String(row.job.variant_id),
            String(row.job.flow_version_number),
          ].join('|'),
        );
      if (!mapped) continue;
      contentByJob.set(row.job.id, {
        ...mapped,
        occurrenceCount: occurrenceCount.get(mapped.contentId) ?? 0,
      });
    }
  }

  return jobs.map((job) => {
    const mapped = contentByJob.get(job.id);
    const classified = classifyCopyRenderingBackfillJob({
      messageType: job.message_type,
      mappedContentId: mapped?.contentId ?? null,
      parseStatus: mapped?.parseStatus ?? null,
      occurrenceCount: mapped?.occurrenceCount ?? 0,
      copyRenderingId: job.copy_rendering_id,
    });
    return {
      job,
      class: classified,
      contentId: mapped?.contentId ?? null,
      subject: mapped?.subject ?? '',
    };
  });
}

async function inventoryAccount(db: SupabaseClient, accountId: string): Promise<Inventory> {
  const campaignIds = await loadCampaignIds(db, accountId);
  const counts: Inventory = {
    eligible: 0,
    already_stamped: 0,
    unmapped: 0,
    unparsed: 0,
    inbox: 0,
    contents: 0,
  };
  const contents = new Set<string>();
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const page = await fetchJobPage(db, campaignIds, from, from + pageSize - 1, {
      accountId,
    });
    if (page.length === 0) break;
    const classified = await classifyJobs(db, page);
    for (const row of classified) {
      counts[row.class] += 1;
      if (row.contentId) contents.add(row.contentId);
    }
    if (page.length < pageSize) break;
    from += pageSize;
  }
  counts.contents = contents.size;
  return counts;
}

async function stampAccount(
  db: SupabaseClient,
  accountId: string,
  limit: number | null,
  batchSize: number,
): Promise<{ stamped: number; upserted_renderings: number; errors: number }> {
  const campaignIds = await loadCampaignIds(db, accountId);
  let stamped = 0;
  let upserted = 0;
  let errors = 0;
  const renderingCache = new Map<string, string>();
  const failedJobIds = new Set<string>();
  let afterId: string | null = null;
  while (true) {
    if (limit != null && stamped >= limit) break;
    const page = await fetchJobPage(db, campaignIds, 0, batchSize - 1, {
      afterId,
      accountId,
    });
    if (page.length === 0) break;
    afterId = page[page.length - 1]!.id;
    const pending = page.filter((job) => !failedJobIds.has(job.id));
    if (pending.length === 0) continue;
    const classified = await classifyJobs(db, pending);
    const eligible = classified.filter((row) => row.class === 'eligible' && row.contentId);
    const unique = new Map<string, { contentId: string; subject: string; seed: string }>();
    for (const row of eligible) {
      const seed = buildSpintaxSeed({
        campaignId: row.job.campaign_id,
        leadId: row.job.lead_id,
        variantId: row.job.variant_id,
      });
      const renderKey = selectSubjectBranchKey(row.subject, seed);
      const cacheKey = `${row.contentId}|${renderKey}`;
      unique.set(cacheKey, {
        contentId: row.contentId!,
        subject: row.subject,
        seed,
      });
    }
    for (const [cacheKey, spec] of unique) {
      if (renderingCache.has(cacheKey)) continue;
      try {
        const renderingId = await upsertCopyRenderingForJob({
          db,
          accountId,
          contentId: spec.contentId,
          rawSubject: spec.subject,
          seed: spec.seed,
        });
        if (renderingId) {
          renderingCache.set(cacheKey, renderingId);
          upserted += 1;
        }
      } catch (error) {
        console.error('upsert failed', cacheKey, error);
        errors += 1;
      }
    }
    const idsByRendering = new Map<string, string[]>();
    for (const row of eligible) {
      if (limit != null && stamped >= limit) break;
      const seed = buildSpintaxSeed({
        campaignId: row.job.campaign_id,
        leadId: row.job.lead_id,
        variantId: row.job.variant_id,
      });
      const renderKey = selectSubjectBranchKey(row.subject, seed);
      const renderingId = renderingCache.get(`${row.contentId}|${renderKey}`);
      if (!renderingId) {
        failedJobIds.add(row.job.id);
        errors += 1;
        continue;
      }
      const ids = idsByRendering.get(renderingId) ?? [];
      ids.push(row.job.id);
      idsByRendering.set(renderingId, ids);
    }
    for (const [renderingId, ids] of idsByRendering) {
      const { error } = await db
        .from('message_jobs')
        .update({ copy_rendering_id: renderingId } as never)
        .in('id', ids)
        .is('copy_rendering_id', null);
      if (error) {
        errors += ids.length;
        for (const id of ids) failedJobIds.add(id);
        continue;
      }
      stamped += ids.length;
    }
    console.log(JSON.stringify({ stamped, upserted_renderings: upserted, errors, page: page.length, afterId }));
  }
  return { stamped, upserted_renderings: upserted, errors };
}

async function verifyAccount(db: SupabaseClient, accountId: string): Promise<void> {
  const counts = await inventoryAccount(db, accountId);
  const failures: string[] = [];
  if (counts.eligible > 0) {
    failures.push(`eligible_remaining=${counts.eligible}`);
  }

  const { data: renderings, error: renderingError } = await db
    .from('copy_renderings')
    .select('id, content_id, render_key')
    .eq('account_id', accountId);
  if (renderingError) throw renderingError;

  const renderingIds = (renderings ?? []).map((row) => String((row as { id: string }).id));
  const renderingPieces: Array<Record<string, unknown>> = [];
  for (let i = 0; i < renderingIds.length; i += 200) {
    const chunk = renderingIds.slice(i, i + 200);
    const { data, error: pieceError } = await db
      .from('copy_rendering_pieces')
      .select('rendering_id, piece_id, copy_pieces!inner(kind)')
      .in('rendering_id', chunk);
    if (pieceError) throw pieceError;
    renderingPieces.push(...((data ?? []) as Array<Record<string, unknown>>));
  }

  const piecesByRendering = new Map<string, Array<{ pieceId: string; kind: string }>>();
  for (const row of renderingPieces ?? []) {
    const renderingId = String((row as { rendering_id: string }).rendering_id);
    const pieceId = String((row as { piece_id: string }).piece_id);
    const piece = (row as { copy_pieces?: { kind?: string } | { kind?: string }[] }).copy_pieces;
    const kind = String((Array.isArray(piece) ? piece[0]?.kind : piece?.kind) ?? '');
    const list = piecesByRendering.get(renderingId) ?? [];
    list.push({ pieceId, kind });
    piecesByRendering.set(renderingId, list);
  }
  for (const rendering of renderings ?? []) {
    const id = String((rendering as { id: string }).id);
    const pieces = piecesByRendering.get(id) ?? [];
    const n = pieces.filter((piece) => piece.kind === 'subject').length;
    if (n > 1) {
      failures.push(`rendering ${id} has ${n} subject pieces`);
    }
    if (n === 0 && pieces.length === 0) {
      failures.push(`rendering ${id} has no pieces`);
    }
  }

  type ContentJobPieces = {
    jobIds: Set<string>;
    subjectJobs: Map<string, Set<string>>;
    bodyJobs: Map<string, Set<string>>;
  };
  const contentStats = new Map<string, ContentJobPieces>();
  const contentByRendering = new Map(
    (renderings ?? []).map((row) => [
      String((row as { id: string }).id),
      String((row as { content_id: string }).content_id),
    ]),
  );
  let stampedFrom = 0;
  const stampedPageSize = 1000;
  while (true) {
    const { data: stampedJobs, error: stampedError } = await db
      .from('message_jobs')
      .select('id, copy_rendering_id')
      .eq('account_id', accountId)
      .not('copy_rendering_id', 'is', null)
      .range(stampedFrom, stampedFrom + stampedPageSize - 1);
    if (stampedError) throw stampedError;
    const page = stampedJobs ?? [];
    for (const job of page) {
      const jobId = String((job as { id: string }).id);
      const renderingId = String((job as { copy_rendering_id: string }).copy_rendering_id);
      const contentId = contentByRendering.get(renderingId);
      if (!contentId) continue;
      const stats = contentStats.get(contentId) ?? {
        jobIds: new Set<string>(),
        subjectJobs: new Map<string, Set<string>>(),
        bodyJobs: new Map<string, Set<string>>(),
      };
      stats.jobIds.add(jobId);
      for (const piece of piecesByRendering.get(renderingId) ?? []) {
        const bucket = piece.kind === 'subject' ? stats.subjectJobs : stats.bodyJobs;
        const jobs = bucket.get(piece.pieceId) ?? new Set<string>();
        jobs.add(jobId);
        bucket.set(piece.pieceId, jobs);
      }
      contentStats.set(contentId, stats);
    }
    if (page.length < stampedPageSize) break;
    stampedFrom += stampedPageSize;
  }

  for (const [contentId, stats] of contentStats) {
    const contentStamped = stats.jobIds.size;
    let subjectSum = 0;
    const subjectCounts: number[] = [];
    for (const jobs of stats.subjectJobs.values()) {
      subjectSum += jobs.size;
      subjectCounts.push(jobs.size);
    }
    if (stats.subjectJobs.size > 0 && subjectSum !== contentStamped) {
      failures.push(
        `content ${contentId} subject job counts sum to ${subjectSum}, expected ${contentStamped}`,
      );
    }
    for (const [pieceId, jobs] of stats.bodyJobs) {
      if (jobs.size !== contentStamped) {
        failures.push(
          `content ${contentId} body piece ${pieceId} job count ${jobs.size}, expected ${contentStamped}`,
        );
      }
    }
    if (
      stats.subjectJobs.size >= 2 &&
      contentStamped >= 2 &&
      subjectCounts.length > 0 &&
      subjectCounts.every((n) => n === contentStamped)
    ) {
      failures.push(
        `content ${contentId} subject pieces all equal content total ${contentStamped}`,
      );
    }
  }

  const { data: sample, error: sampleError } = await db
    .from('message_jobs')
    .select('id, campaign_id, lead_id, variant_id, copy_rendering_id, copy_renderings!inner(render_key, content_id, copy_contents!inner(subject))')
    .eq('account_id', accountId)
    .not('copy_rendering_id', 'is', null)
    .limit(25);
  if (sampleError) throw sampleError;
  for (const row of sample ?? []) {
    const rendering = (row as {
      copy_renderings?: {
        render_key?: string;
        copy_contents?: { subject?: string } | { subject?: string }[];
      };
    }).copy_renderings;
    const contents = rendering?.copy_contents;
    const content = Array.isArray(contents) ? contents[0] : contents;
    const seed = buildSpintaxSeed({
      campaignId: String((row as { campaign_id: string }).campaign_id),
      leadId: String((row as { lead_id: string }).lead_id),
      variantId: (row as { variant_id?: string | null }).variant_id,
    });
    const expected = selectSubjectBranchKey(String(content?.subject ?? ''), seed);
    const stored = String(rendering?.render_key ?? '');
    if (expected !== stored) {
      failures.push(`job ${(row as { id: string }).id} render_key ${stored} != ${expected}`);
    }
  }

  const started = Date.now();
  const { error: rpcError } = await db.rpc('account_copy_stats', {
    p_account_id: accountId,
    p_start_date: null,
    p_end_date: null,
    p_campaign_ids: null,
    p_kind: 'subject',
    p_group_by: 'piece',
  } as never);
  if (rpcError) failures.push(`account_copy_stats: ${rpcError.message}`);
  const elapsed = Date.now() - started;
  if (elapsed > 15_000) failures.push(`account_copy_stats took ${elapsed}ms`);

  console.log(JSON.stringify({ verify: counts, spot_checks: (sample ?? []).length, rpc_ms: elapsed, failures }, null, 2));
  if (failures.length > 0) {
    throw new Error(`verify failed: ${failures.join('; ')}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
  const serviceKey =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!supabaseUrl || !serviceKey) {
    throw new Error('SUPABASE URL and service-role key are required');
  }
  if ((args.live || args.verify) && !args.accountId) {
    throw new Error('Live/verify requires --account-id');
  }

  const db = createClient(supabaseUrl, serviceKey);
  if (!args.accountId) {
    console.log(JSON.stringify({ mode: 'dry-run', error: 'account-id required to inventory' }, null, 2));
    return;
  }

  if (args.verify) {
    const counts = await inventoryAccount(db, args.accountId);
    console.log(
      JSON.stringify(
        {
          mode: 'verify',
          account_id: args.accountId,
          ...counts,
          limit: args.limit,
        },
        null,
        2,
      ),
    );
    await verifyAccount(db, args.accountId);
    return;
  }

  if (!args.live) {
    const counts = await inventoryAccount(db, args.accountId);
    console.log(
      JSON.stringify(
        {
          mode: 'dry-run',
          account_id: args.accountId,
          ...counts,
          limit: args.limit,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(
    JSON.stringify(
      {
        mode: 'live',
        account_id: args.accountId,
        limit: args.limit,
        batch_size: args.batchSize,
      },
      null,
      2,
    ),
  );
  const result = await stampAccount(db, args.accountId, args.limit, args.batchSize);
  console.log(JSON.stringify(result, null, 2));
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
