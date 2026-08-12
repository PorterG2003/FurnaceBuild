/**
 * Score LinkedIn webinar posts for pipeline intent (Phase 0a).
 *
 * Usage:
 *   cd scripts/lead-sourcing/webinar-hosts
 *   npm run score-pipeline-intent -- [--concurrency 20] [--max-rows N] [--fixtures] [--resume]
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CallCounter } from '../lib/callCounter.js';
import { readCsv, writeCsv } from '../lib/csv.js';
import { ensureEnv, packageRoot } from '../lib/env.js';
import { linkedInActivityId } from '../stage3-enrich/backfillSalesTopics.js';
import { scorePipelineIntent, type PipelineIntentLlmResult } from './pipelineIntentLlm.js';

const JUNE_RUN = resolve(packageRoot, 'output/runs/2026-06-webinar-hosts');
const JULY_RUN = resolve(packageRoot, 'output/runs/2026-07-08-linkedin-webinar-posts');
const JULY_TOPICS = resolve(
  packageRoot,
  'output/runs/2026-07-15-meta-ads-linkedin-jul08-new/sales-export/meta-ads-jul08-new-completed-2026-07-16-with-topics.csv',
);
const OUT_DIR = resolve(packageRoot, 'output/runs/2026-07-29-aug13-scope');

type Cli = {
  concurrency: number;
  maxRows: number | null;
  fixtures: boolean;
  resume: boolean;
  retryUnclear: boolean;
  outDir: string;
};

function parseCli(argv: string[]): Cli {
  const cli: Cli = {
    concurrency: 20,
    maxRows: null,
    fixtures: false,
    resume: false,
    retryUnclear: false,
    outDir: OUT_DIR,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--concurrency' && argv[i + 1]) cli.concurrency = Number(argv[++i]) || 20;
    else if (arg === '--max-rows' && argv[i + 1]) cli.maxRows = Number(argv[++i]) || null;
    else if (arg === '--out-dir' && argv[i + 1]) cli.outDir = resolve(argv[++i]);
    else if (arg === '--fixtures') cli.fixtures = true;
    else if (arg === '--resume') cli.resume = true;
    else if (arg === '--retry-unclear') cli.retryUnclear = true;
  }
  return cli;
}

function loadPostTextByActivityId(stage2Paths: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const path of stage2Paths) {
    if (!existsSync(path)) continue;
    for (const row of readCsv(path)) {
      const id = linkedInActivityId(row.result_url);
      const text = (row.post_text ?? '').trim();
      if (!id || !text || map.has(id)) continue;
      map.set(id, text);
    }
  }
  return map;
}

function loadTopicByActivityId(topicsPath: string, postTextById: Map<string, string>): Map<string, string> {
  const byDomain = new Map<string, string>();
  const byName = new Map<string, string>();
  if (existsSync(topicsPath)) {
    for (const row of readCsv(topicsPath)) {
      const topic = (row.webinar_topic ?? '').trim();
      if (!topic) continue;
      const domain = (row.company_domain ?? '').trim().toLowerCase().replace(/^www\./, '');
      const name = (row.company_name ?? '').trim().toLowerCase();
      if (domain) byDomain.set(domain, topic);
      if (name) byName.set(name, topic);
    }
  }

  // Also rebuild from stage2 via activity for posts that already have topic in sales export sample_post_url
  const topicByActivity = new Map<string, string>();
  if (existsSync(topicsPath)) {
    for (const row of readCsv(topicsPath)) {
      const topic = (row.webinar_topic ?? '').trim();
      const id = linkedInActivityId(row.sample_post_url);
      if (id && topic) topicByActivity.set(id, topic);
    }
  }

  // Expose domain/name maps for lead joins via side channel on function return — handled in main
  void postTextById;
  void byDomain;
  void byName;
  return topicByActivity;
}

type LeadRow = {
  email: string;
  first_name: string;
  last_name: string;
  company_name: string;
  website: string;
  sample_post_url: string;
  contact_title: string;
  contact_tier: string;
  industry: string;
  pool: 'june' | 'july';
  activity_id: string;
};

function domainFromWebsite(website: string): string {
  const w = website.trim().toLowerCase();
  if (!w) return '';
  try {
    const withProto = w.includes('://') ? w : `http://${w}`;
    return new URL(withProto).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function loadLeads(): LeadRow[] {
  const out: LeadRow[] = [];
  const junePath = join(JUNE_RUN, 'stage4_webinar_host_leads.csv');
  const julyPath = join(JULY_RUN, 'stage4_webinar_host_leads.csv');
  for (const [pool, path] of [
    ['june', junePath],
    ['july', julyPath],
  ] as const) {
    for (const row of readCsv(path)) {
      const email = (row.email ?? '').trim().toLowerCase();
      const activityId = linkedInActivityId(row.sample_post_url) ?? '';
      if (!email) continue;
      out.push({
        email,
        first_name: row.first_name ?? '',
        last_name: row.last_name ?? '',
        company_name: row.company_name ?? '',
        website: row.website ?? '',
        sample_post_url: row.sample_post_url ?? '',
        contact_title: row.contact_title ?? '',
        contact_tier: row.contact_tier ?? '',
        industry: row.industry ?? '',
        pool,
        activity_id: activityId,
      });
    }
  }
  return out;
}

function loadJuneVerifiedEmails(): Set<string> {
  const set = new Set<string>();
  for (const name of [
    'furnace_import_core_verified.csv',
    'furnace_import_revenue_verified.csv',
    'furnace_import_community_verified.csv',
  ]) {
    const path = join(JUNE_RUN, 'mv-verified', name);
    if (!existsSync(path)) continue;
    for (const row of readCsv(path)) {
      const email = (row.Email ?? row.email ?? '').trim().toLowerCase();
      if (email) set.add(email);
    }
  }
  return set;
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function checkpointPath(outDir: string): string {
  return join(outDir, 'intent_scores_checkpoint.json');
}

type Checkpoint = Record<string, PipelineIntentLlmResult & { activity_id: string; post_excerpt: string }>;

async function main(): Promise<void> {
  const cli = parseCli(process.argv.slice(2));
  await ensureEnv();
  mkdirSync(cli.outDir, { recursive: true });

  const postTextById = loadPostTextByActivityId([
    join(JUNE_RUN, 'stage2_linkedin_webinar_posts_extracted.csv'),
    join(JULY_RUN, 'stage2_linkedin_webinar_posts_extracted.csv'),
  ]);
  const topicByActivity = loadTopicByActivityId(JULY_TOPICS, postTextById);

  // Domain/name topic maps for lead-level topic coverage
  const topicByDomain = new Map<string, string>();
  const topicByName = new Map<string, string>();
  if (existsSync(JULY_TOPICS)) {
    for (const row of readCsv(JULY_TOPICS)) {
      const topic = (row.webinar_topic ?? '').trim();
      if (!topic) continue;
      const domain = (row.company_domain ?? '').trim().toLowerCase().replace(/^www\./, '');
      const name = (row.company_name ?? '').trim().toLowerCase();
      if (domain) topicByDomain.set(domain, topic);
      if (name) topicByName.set(name, topic);
      const id = linkedInActivityId(row.sample_post_url);
      if (id) topicByActivity.set(id, topic);
    }
  }

  const leads = loadLeads();
  const juneVerified = loadJuneVerifiedEmails();
  const neededIds = [...new Set(leads.map((l) => l.activity_id).filter(Boolean))];
  const toScore = neededIds.filter((id) => postTextById.has(id));
  const limited = cli.maxRows != null ? toScore.slice(0, cli.maxRows) : toScore;

  let checkpoint: Checkpoint = {};
  const cpPath = checkpointPath(cli.outDir);
  if ((cli.resume || cli.retryUnclear) && existsSync(cpPath)) {
    checkpoint = JSON.parse(readFileSync(cpPath, 'utf8')) as Checkpoint;
    console.log(`[score-pipeline-intent] loaded ${Object.keys(checkpoint).length} scores`);
  }

  let pending = limited.filter((id) => !checkpoint[id]);
  if (cli.retryUnclear) {
    const unclearIds = limited.filter((id) => checkpoint[id]?.intent === 'unclear');
    for (const id of unclearIds) delete checkpoint[id];
    pending = unclearIds;
    console.log(`[score-pipeline-intent] retrying unclear=${pending.length}`);
  }
  console.log(
    `[score-pipeline-intent] unique lead posts=${neededIds.length} with_text=${toScore.length} pending=${pending.length} concurrency=${cli.concurrency}`,
  );

  const counter = new CallCounter();
  let done = 0;
  await mapPool(pending, cli.concurrency, async (activityId) => {
    const postText = postTextById.get(activityId) ?? '';
    const topic = topicByActivity.get(activityId) ?? '';
    const result = await scorePipelineIntent(postText, {
      useFixtures: cli.fixtures,
      webinarTopic: topic,
      counter,
    });
    checkpoint[activityId] = {
      ...result,
      activity_id: activityId,
      post_excerpt: postText.replace(/\s+/g, ' ').slice(0, 220),
    };
    done += 1;
    if (done % 50 === 0 || done === pending.length) {
      writeFileSync(cpPath, JSON.stringify(checkpoint, null, 2));
      console.log(`[score-pipeline-intent] ${done}/${pending.length} (api calls ${counter.snapshot().openrouter_calls ?? 0})`);
    }
  });
  writeFileSync(cpPath, JSON.stringify(checkpoint, null, 2));

  const scoreRows = Object.values(checkpoint).map((row) => ({
    activity_id: row.activity_id,
    intent: row.intent,
    pass: row.pass ? 'yes' : 'no',
    confidence: String(row.confidence),
    audience: row.audience,
    reason: row.reason,
    source: row.source,
    post_excerpt: row.post_excerpt,
    webinar_topic: topicByActivity.get(row.activity_id) ?? '',
  }));
  writeCsv(join(cli.outDir, 'intent_scores.csv'), scoreRows, [
    'activity_id',
    'intent',
    'pass',
    'confidence',
    'audience',
    'reason',
    'source',
    'webinar_topic',
    'post_excerpt',
  ]);

  function resolveTopic(lead: LeadRow): string {
    return (
      topicByActivity.get(lead.activity_id) ||
      topicByDomain.get(domainFromWebsite(lead.website)) ||
      topicByName.get(lead.company_name.trim().toLowerCase()) ||
      ''
    );
  }

  function intentPass(lead: LeadRow): boolean {
    const score = checkpoint[lead.activity_id];
    return Boolean(score?.pass);
  }

  const julyNever = leads.filter((l) => l.pool === 'july' && !juneVerified.has(l.email));
  const juneVerLeads = leads.filter((l) => l.pool === 'june' && juneVerified.has(l.email));
  // Prefer june verified file emails that appear in june stage4
  const junePass = juneVerLeads.filter(intentPass);
  const julyPass = julyNever.filter(intentPass);

  const passByTier = (rows: LeadRow[]) => {
    const c: Record<string, number> = {};
    for (const r of rows) {
      const t = r.contact_tier || 'unknown';
      c[t] = (c[t] ?? 0) + 1;
    }
    return c;
  };

  const intentCounts: Record<string, number> = {};
  for (const row of scoreRows) {
    intentCounts[row.intent] = (intentCounts[row.intent] ?? 0) + 1;
  }
  const passScores = scoreRows.filter((r) => r.pass === 'yes').length;

  const julyPassWithTopic = julyPass.filter((l) => resolveTopic(l)).length;
  const junePassWithTopic = junePass.filter((l) => resolveTopic(l)).length;

  // QA sample: 15 pass + 15 fail
  const passSamples = scoreRows.filter((r) => r.pass === 'yes').slice(0, 15);
  const failSamples = scoreRows.filter((r) => r.pass === 'no').slice(0, 15);
  const qaRows = [...passSamples, ...failSamples].map((r) => ({
    ...r,
    qa_bucket: r.pass === 'yes' ? 'pass' : 'fail',
  }));
  writeCsv(
    join(cli.outDir, 'intent_qa_sample.csv'),
    qaRows,
    ['qa_bucket', 'activity_id', 'intent', 'pass', 'confidence', 'reason', 'webinar_topic', 'post_excerpt'],
  );

  // Enriched lead exports for later phases
  const enrich = (lead: LeadRow) => {
    const score = checkpoint[lead.activity_id];
    return {
      email: lead.email,
      first_name: lead.first_name,
      last_name: lead.last_name,
      company_name: lead.company_name,
      website: lead.website,
      sample_post_url: lead.sample_post_url,
      contact_title: lead.contact_title,
      contact_tier: lead.contact_tier,
      industry: lead.industry,
      pool: lead.pool,
      activity_id: lead.activity_id,
      webinar_topic: resolveTopic(lead),
      intent: score?.intent ?? 'missing_score',
      intent_pass: score?.pass ? 'yes' : 'no',
      intent_confidence: score ? String(score.confidence) : '',
      intent_reason: score?.reason ?? 'no_score',
    };
  };

  const leadCols = [
    'email',
    'first_name',
    'last_name',
    'company_name',
    'website',
    'sample_post_url',
    'contact_title',
    'contact_tier',
    'industry',
    'pool',
    'activity_id',
    'webinar_topic',
    'intent',
    'intent_pass',
    'intent_confidence',
    'intent_reason',
  ];
  writeCsv(join(cli.outDir, 'july_never_emailed_scored.csv'), julyNever.map(enrich), leadCols);
  writeCsv(join(cli.outDir, 'june_verified_scored.csv'), juneVerLeads.map(enrich), leadCols);
  writeCsv(join(cli.outDir, 'july_cold_pass.csv'), julyPass.map(enrich), leadCols);
  writeCsv(join(cli.outDir, 'june_retarget_pass.csv'), junePass.map(enrich), leadCols);

  const summary = {
    scored_unique_posts: scoreRows.length,
    pass_posts: passScores,
    fail_posts: scoreRows.length - passScores,
    pass_rate: scoreRows.length ? passScores / scoreRows.length : 0,
    intent_counts: intentCounts,
    july_never_emailed: julyNever.length,
    july_never_emailed_pass: julyPass.length,
    july_pass_with_topic: julyPassWithTopic,
    july_pass_topic_rate: julyPass.length ? julyPassWithTopic / julyPass.length : 0,
    july_pass_by_tier: passByTier(julyPass),
    june_verified: juneVerLeads.length,
    june_verified_pass: junePass.length,
    june_pass_with_topic: junePassWithTopic,
    june_pass_topic_rate: junePass.length ? junePassWithTopic / junePass.length : 0,
    june_pass_by_tier: passByTier(junePass),
    openrouter_calls: counter.snapshot().openrouter_calls ?? 0,
    out_dir: cli.outDir,
  };
  writeFileSync(join(cli.outDir, 'scope_summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
