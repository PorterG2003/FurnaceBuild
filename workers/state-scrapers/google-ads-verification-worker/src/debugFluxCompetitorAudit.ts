import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { placesSearchText } from '@furnace/google-places';
import { normalizeGoogleAdsSearchDomain } from '@furnace/registry-server';
import fluxCompetitorAuditRank from '../../../../lib/flux/fluxCompetitorAuditRank';
import type { FluxCompetitorScoredDomain } from '../../../../lib/flux/fluxCompetitorAuditRank';
import type { FluxAuditDomainResultRow } from '../../../../lib/flux/fluxCompetitorAuditFailureMessage';
import { runGoogleAdsTransparencyAuditSamples } from './transparencyLookup.js';
import { buildPublishedCompetitorExamples } from './fluxCompetitorAuditPublish.js';
import { workerJsonLog } from './workerJsonLog.js';

const REGION = 'US';
const PLACES_RADIUS_M = 20_000;
const MAX_TRANSPARENCY = 12;
const MIN_PLACES_SCANNED_BEFORE_EARLY_EXIT = 6;
const TARGET_OK_DOMAINS_FOR_EARLY_EXIT = 3;
const DOMAIN_TIMEOUT_MS = 300_000;
const MAX_PUBLISHED_WINNERS = 3;
const MAX_PUBLISHED_SAMPLES_PER_WINNER = 2;
const UNKNOWN_DISTANCE_METERS = 9_999_999_999;

type GooglePlaceRow = {
  displayName?: { text?: string };
  location?: { latitude?: number; longitude?: number };
  websiteUri?: string;
};

type Candidate = {
  domain: string;
  name: string;
  lat: number | null;
  lng: number | null;
  placeIndex: number;
  source: 'manual' | 'places';
};

type ParsedArgs = {
  domains: string[];
  excludeDomains: string[];
  lat: number | null;
  lng: number | null;
  query: string;
  headless: boolean;
  region: string;
  slowMoMs: number;
  timeoutMs: number;
  domainTimeoutMs: number;
  maxSamples: number;
  maxCandidates: number;
  skipStaticMaps: boolean;
  outputDir: string;
  googlePlacesApiKey: string;
  correlationId: string;
};

type ArtifactExample = {
  headline: string;
  body: string;
  sourceUrl: string;
  imagePath?: string;
};

type ArtifactCompetitor = {
  domain: string;
  name: string;
  mapImagePath?: string;
  adsSummary: string;
  examples: ArtifactExample[];
};

