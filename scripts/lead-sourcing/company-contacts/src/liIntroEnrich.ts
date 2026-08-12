/**
 * Enrich Hunter mv_pass leads with li_intro_line / li_time_in_role via Apify
 * LinkedIn profile scrape (dev_fusion/linkedin-profile-scraper).
 *
 * Usage (from scripts/lead-sourcing/company-contacts):
 *   npm run li-intro-enrich -- --dry-run
 *   npm run li-intro-enrich -- --live --max-profiles 25
 *   npm run li-intro-enrich -- --live --reset-failed   # retry prior apify_fail
 *   npm run li-intro-enrich -- --live   # resume full remaining via checkpoint
 *
 * Live Apify requires APIFY_TOKEN and explicit --live. Default is dry-run.
 * Actor: harvestapi/linkedin-profile-scraper (~$4/1k, LIMITED_PERMISSIONS).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApifyClient } from 'apify-client';
import { config as loadDotenv } from 'dotenv';
import { formatLiIntroLine } from './liIntroFormat.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: resolve(__dirname, '../.env') });

/** First index of the Aug 11 11+ Hunter wave in hunter_checkpoint.json */
const DEFAULT_WAVE_START = 11050;
/**
 * Prefer harvestapi: works under LIMITED_PERMISSIONS (dev_fusion requires
 * full-account approval) and returns Clay-style durations ("4 yrs 7 mos").
 */
const ACTOR_ID = 'harvestapi/linkedin-profile-scraper';
const DEFAULT_BATCH_SIZE = 25;
/** ~$4 / 1k profiles (no-email mode) */
const COST_PER_PROFILE_USD = 0.004;

const CUSTOM_KEYS = [
  'Title',
  '# Employees',
  'Industry',
  'Keywords',
  'Company Address',
  'Company City',
  'Company State',
  'Company Country',
  'Company Phone',
  'Start Date - Experience',
  'Completed Sentence completed Sentence',
  'Years Until 2026',
  'Over 5 Years',
  'Completed Sentence',
  'Most_Recent_Job_Start',
  'employee_count',
  'li_time_in_role',
  'li_intro_line',
] as const;

type HunterResultRow = {
  company_name: string;
  company_domain: string;
  employee_count: string;
  industry: string;
  person_name: string;
  person_title: string;
  email: string;
  linkedin: string;
  outcome: string;
};

type CohortLead = {
  email: string;
  first_name: string;
  last_name: string;
  name: string;
  company_name: string;
  website: string;
  linkedin_url: string;
  person_title: string;
  employee_count: string;
  industry: string;
};

type EnrichStatus =
  | 'pending_apify'
  | 'apify_ok'
  | 'apify_fail'
  | 'fallback_no_linkedin'
  | 'fallback_short_tenure'
  | 'fallback_no_duration';

type EnrichRow = {
  email: string;
  linkedin_url: string;
  person_title: string;
  status: EnrichStatus;
  current_job_duration: string;
  li_time_in_role: string;
  li_intro_line: string;
  intro_source: 'tenure' | 'fallback';
  error: string;
  updated_at: string;
};

type LiIntroCheckpoint = {
  version: 1;
  started_at: string;
  updated_at: string;
  wave_start: number;
  actor_id: string;
  stats: {
    cohort: number;
    with_linkedin: number;
    without_linkedin: number;
    apify_ok: number;
    apify_fail: number;
    tenure: number;
    fallback: number;
    apify_calls: number;
  };
  rows: EnrichRow[];
};

type CliArgs = {
  dryRun: boolean;
  live: boolean;
  resetFailed: boolean;
  maxProfiles: number | null;
  waveStart: number;
  batchSize: number;
  runDir: string;
  outDir: string;
  checkpointPath: string;
};

