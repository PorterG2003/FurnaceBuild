import { join, resolve } from 'node:path';
import { DEFAULT_CONFIG, type ScrapeConfig } from './config.js';
import { collectPhrase } from './collector.js';
import { appendJsonl, ensureRunDir, fingerprint, loadCheckpoint, rawAdsPath, saveCheckpoint, writeCsv, writeJson } from './io.js';
import { buildAdvertiserRows, normalizeAndFilter, toAdCsvRow } from './pipeline.js';
import type { RunCheckpoint } from './types.js';

type Options = {
  runDir?: string;
  resume: boolean;
  retryErrors: boolean;
  fixtures: boolean;
  headless: boolean;
  maxQueries?: number;
  maxAds?: number;
  rateMs?: number;
  phrases?: string[];
};

function parseArgs(argv = process.argv.slice(2)): Options {
  const options: Options = { resume: false, retryErrors: false, fixtures: false, headless: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--run-dir') options.runDir = argv[++i];
    else if (arg === '--resume') options.resume = true;
    else if (arg === '--retry-errors') options.retryErrors = true;
    else if (arg === '--fixtures') options.fixtures = true;
    else if (arg === '--headless') options.headless = true;
    else if (arg === '--max-queries') options.maxQueries = Number(argv[++i]);
    else if (arg === '--max-ads') options.maxAds = Number(argv[++i]);
    else if (arg === '--rate-ms') options.rateMs = Number(argv[++i]);
    else if (arg === '--phrases') options.phrases = argv[++i]?.split(',').map((phrase) => phrase.trim()).filter(Boolean);
  }
  return options;
}

function resolveConfig(options: Options): ScrapeConfig {
  return {
    ...DEFAULT_CONFIG,
    phrases: (options.phrases ?? DEFAULT_CONFIG.phrases).slice(0, options.maxQueries ?? DEFAULT_CONFIG.phrases.length),
    maxAdsPerPhrase: options.maxAds ?? DEFAULT_CONFIG.maxAdsPerPhrase,
    rateMs: options.rateMs ?? DEFAULT_CONFIG.rateMs,
  };
}

function newCheckpoint(argsFingerprint: string, config: ScrapeConfig): RunCheckpoint {
  const now = new Date().toISOString();
  return {
    kind: 'meta_webinar_ads',
    version: 1,
    argsFingerprint,
    createdAt: now,
    updatedAt: now,
    status: 'in_progress',
    queries: config.phrases.map((phrase) => ({ phrase, status: 'error', nextPage: 1, seenAdIds: [] })),
    rawAds: [],
  };
}

function outputAdColumns(): string[] {
  return [
    'platform', 'ad_id', 'advertiser_name', 'advertiser_url', 'payer_name', 'primary_text', 'headline',
    'landing_url', 'active_from', 'active_to', 'status', 'phrases', 'person_name', 'person_evidence',
    'live_signals', 'exclusion_reasons', 'disposition', 'dedupe_key', 'advertiser_key', 'search_url',
    'collected_at', 'extraction_confidence', 'ad_library_url',
  ];
}

async function main(): Promise<void> {
  const options = parseArgs();
  const config = resolveConfig(options);
  const runDir = ensureRunDir(
    options.runDir
      ? resolve(process.env.INIT_CWD ?? process.cwd(), options.runDir)
      : resolve(process.cwd(), `output/runs/${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}`),
  );
  const argsFingerprint = fingerprint({ config, fixtures: options.fixtures });
  let checkpoint = loadCheckpoint(runDir);
  if (checkpoint && !options.resume) throw new Error(`Run directory already has a checkpoint; pass --resume: ${runDir}`);
  if (checkpoint && checkpoint.argsFingerprint !== argsFingerprint) throw new Error('Checkpoint arguments do not match this run. Start a new run.');
  checkpoint ??= newCheckpoint(argsFingerprint, config);

  writeJson(join(runDir, 'run_manifest.json'), {
    kind: checkpoint.kind,
    created_at: checkpoint.createdAt,
    config,
    fixtures: options.fixtures,
    source: 'Meta Ad Library public browser surface',
  });
  saveCheckpoint(runDir, checkpoint);

  let interrupted = false;
  const onSignal = () => { interrupted = true; };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  try {
    for (const query of checkpoint.queries) {
      if (interrupted || (query.status === 'completed' && !options.retryErrors)) continue;
      const result = await collectPhrase(query.phrase, config, {
        headless: options.headless,
        outputDir: runDir,
        startPage: query.nextPage,
        fixtures: options.fixtures,
      });
      for (const ad of result.ads) {
        const key = ad.adId ?? `${ad.advertiserName}|${ad.primaryText}|${ad.landingUrl}`;
        if (query.seenAdIds.includes(key)) continue;
        query.seenAdIds.push(key);
        checkpoint.rawAds.push(ad);
        appendJsonl(rawAdsPath(runDir), ad);
      }
      query.nextPage = result.nextPage;
      query.status = result.state === 'blocked' ? 'blocked' : result.error ? 'error' : 'completed';
      query.error = result.error;
      saveCheckpoint(runDir, checkpoint);
      console.log(JSON.stringify({ phrase: query.phrase, status: query.status, ads: result.ads.length, run_dir: runDir }));
    }
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }

  const normalized = normalizeAndFilter(checkpoint.rawAds, config);
  const rows = normalized.map(toAdCsvRow);
  writeCsv(join(runDir, 'ads_normalized.csv'), rows, outputAdColumns());
  writeCsv(join(runDir, 'ads_filtered.csv'), rows.filter((row) => row.disposition === 'qualified'), outputAdColumns());
  writeCsv(join(runDir, 'ads_excluded.csv'), rows.filter((row) => row.disposition === 'excluded'), outputAdColumns());
  const advertisers = buildAdvertiserRows(normalized);
  writeCsv(join(runDir, 'advertisers.csv'), advertisers, Object.keys(advertisers[0] ?? {
    advertiser_key: '', advertiser_name: '', advertiser_url: '', landing_domain: '', person_name: '',
    person_evidence: '', representative_ad_id: '', representative_copy: '', representative_headline: '',
    representative_landing_url: '', active_from: '', phrases: '', qualifying_ad_count: '',
  }));
  checkpoint.status = interrupted ? 'in_progress' : 'completed';
  saveCheckpoint(runDir, checkpoint);
  writeJson(join(runDir, 'summary.json'), {
    raw_ads: checkpoint.rawAds.length,
    normalized_ads: normalized.length,
    qualifying_ads: normalized.filter((ad) => ad.disposition === 'qualified').length,
    excluded_ads: normalized.filter((ad) => ad.disposition === 'excluded').length,
    advertisers: advertisers.length,
    query_statuses: checkpoint.queries.map(({ phrase, status, error }) => ({ phrase, status, error: error ?? null })),
  });
  if (interrupted) process.exitCode = 130;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