function readFlag(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  return process.argv[index + 1] ?? null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function parseCsvFlag(name: string): string[] {
  const raw = readFlag(name) ?? '';
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function parseNumberFlag(name: string): number | null {
  const raw = readFlag(name);
  if (!raw?.trim()) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function timestampTag(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function normalizeDomainList(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = normalizeGoogleAdsSearchDomain(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function sanitizeFilePart(value: string): string {
  return value.replace(/[^a-z0-9.-]+/gi, '_').replace(/^_+|_+$/g, '') || 'item';
}

function hostFromUrl(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  try {
    const u = new URL(raw.trim().startsWith('http') ? raw.trim() : `https://${raw.trim()}`);
    return u.hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

function hostFromWebsiteUri(uri: string | null | undefined): string | null {
  if (!uri?.trim()) return null;
  return hostFromUrl(uri);
}

function etldPlusOne(host: string): string {
  const parts = host.split('.').filter(Boolean);
  if (parts.length >= 2) return `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
  return host;
}

function parsePlacesSearchBody(json: unknown): GooglePlaceRow[] {
  if (!json || typeof json !== 'object') return [];
  const places = (json as { places?: unknown }).places;
  if (!Array.isArray(places)) return [];
  return places as GooglePlaceRow[];
}

async function withAbortTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  const controller = new AbortController();
  const timeoutMessage = `${label}_timeout`;
  const timer = setTimeout(() => controller.abort(timeoutMessage), ms);
  try {
    return await run(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(timeoutMessage);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function adsSummaryFromAudit(creativeCount: number, latest: string | null): string {
  const datePart = latest && latest.trim() ? latest.trim() : 'unknown';
  return `~${creativeCount} ads in Google’s Transparency Center; most recent creative shown ${datePart}.`;
}

function buildAuditFailureMessage(rows: FluxAuditDomainResultRow[]): string {
  const countByOutcome = (outcome: FluxAuditDomainResultRow['outcome']) => rows.filter((row) => row.outcome === outcome).length;
  const timeouts = countByOutcome('timeout');
  const playwrightErrors = countByOutcome('playwright_error');
  const noMatch = countByOutcome('transparency_no_match');
  const zeroCreatives = countByOutcome('transparency_zero_creatives');
  const lines: string[] = [
    'No competitor qualified for a published card (each needs a Transparency Center match with at least one visible creative).',
  ];
  if (timeouts > 0) lines.push(`${timeouts} timed out.`);
  if (playwrightErrors > 0) lines.push(`${playwrightErrors} failed while loading Transparency Center.`);
  if (noMatch + zeroCreatives > 0) {
    lines.push(`${noMatch + zeroCreatives} had no Transparency match or no creatives listed.`);
  }
  lines.push('', 'Per domain:', '');
  for (const row of rows) {
    const parts: string[] = [row.domain, row.outcome];
    if (row.outcome === 'ok') parts.push(`${row.creative_count ?? 0} creatives`);
    if (row.message?.trim()) parts.push(row.message.trim());
    const selectedRank = (row as FluxAuditDomainResultRow & { selected_rank?: number }).selected_rank;
    if (typeof selectedRank === 'number') parts.push(`shown as competitor #${selectedRank}`);
    lines.push(parts.join(' · '));
  }
  return lines.join('\n');
}

function staticMapUrl(lat: number, lng: number, apiKey: string): string {
  const q = new URLSearchParams({
    center: `${lat},${lng}`,
    zoom: '14',
    size: '400x400',
    scale: '2',
    maptype: 'roadmap',
    markers: `color:red|${lat},${lng}`,
    key: apiKey,
  });
  return `https://maps.googleapis.com/maps/api/staticmap?${q.toString()}`;
}

async function ensureDir(path: string): Promise<string> {
  const resolved = resolve(path);
  await mkdir(resolved, { recursive: true });
  return resolved;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function maybeWriteBuffer(path: string, buf: Buffer | Uint8Array | null | undefined): Promise<string | undefined> {
  if (!buf || buf.length < 1) return undefined;
  await writeFile(path, buf);
  return path;
}

async function buildPlacesCandidates(args: ParsedArgs): Promise<Candidate[]> {
  if (!Number.isFinite(args.lat) || !Number.isFinite(args.lng)) return [];
  const apiKey = args.googlePlacesApiKey.trim();
  if (!apiKey) {
    throw new Error('Google Places API key is required for Places-based discovery.');
  }
  const placesRes = await placesSearchText(apiKey, {
    textQuery: args.query,
    languageCode: 'en-US',
    maxResultCount: 20,
    locationBias: {
      latitude: args.lat,
      longitude: args.lng,
      radiusMeters: PLACES_RADIUS_M,
    },
  });
  if (!placesRes.ok) {
    throw new Error(placesRes.message || 'Places search failed');
  }
  const placeList = parsePlacesSearchBody(placesRes.json);
  const excluded = new Set(normalizeDomainList(args.excludeDomains));
  const seenEtld = new Set<string>();
  const out: Candidate[] = [];
  let idx = 0;
  for (const place of placeList) {
    const domain = normalizeGoogleAdsSearchDomain(hostFromWebsiteUri(place.websiteUri) ?? '');
    if (!domain || excluded.has(domain)) {
      idx += 1;
      continue;
    }
    const dedupeKey = etldPlusOne(domain);
    if (seenEtld.has(dedupeKey)) {
      idx += 1;
      continue;
    }
    const lat = typeof place.location?.latitude === 'number' ? place.location.latitude : Number(place.location?.latitude);
    const lng =
      typeof place.location?.longitude === 'number' ? place.location.longitude : Number(place.location?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      idx += 1;
      continue;
    }
    seenEtld.add(dedupeKey);
    out.push({
      domain,
      name: place.displayName?.text?.trim() || domain,
      lat,
      lng,
      placeIndex: idx,
      source: 'places',
    });
    idx += 1;
    if (out.length >= args.maxCandidates) break;
  }
  return out;
}

function buildManualCandidates(args: ParsedArgs): Candidate[] {
  const excluded = new Set(normalizeDomainList(args.excludeDomains));
  return normalizeDomainList(args.domains)
    .filter((domain) => !excluded.has(domain))
    .slice(0, args.maxCandidates)
    .map((domain, index) => ({
      domain,
      name: domain,
      lat: null,
      lng: null,
      placeIndex: index,
      source: 'manual',
    }));
}

function mergeCandidates(...groups: Candidate[][]): Candidate[] {
  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const candidate of group) {
      if (seen.has(candidate.domain)) continue;
      seen.add(candidate.domain);
      out.push({ ...candidate, placeIndex: out.length });
    }
  }
  return out;
}

function parseArgs(): ParsedArgs {
  const domains = parseCsvFlag('--domains');
  const lat = parseNumberFlag('--lat');
  const lng = parseNumberFlag('--lng');
  const query = (readFlag('--places-query') ?? readFlag('--industry') ?? 'local services').trim();
  const outputDir =
    readFlag('--output-dir')?.trim() || resolve(process.cwd(), 'tmp', 'google-ads-audit', timestampTag());
  const timeoutMs = Math.max(5_000, Number(readFlag('--timeout-ms') ?? 50_000));
  const domainTimeoutMs = Math.max(timeoutMs, Number(readFlag('--domain-timeout-ms') ?? DOMAIN_TIMEOUT_MS));
  const maxSamples = Math.min(3, Math.max(1, Number(readFlag('--max-samples') ?? MAX_PUBLISHED_SAMPLES_PER_WINNER)));
  const maxCandidates = Math.max(1, Math.min(50, Number(readFlag('--max-candidates') ?? MAX_TRANSPARENCY)));
  return {
    domains,
    excludeDomains: parseCsvFlag('--exclude-domains'),
    lat,
    lng,
    query: query || 'local services',
    headless: hasFlag('--headless'),
    region: (readFlag('--region') ?? REGION).trim() || REGION,
    slowMoMs: Math.max(0, Number(readFlag('--slow-mo-ms') ?? 0)),
    timeoutMs,
    domainTimeoutMs,
    maxSamples,
    maxCandidates,
    skipStaticMaps: hasFlag('--skip-static-maps'),
    outputDir,
    googlePlacesApiKey: readFlag('--google-places-api-key')?.trim() || process.env.GOOGLE_PLACES_API_KEY?.trim() || '',
    correlationId: readFlag('--correlation-id')?.trim() || `local_${timestampTag()}`,
  };
}

function usage(): string {
  return [
    'Usage:',
    '  npm run debug:competitor-audit -- --domains right-tempair.com,dashhvac.com [--output-dir tmp/google-ads-audit/run-1]',
    '  npm run debug:competitor-audit -- --lat 37.1 --lng -113.5 --industry hvac [--google-places-api-key <key>]',
    '',
    'Flags:',
    '  --domains <csv>',
    '  --lat <number> --lng <number>',
    '  --industry <text> | --places-query <text>',
    '  --exclude-domains <csv>',
    '  --google-places-api-key <key>',
    '  --region <code>',
    '  --headless',
    '  --slow-mo-ms <number>',
    '  --timeout-ms <number>',
    '  --domain-timeout-ms <number>',
    '  --max-samples <number>',
    '  --max-candidates <number>',
    '  --output-dir <path>',
    '  --skip-static-maps',
    '  --correlation-id <id>',
  ].join('\n');
}

async function main(): Promise<void> {
  const args = parseArgs();
  if (hasFlag('--help')) {
    console.log(usage());
    return;
  }
  if (args.domains.length < 1 && (!Number.isFinite(args.lat) || !Number.isFinite(args.lng))) {
    throw new Error(`${usage()}\n\nProvide either --domains or --lat/--lng for Places-based discovery.`);
  }

  const startedAt = new Date().toISOString();
  const outputDir = await ensureDir(args.outputDir);
  const creativeDir = await ensureDir(resolve(outputDir, 'creatives'));
  const mapsDir = await ensureDir(resolve(outputDir, 'maps'));

  workerJsonLog('local_competitor_audit_start', {
    correlationId: args.correlationId,
    outputDir,
    directDomainCount: args.domains.length,
    hasPlacesDiscovery: Number.isFinite(args.lat) && Number.isFinite(args.lng),
    headless: args.headless,
    region: args.region,
    timeoutMs: args.timeoutMs,
    domainTimeoutMs: args.domainTimeoutMs,
    maxSamples: args.maxSamples,
    maxCandidates: args.maxCandidates,
  });

  const manualCandidates = buildManualCandidates(args);
  const placesCandidates = await buildPlacesCandidates(args);
  const candidates = mergeCandidates(manualCandidates, placesCandidates).slice(0, args.maxCandidates);
  if (candidates.length < 1) {
    throw new Error('No candidate domains available after normalization, exclusion, and Places filtering.');
  }

  const auditRows: FluxAuditDomainResultRow[] = [];
  const scored: FluxCompetitorScoredDomain[] = [];
  const auditByDomain = new Map<string, Awaited<ReturnType<typeof runGoogleAdsTransparencyAuditSamples>>>();
  let attemptedPlacesCount = 0;
  let okDomainCount = 0;
  let placesStopReason: 'min_reached_and_enough_ok' | 'max_reached' | 'exhausted_candidates' | null = null;

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index]!;
    const row: FluxAuditDomainResultRow = {
      domain: candidate.domain,
      outcome: 'ok',
      creative_count: null,
      message: undefined,
    };
    const domainWallStart = Date.now();
    try {
      const audit = await withAbortTimeout(
        (signal) =>
          runGoogleAdsTransparencyAuditSamples({
            domain: candidate.domain,
            headless: args.headless,
            region: args.region,
            timeoutMs: args.timeoutMs,
            maxSamples: args.maxSamples,
            jobId: args.correlationId,
            slowMoMs: args.slowMoMs,
            signal,
          }),
        args.domainTimeoutMs,
        `transparency_${candidate.domain}`,
      );
      if (audit.outcome === 'transparency_no_match') {
        row.outcome = 'transparency_no_match';
        row.message = 'No Transparency match';
      } else if (audit.outcome === 'transparency_zero_creatives') {
        row.outcome = 'transparency_zero_creatives';
        row.message = 'Zero creatives';
      } else if (audit.outcome === 'playwright_error') {
        row.outcome = 'playwright_error';
        row.message = audit.message ?? 'playwright_error';
      } else if (audit.outcome === 'ok' && audit.creativeCount > 0) {
        row.outcome = 'ok';
        row.creative_count = audit.creativeCount;
        auditByDomain.set(candidate.domain, audit);
        okDomainCount += 1;
        const hasDistanceInputs =
          Number.isFinite(args.lat) &&
          Number.isFinite(args.lng) &&
          Number.isFinite(candidate.lat) &&
          Number.isFinite(candidate.lng);
        scored.push({
          domain: candidate.domain,
          placeIndex: candidate.placeIndex,
          creativeCount: audit.creativeCount,
          latestAdLastShownAt: audit.latestAdLastShownAt,
          distanceMeters: hasDistanceInputs
            ? fluxCompetitorAuditRank.haversineDistanceMeters(
                args.lat as number,
                args.lng as number,
                candidate.lat as number,
                candidate.lng as number,
              )
            : UNKNOWN_DISTANCE_METERS,
          longestAdRunDays: audit.longestAdRunDays ?? null,
        });
      } else {
        row.outcome = 'transparency_zero_creatives';
        row.message = 'No creative hrefs';
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.endsWith('_timeout')) {
        row.outcome = 'timeout';
        row.message = message;
      } else {
        row.outcome = 'playwright_error';
        row.message = message.slice(0, 200);
      }
    }
    attemptedPlacesCount += 1;
    workerJsonLog('transparency_domain_audit_wall_ms', {
      correlationId: args.correlationId,
      domain: candidate.domain,
      wallMs: Date.now() - domainWallStart,
      outcome: row.outcome,
      creativeCount: row.creative_count ?? null,
      message: row.message?.slice(0, 200) ?? null,
      attemptedPlacesCount,
      okDomainCount,
      candidateSource: candidate.source,
    });
    auditRows.push(row);

    if (
      attemptedPlacesCount >= MIN_PLACES_SCANNED_BEFORE_EARLY_EXIT &&
      okDomainCount >= TARGET_OK_DOMAINS_FOR_EARLY_EXIT &&
      index + 1 < candidates.length
    ) {
      placesStopReason = 'min_reached_and_enough_ok';
      break;
    }
  }

  if (!placesStopReason) {
    placesStopReason =
      candidates.length >= args.maxCandidates && attemptedPlacesCount >= candidates.length
        ? 'max_reached'
        : 'exhausted_candidates';
  }

  const ranked = fluxCompetitorAuditRank.rankFluxCompetitorDomains(scored);
  const winners = ranked.slice(0, MAX_PUBLISHED_WINNERS);
  const competitorRows: ArtifactCompetitor[] = [];

  for (let winnerIndex = 0; winnerIndex < winners.length; winnerIndex += 1) {
    const winner = winners[winnerIndex]!;
    const candidate = candidates.find((item) => item.domain === winner.domain);
    const audit = auditByDomain.get(winner.domain);
    if (!candidate || !audit || audit.outcome !== 'ok') continue;
    let mapImagePath: string | undefined;
    if (
      !args.skipStaticMaps &&
      args.googlePlacesApiKey &&
      Number.isFinite(candidate.lat) &&
      Number.isFinite(candidate.lng)
    ) {
      const mapPath = resolve(mapsDir, `map-${winnerIndex}-${sanitizeFilePart(winner.domain)}.png`);
      const mapResponse = await fetch(staticMapUrl(candidate.lat as number, candidate.lng as number, args.googlePlacesApiKey));
      if (mapResponse.ok) {
        const mapBytes = Buffer.from(await mapResponse.arrayBuffer());
        mapImagePath = await maybeWriteBuffer(mapPath, mapBytes);
      } else {
        workerJsonLog('static_map_fetch_failed', {
          correlationId: args.correlationId,
          domain: winner.domain,
          winnerIndex,
          httpStatus: mapResponse.status,
          httpStatusText: mapResponse.statusText,
        });
      }
    }
    const examples: ArtifactExample[] = [];
    const published = buildPublishedCompetitorExamples({
      domain: winner.domain,
      samples: audit.samples,
      maxExamples: args.maxSamples,
      selectedAdvertiserId: audit.selectedAdvertiserId,
    });
    for (let sampleIndex = 0; sampleIndex < published.examples.length; sampleIndex += 1) {
      const sample = published.examples[sampleIndex]!;
      const creativePath = await maybeWriteBuffer(
        resolve(creativeDir, `creative-${winnerIndex}-${sampleIndex}-${sanitizeFilePart(winner.domain)}.png`),
        sample.previewPng,
      );
      workerJsonLog('creative_preview_publish_result', {
        correlationId: args.correlationId,
        domain: winner.domain,
        winnerIndex,
        sampleIndex,
        sourceUrl: sample.sourceUrl.slice(0, 200),
        hadPreviewField: sample.previewPng != null,
        previewByteLength: sample.previewPng?.length ?? 0,
        finalHasImagePath: Boolean(creativePath),
      });
      examples.push({
        headline: sample.headline,
        body: sample.body,
        sourceUrl: sample.sourceUrl,
        ...(creativePath ? { imagePath: creativePath } : {}),
      });
    }
    competitorRows.push({
      domain: winner.domain,
      name: candidate.name,
      ...(mapImagePath ? { mapImagePath } : {}),
      adsSummary: adsSummaryFromAudit(audit.creativeCount, audit.latestAdLastShownAt).slice(0, 320),
      examples,
    });
    for (const row of auditRows) {
      if (row.domain === winner.domain && row.outcome === 'ok') {
        const selectedRow = row as FluxAuditDomainResultRow & {
          selected_rank?: number;
          selected_advertiser_id?: string | null;
        };
        selectedRow.selected_rank = winnerIndex + 1;
        selectedRow.selected_advertiser_id = published.selectedAdvertiserId;
      }
    }
  }

  const outcomeCounts: Record<string, number> = {};
  for (const row of auditRows) {
    const key = row.outcome ?? 'unknown';
    outcomeCounts[key] = (outcomeCounts[key] ?? 0) + 1;
  }
  const failureMessage = winners.length < 1 ? buildAuditFailureMessage(auditRows) : null;
  const result = {
    runner: 'debug_flux_competitor_audit',
    correlationId: args.correlationId,
    startedAt,
    finishedAt: new Date().toISOString(),
    outputDir,
    inputs: {
      domains: normalizeDomainList(args.domains),
      excludeDomains: normalizeDomainList(args.excludeDomains),
      lat: args.lat,
      lng: args.lng,
      query: args.query,
      region: args.region,
      headless: args.headless,
      slowMoMs: args.slowMoMs,
      timeoutMs: args.timeoutMs,
      domainTimeoutMs: args.domainTimeoutMs,
      maxSamples: args.maxSamples,
      maxCandidates: args.maxCandidates,
      skipStaticMaps: args.skipStaticMaps,
    },
    candidates,
    attemptedPlacesCount,
    okDomainCount,
    placesStopReason,
    transparencyScoredOkCount: scored.length,
    publishedWinnerCount: competitorRows.length,
    winnerDomains: competitorRows.map((row) => row.domain),
    auditOutcomeCounts: outcomeCounts,
    auditRows,
    ranked,
    competitors: competitorRows,
    failureMessage,
  };
  const resultPath = resolve(outputDir, 'audit-result.json');
  await writeJson(resultPath, result);
  workerJsonLog('local_competitor_audit_finished', {
    correlationId: args.correlationId,
    ok: competitorRows.length > 0,
    resultPath,
    attemptedPlacesCount,
    okDomainCount,
    winnerDomains: competitorRows.map((row) => row.domain),
    auditOutcomeCounts: outcomeCounts,
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