function parseArgs(argv: string[]): CliArgs {
  const get = (flag: string): string | null => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] ? argv[i + 1]! : null;
  };
  const has = (flag: string) => argv.includes(flag);
  const live = has('--live');
  const dryRun = has('--dry-run') || !live;
  const resetFailed = has('--reset-failed');

  const defaultRun = resolve(
    __dirname,
    '../output/runs/2026-07-21-no-contact-found',
  );
  const runDir = resolve(get('--run-dir') ?? defaultRun);
  const outDir = resolve(get('--out-dir') ?? join(runDir, 'hunter/li-intro'));
  const checkpointPath = resolve(
    get('--checkpoint') ?? join(outDir, 'li_intro_checkpoint.json'),
  );

  const maxRaw = get('--max-profiles');
  const maxProfiles = maxRaw != null ? Number(maxRaw) : null;
  if (maxRaw != null && (!Number.isFinite(maxProfiles) || maxProfiles! < 1)) {
    throw new Error(`Invalid --max-profiles: ${maxRaw}`);
  }

  const waveRaw = get('--wave-start');
  const waveStart = waveRaw != null ? Number(waveRaw) : DEFAULT_WAVE_START;
  if (!Number.isFinite(waveStart) || waveStart < 0) {
    throw new Error(`Invalid --wave-start: ${waveRaw}`);
  }

  const batchRaw = get('--batch-size');
  const batchSize = batchRaw != null ? Number(batchRaw) : DEFAULT_BATCH_SIZE;
  if (!Number.isFinite(batchSize) || batchSize < 1) {
    throw new Error(`Invalid --batch-size: ${batchRaw}`);
  }

  return {
    dryRun,
    live,
    resetFailed,
    maxProfiles,
    waveStart,
    batchSize,
    runDir,
    outDir,
    checkpointPath,
  };
}

function splitName(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: '', last: '' };
  if (parts.length === 1) return { first: parts[0]!, last: '' };
  return { first: parts[0]!, last: parts.slice(1).join(' ') };
}

function normalizeLinkedInUrl(raw: string): string {
  const t = (raw || '').trim();
  if (!t) return '';
  if (t.startsWith('http://') || t.startsWith('https://')) return t;
  return `https://${t.replace(/^\/+/, '')}`;
}

function normalizeWebsite(domain: string): string {
  const t = (domain || '').trim();
  if (!t) return '';
  if (t.startsWith('http://') || t.startsWith('https://')) return t;
  return `https://${t}`;
}

function loadCohort(runDir: string, waveStart: number): CohortLead[] {
  const ckPath = join(runDir, 'hunter', 'hunter_checkpoint.json');
  if (!existsSync(ckPath)) {
    throw new Error(`Missing hunter checkpoint: ${ckPath}`);
  }
  const ck = JSON.parse(readFileSync(ckPath, 'utf8')) as {
    results: HunterResultRow[];
  };
  const slice = (ck.results || []).slice(waveStart);
  const leads: CohortLead[] = [];
  const seen = new Set<string>();
  for (const r of slice) {
    if (r.outcome !== 'mv_pass') continue;
    const email = (r.email || '').trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    const { first, last } = splitName(r.person_name || '');
    leads.push({
      email,
      first_name: first,
      last_name: last,
      name: (r.person_name || '').trim(),
      company_name: r.company_name || '',
      website: normalizeWebsite(r.company_domain || ''),
      linkedin_url: normalizeLinkedInUrl(r.linkedin || ''),
      person_title: (r.person_title || '').trim(),
      employee_count: r.employee_count || '',
      industry: r.industry || '',
    });
  }
  return leads;
}

function emptyStats(): LiIntroCheckpoint['stats'] {
  return {
    cohort: 0,
    with_linkedin: 0,
    without_linkedin: 0,
    apify_ok: 0,
    apify_fail: 0,
    tenure: 0,
    fallback: 0,
    apify_calls: 0,
  };
}

function recomputeStats(rows: EnrichRow[]): LiIntroCheckpoint['stats'] {
  const stats = emptyStats();
  stats.cohort = rows.length;
  for (const row of rows) {
    if (row.linkedin_url) stats.with_linkedin += 1;
    else stats.without_linkedin += 1;
    if (row.status === 'apify_ok') stats.apify_ok += 1;
    if (row.status === 'apify_fail') stats.apify_fail += 1;
    if (row.intro_source === 'tenure') stats.tenure += 1;
    else if (row.li_intro_line) stats.fallback += 1;
  }
  return stats;
}

function applyFallback(row: EnrichRow, status: EnrichStatus, error = ''): void {
  const formatted = formatLiIntroLine(row.person_title, row.current_job_duration || null);
  row.status = status;
  row.li_time_in_role = formatted.li_time_in_role;
  row.li_intro_line = formatted.li_intro_line;
  row.intro_source = 'fallback';
  row.error = error;
  row.updated_at = new Date().toISOString();
}

function applyTenure(row: EnrichRow, duration: string): void {
  const formatted = formatLiIntroLine(row.person_title, duration);
  row.current_job_duration = duration;
  row.li_time_in_role = formatted.li_time_in_role;
  row.li_intro_line = formatted.li_intro_line;
  row.intro_source = formatted.source;
  row.status =
    formatted.source === 'tenure' ? 'apify_ok' : 'fallback_short_tenure';
  row.error = '';
  row.updated_at = new Date().toISOString();
}

function initCheckpoint(leads: CohortLead[], waveStart: number): LiIntroCheckpoint {
  const now = new Date().toISOString();
  const rows: EnrichRow[] = leads.map((lead) => {
    const base: EnrichRow = {
      email: lead.email,
      linkedin_url: lead.linkedin_url,
      person_title: lead.person_title,
      status: lead.linkedin_url ? 'pending_apify' : 'fallback_no_linkedin',
      current_job_duration: '',
      li_time_in_role: '',
      li_intro_line: '',
      intro_source: 'fallback',
      error: '',
      updated_at: now,
    };
    if (!lead.linkedin_url) {
      applyFallback(base, 'fallback_no_linkedin');
    }
    return base;
  });
  const stats = recomputeStats(rows);
  return {
    version: 1,
    started_at: now,
    updated_at: now,
    wave_start: waveStart,
    actor_id: ACTOR_ID,
    stats: { ...stats, apify_calls: 0 },
    rows,
  };
}

function loadOrInitCheckpoint(
  path: string,
  leads: CohortLead[],
  waveStart: number,
): LiIntroCheckpoint {
  if (!existsSync(path)) return initCheckpoint(leads, waveStart);
  const existing = JSON.parse(readFileSync(path, 'utf8')) as LiIntroCheckpoint;
  const byEmail = new Map(existing.rows.map((r) => [r.email, r]));
  // Ensure any new cohort emails are present; preserve completed rows.
  for (const lead of leads) {
    if (byEmail.has(lead.email)) continue;
    const row: EnrichRow = {
      email: lead.email,
      linkedin_url: lead.linkedin_url,
      person_title: lead.person_title,
      status: lead.linkedin_url ? 'pending_apify' : 'fallback_no_linkedin',
      current_job_duration: '',
      li_time_in_role: '',
      li_intro_line: '',
      intro_source: 'fallback',
      error: '',
      updated_at: new Date().toISOString(),
    };
    if (!lead.linkedin_url) applyFallback(row, 'fallback_no_linkedin');
    existing.rows.push(row);
  }
  existing.stats = {
    ...recomputeStats(existing.rows),
    apify_calls: existing.stats?.apify_calls ?? 0,
  };
  return existing;
}

function saveCheckpoint(path: string, ck: LiIntroCheckpoint): void {
  mkdirSync(dirname(path), { recursive: true });
  ck.updated_at = new Date().toISOString();
  const calls = ck.stats.apify_calls;
  ck.stats = { ...recomputeStats(ck.rows), apify_calls: calls };
  writeFileSync(path, JSON.stringify(ck, null, 2));
}

function requireApifyToken(): string {
  const token = process.env.APIFY_TOKEN?.trim();
  if (!token) {
    throw new Error(
      'APIFY_TOKEN is required for --live. Export it or add to company-contacts/.env',
    );
  }
  return token;
}

function durationFromPosition(pos: unknown): string {
  if (!pos || typeof pos !== 'object') return '';
  const d = (pos as Record<string, unknown>).duration;
  return typeof d === 'string' && d.trim() ? d.trim() : '';
}

function extractDuration(item: Record<string, unknown>): string {
  // harvestapi: currentPosition[] / experience[]
  const current = item.currentPosition;
  if (Array.isArray(current) && current.length > 0) {
    const d = durationFromPosition(current[0]);
    if (d) return d;
  }
  const experience = item.experience;
  if (Array.isArray(experience) && experience.length > 0) {
    const d = durationFromPosition(experience[0]);
    if (d) return d;
  }
  // dev_fusion-style fallback
  const direct = item.currentJobDuration;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  const nested = item.experienceData;
  if (nested && typeof nested === 'object') {
    const d = (nested as Record<string, unknown>).currentJobDuration;
    if (typeof d === 'string' && d.trim()) return d.trim();
  }
  return '';
}

function extractInputUrl(item: Record<string, unknown>): string {
  for (const key of ['linkedinUrl', 'linkedinPublicUrl', 'inputUrl', 'url']) {
    const v = item[key];
    if (typeof v === 'string' && v.trim()) return normalizeLinkedInUrl(v);
  }
  return '';
}

function linkedInKey(url: string): string {
  try {
    const u = new URL(normalizeLinkedInUrl(url));
    const path = u.pathname.replace(/\/+$/, '').toLowerCase();
    return path;
  } catch {
    return normalizeLinkedInUrl(url).toLowerCase();
  }
}

async function runApifyBatch(
  client: ApifyClient,
  urls: string[],
): Promise<Record<string, unknown>[]> {
  const run = await client.actor(ACTOR_ID).call({
    urls,
    // Cheapest mode that still returns experience durations (~$4/1k).
    profileScraperMode: 'Profile details no email ($4 per 1k)',
  });
  if (!run.defaultDatasetId) {
    throw new Error(`Apify run ${run.id} produced no dataset`);
  }
  const { items } = await client.dataset(run.defaultDatasetId).listItems({ limit: 10_000 });
  return items as Record<string, unknown>[];
}

function buildPatchPayload(
  leads: CohortLead[],
  enrichByEmail: Map<string, EnrichRow>,
): Array<Record<string, unknown>> {
  return leads.map((lead) => {
    const enrich = enrichByEmail.get(lead.email);
    const custom: Record<string, string> = {};
    for (const k of CUSTOM_KEYS) custom[k] = '';
    custom.Title = lead.person_title;
    custom['# Employees'] = lead.employee_count;
    custom.employee_count = lead.employee_count;
    custom.Industry = lead.industry;
    custom.li_time_in_role = enrich?.li_time_in_role ?? '';
    custom.li_intro_line = enrich?.li_intro_line ?? formatLiIntroLine(lead.person_title, null).li_intro_line;
    return {
      email: lead.email,
      first_name: lead.first_name,
      last_name: lead.last_name,
      name: lead.name,
      company_name: lead.company_name,
      website: lead.website,
      linkedin_url: lead.linkedin_url,
      custom_lead_data: custom,
    };
  });
}

function printReport(ck: LiIntroCheckpoint, pendingApify: number, maxProfiles: number | null): void {
  const sampleTenure = ck.rows.filter((r) => r.intro_source === 'tenure').slice(0, 5);
  const sampleFallback = ck.rows.filter((r) => r.status === 'fallback_no_linkedin').slice(0, 3);
  console.log(
    JSON.stringify(
      {
        cohort: ck.stats.cohort,
        with_linkedin: ck.stats.with_linkedin,
        without_linkedin: ck.stats.without_linkedin,
        pending_apify: pendingApify,
        apify_ok: ck.stats.apify_ok,
        apify_fail: ck.stats.apify_fail,
        tenure: ck.stats.tenure,
        fallback: ck.stats.fallback,
        apify_calls: ck.stats.apify_calls,
        next_batch_cap: maxProfiles,
        est_cost_usd_if_full_pending: Number(
          (pendingApify * COST_PER_PROFILE_USD).toFixed(2),
        ),
        sample_tenure: sampleTenure.map((r) => ({
          email: r.email,
          duration: r.current_job_duration,
          intro: r.li_intro_line,
        })),
        sample_fallback_no_li: sampleFallback.map((r) => ({
          email: r.email,
          intro: r.li_intro_line,
        })),
      },
      null,
      2,
    ),
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  mkdirSync(args.outDir, { recursive: true });

  const leads = loadCohort(args.runDir, args.waveStart);
  const ck = loadOrInitCheckpoint(args.checkpointPath, leads, args.waveStart);
  ck.actor_id = ACTOR_ID;
  // Seed no-linkedin fallbacks if somehow empty
  for (const row of ck.rows) {
    if (!row.linkedin_url && !row.li_intro_line) {
      applyFallback(row, 'fallback_no_linkedin');
    }
  }
  if (args.resetFailed) {
    let reset = 0;
    for (const row of ck.rows) {
      if (row.status === 'apify_fail' && row.linkedin_url) {
        row.status = 'pending_apify';
        row.current_job_duration = '';
        row.li_time_in_role = '';
        row.li_intro_line = '';
        row.intro_source = 'fallback';
        row.error = '';
        row.updated_at = new Date().toISOString();
        reset += 1;
      }
    }
    console.log(`reset-failed: re-queued ${reset} apify_fail rows`);
  }
  saveCheckpoint(args.checkpointPath, ck);

  const pending = ck.rows.filter((r) => r.status === 'pending_apify' && r.linkedin_url);
  printReport(ck, pending.length, args.maxProfiles);

  const patchPath = join(args.outDir, 'li_intro_patch.json');
  const leadByEmail = new Map(leads.map((l) => [l.email, l]));

  if (args.dryRun) {
    // Dry-run still writes patch with fallbacks for no-LI + any already enriched
    const enrichMap = new Map(ck.rows.map((r) => [r.email, r]));
    // For pending, preview fallback intros so patch is usable offline if needed
    for (const row of pending) {
      if (!row.li_intro_line) {
        const preview = formatLiIntroLine(row.person_title, null);
        row.li_intro_line = preview.li_intro_line;
        row.intro_source = 'fallback';
      }
    }
    const patchLeads = leads.filter((l) => leadByEmail.has(l.email));
    writeFileSync(patchPath, JSON.stringify(buildPatchPayload(patchLeads, enrichMap), null, 2));
    console.log(`dry-run: wrote preview patch ${patchPath} (pending still need Apify)`);
    console.log('Pass --live to call Apify (requires spend OK).');
    return;
  }

  if (!args.live) {
    throw new Error('Refuse to spend: pass --live explicitly');
  }

  const client = new ApifyClient({ token: requireApifyToken() });
  const queue = pending.slice(0, args.maxProfiles ?? pending.length);
  console.log(
    `live: scraping ${queue.length} profiles via ${ACTOR_ID} (batch=${args.batchSize}, est $${(
      queue.length * COST_PER_PROFILE_USD
    ).toFixed(2)})`,
  );

  const byLi = new Map<string, EnrichRow[]>();
  for (const row of queue) {
    const key = linkedInKey(row.linkedin_url);
    const list = byLi.get(key) ?? [];
    list.push(row);
    byLi.set(key, list);
  }

  for (let i = 0; i < queue.length; i += args.batchSize) {
    const batch = queue.slice(i, i + args.batchSize);
    const urls = batch.map((r) => r.linkedin_url);
    console.log(`Apify batch ${i / args.batchSize + 1}: ${urls.length} urls…`);
    let items: Record<string, unknown>[] = [];
    try {
      items = await runApifyBatch(client, urls);
      ck.stats.apify_calls += urls.length;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      for (const row of batch) {
        applyFallback(row, 'apify_fail', msg);
      }
      saveCheckpoint(args.checkpointPath, ck);
      continue;
    }

    const itemByKey = new Map<string, Record<string, unknown>>();
    for (const item of items) {
      const url = extractInputUrl(item);
      if (url) itemByKey.set(linkedInKey(url), item);
      // Also index succeeded:false items
      const inputUrl = typeof item.inputUrl === 'string' ? item.inputUrl : '';
      if (inputUrl) itemByKey.set(linkedInKey(inputUrl), item);
    }

    for (const row of batch) {
      const item = itemByKey.get(linkedInKey(row.linkedin_url));
      if (!item) {
        applyFallback(row, 'apify_fail', 'no_dataset_item');
        continue;
      }
      if (item.succeeded === false) {
        applyFallback(
          row,
          'apify_fail',
          typeof item.error === 'string' ? item.error : 'succeeded=false',
        );
        continue;
      }
      const duration = extractDuration(item);
      if (!duration) {
        applyFallback(row, 'fallback_no_duration', 'missing_currentJobDuration');
        continue;
      }
      applyTenure(row, duration);
    }
    saveCheckpoint(args.checkpointPath, ck);
  }

  // Ensure every row has an intro
  for (const row of ck.rows) {
    if (!row.li_intro_line) {
      applyFallback(
        row,
        row.linkedin_url ? 'fallback_no_duration' : 'fallback_no_linkedin',
      );
    }
  }
  saveCheckpoint(args.checkpointPath, ck);

  const enrichMap = new Map(ck.rows.map((r) => [r.email, r]));
  writeFileSync(patchPath, JSON.stringify(buildPatchPayload(leads, enrichMap), null, 2));
  printReport(
    ck,
    ck.rows.filter((r) => r.status === 'pending_apify').length,
    args.maxProfiles,
  );
  console.log(`wrote patch ${patchPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
