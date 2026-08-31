import { join } from 'node:path';
import { MANUAL_VERIFICATIONS } from '../../thinkingmaps-avoid-domains/src/verifiedDomains.js';
import { requireLiveForPaid, truncateRows } from './lib/cli.js';
import { readCsv, rowToRecord, writeCsv } from './lib/csv.js';
import { loadJson, writeJson } from './lib/io.js';
import { sleepWithJitter } from './lib/retry.js';
import { serperSearch, type SerperResponse } from './lib/serperClient.js';
import { hostnameOf, sameRegistrableHost, toWebsite } from './lib/url.js';
import { canonicalDistrictName, jaccard, tokenize } from './names.js';
import { padLeaid } from './schoolNames.js';
import { applyWebsiteOverrides, isNonDistrictHomepage, overrideForLeaid } from './websiteOverrides.js';
import type { DistrictDomain } from './seedDistrictDomains.js';
import type { ListedSchool } from './types.js';

export type SiteConfidence = 'high' | 'medium' | 'low' | 'none';

export type DistrictSite = {
  leaid: string;
  lea_name: string;
  state: string;
  website: string;
  host: string;
  confidence: SiteConfidence;
  score: number;
  evidence: string;
  source: string;
  email_domain: string;
  needs_review: boolean;
  review_reason: string;
};

export type DistrictSiteInput = {
  leaid: string;
  lea_name: string;
  state: string;
  email_domain: string;
};

export type SiteCandidate = {
  url: string;
  title: string;
  snippet: string;
  position: number;
  source: string;
};

export const DISTRICT_SITE_COLUMNS = [
  'leaid',
  'lea_name',
  'state',
  'website',
  'host',
  'confidence',
  'score',
  'evidence',
  'source',
  'email_domain',
  'needs_review',
  'review_reason',
] as const;

const JUNK_HOST =
  /facebook|instagram|twitter|linkedin|youtube|wikipedia|niche\.com|greatschools|publicschoolreview|ballotpedia|schooldigger|yellowpages|indeed\.com|usnews\.com|reddit\.com|pinterest|cde\.ca\.gov|nces\.ed\.gov|ed\.gov|caschooldashboard/i;

const HOST_STOP = new Set([
  'www',
  'org',
  'com',
  'net',
  'edu',
  'gov',
  'k12',
  'us',
  'school',
  'schools',
  'district',
  'unified',
  'independent',
  'public',
  'county',
  'city',
  'the',
  'of',
  'and',
  'sd',
  'usd',
  'isd',
  'esd',
  'www2',
]);

const NAME_STOP = new Set([
  'school',
  'schools',
  'district',
  'unified',
  'independent',
  'public',
  'county',
  'city',
  'the',
  'of',
  'and',
  'sd',
  'usd',
  'isd',
  'esd',
  'no',
  're',
]);

export function serperQueryForDistrict(row: DistrictSiteInput): string {
  const state = row.state.trim();
  return `"${row.lea_name}" ${state} school district official site`.replace(/\s+/g, ' ').trim();
}

export function hostTokenSet(host: string): Set<string> {
  const stripped = hostnameOf(host)
    .replace(/\.k12\.[a-z]{2}\.us$/i, '')
    .replace(/\.(org|edu|net|com|us|gov)$/i, '');
  const stem = stripped.replace(/(schools|school|district|unified|public|isd|usd)$/i, '');
  return new Set(
    [...stripped.split(/[.-]/), stem]
      .map((part) => part.toLowerCase())
      .filter((part) => part.length > 2 && !HOST_STOP.has(part)),
  );
}

export function districtTokenSet(name: string, state?: string): Set<string> {
  const canon = canonicalDistrictName(name, state);
  return new Set(tokenize(canon).filter((part) => part.length > 2 && !NAME_STOP.has(part)));
}

export function isJunkHost(host: string): boolean {
  if (JUNK_HOST.test(host)) return true;
  return isNonDistrictHomepage(host);
}

export function preferredTld(host: string): boolean {
  return /\.org$|\.edu$|\.k12\.[a-z]{2}\.us$/i.test(host);
}

export function scoreWebsiteCandidate(
  candidate: SiteCandidate,
  district: DistrictSiteInput,
): { score: number; evidence: string } {
  const host = hostnameOf(candidate.url);
  if (!host || isJunkHost(host) || isNonDistrictHomepage(host, district.email_domain)) {
    return { score: 0, evidence: 'junk_host' };
  }
  const nameTokens = districtTokenSet(district.lea_name, district.state);
  const overlap = jaccard(hostTokenSet(host), nameTokens);
  let score = overlap;
  const bits: string[] = [`overlap:${overlap.toFixed(2)}`];
  const contained = [...nameTokens].find((token) => token.length >= 4 && host.includes(token));
  if (contained) {
    score += 0.35;
    bits.push(`host_contains:${contained}`);
  }
  if (preferredTld(host)) {
    score += 0.12;
    bits.push('preferred_tld');
  }
  if (district.email_domain && sameRegistrableHost(host, district.email_domain)) {
    score += 0.2;
    bits.push('email_domain_match');
  }
  const hay = `${candidate.title} ${candidate.snippet}`.toLowerCase();
  if (/official|school district|public schools/.test(hay)) {
    score += 0.05;
    bits.push('official_copy');
  }
  if (candidate.source === 'verified') {
    score = Math.max(score, 0.9);
    bits.push('verified');
  }
  return { score: Math.min(1, score), evidence: bits.join('|') };
}

export function confidenceFromScore(score: number, source: string): SiteConfidence {
  if (source === 'verified' || score >= 0.55) return 'high';
  if (score >= 0.4) return 'medium';
  if (score > 0) return 'low';
  return 'none';
}

function candidatesFromSerper(json: SerperResponse): SiteCandidate[] {
  const out: SiteCandidate[] = [];
  if (json.knowledgeGraph?.website) {
    out.push({
      url: json.knowledgeGraph.website,
      title: json.knowledgeGraph.title ?? '',
      snippet: json.knowledgeGraph.description ?? '',
      position: 0,
      source: 'knowledge_graph',
    });
  }
  for (const org of json.organic ?? []) {
    if (!org.link) continue;
    out.push({
      url: org.link,
      title: org.title ?? '',
      snippet: org.snippet ?? '',
      position: org.position ?? 99,
      source: 'organic',
    });
  }
  return out;
}

export function verifiedSeeds(): Array<{ lookupName: string; website: string; host: string }> {
  const out: Array<{ lookupName: string; website: string; host: string }> = [];
  for (const row of MANUAL_VERIFICATIONS) {
    for (const domain of row.domains) {
      const evidenceHost = hostnameOf(domain.evidenceUrl);
      const domainHost = hostnameOf(domain.domain);
      const host = evidenceHost && !isJunkHost(evidenceHost) ? evidenceHost : domainHost;
      if (!host || isJunkHost(host)) continue;
      const website = toWebsite(host);
      out.push({ lookupName: row.lookupName, website, host });
    }
  }
  return out;
}

function bestVerified(district: DistrictSiteInput): SiteCandidate | null {
  const tokens = districtTokenSet(district.lea_name, district.state);
  let best: { candidate: SiteCandidate; score: number } | null = null;
  for (const seed of verifiedSeeds()) {
    const overlap = jaccard(tokens, districtTokenSet(seed.lookupName, district.state));
    if (overlap < 0.7 && canonicalDistrictName(seed.lookupName, district.state) !== canonicalDistrictName(district.lea_name, district.state)) {
      continue;
    }
    const candidate: SiteCandidate = {
      url: seed.website,
      title: seed.lookupName,
      snippet: 'verifiedDomains evidence URL',
      position: 0,
      source: 'verified',
    };
    if (!best || overlap > best.score) best = { candidate, score: overlap };
  }
  return best?.candidate ?? null;
}

export function pickDistrictWebsite(
  district: DistrictSiteInput,
  candidates: SiteCandidate[],
): DistrictSite {
  const override = overrideForLeaid(district.leaid);
  if (override) {
    const website = toWebsite(override.website);
    const host = hostnameOf(website);
    return {
      leaid: district.leaid,
      lea_name: district.lea_name,
      state: district.state,
      website,
      host,
      confidence: 'high',
      score: 1,
      evidence: `override:${override.reason}`,
      source: 'override',
      email_domain: district.email_domain,
      needs_review: false,
      review_reason: '',
    };
  }
  const withEmail =
    district.email_domain && !isNonDistrictHomepage(district.email_domain, district.email_domain)
      ? [
          ...candidates,
          {
            url: toWebsite(district.email_domain),
            title: district.lea_name,
            snippet: 'furnace email domain fallback',
            position: 50,
            source: 'furnace_email',
          } satisfies SiteCandidate,
        ]
      : candidates;
  const scored = withEmail
    .map((candidate) => {
      const website = toWebsite(candidate.url);
      const host = hostnameOf(website);
      const { score, evidence } = scoreWebsiteCandidate({ ...candidate, url: website }, district);
      return { candidate: { ...candidate, url: website }, host, score, evidence };
    })
    .filter((row) => row.host && row.score > 0)
    .sort((a, b) => b.score - a.score || a.candidate.position - b.candidate.position);

  const best = scored[0];
  if (!best) {
    return {
      leaid: district.leaid,
      lea_name: district.lea_name,
      state: district.state,
      website: '',
      host: '',
      confidence: 'none',
      score: 0,
      evidence: '',
      source: '',
      email_domain: district.email_domain,
      needs_review: true,
      review_reason: 'no_candidate',
    };
  }
  const confidence = confidenceFromScore(best.score, best.candidate.source);
  const needsReview = confidence === 'low' || confidence === 'none';
  return {
    leaid: district.leaid,
    lea_name: district.lea_name,
    state: district.state,
    website: best.candidate.url,
    host: best.host,
    confidence,
    score: Number(best.score.toFixed(4)),
    evidence: best.evidence,
    source: best.candidate.source,
    email_domain: district.email_domain,
    needs_review: needsReview,
    review_reason: needsReview ? 'low_confidence' : '',
  };
}

export function districtsFromSchools(
  schools: ListedSchool[],
  domains: DistrictDomain[] = [],
): DistrictSiteInput[] {
  const emailByLeaid = new Map(domains.map((row) => [padLeaid(row.leaid), row.domain]));
  const seen = new Map<string, DistrictSiteInput>();
  for (const school of schools) {
    const leaid = padLeaid(school.leaid);
    if (seen.has(leaid)) continue;
    seen.set(leaid, {
      leaid,
      lea_name: school.lea_name,
      state: school.state,
      email_domain: emailByLeaid.get(leaid) ?? '',
    });
  }
  return [...seen.values()].sort((a, b) => a.lea_name.localeCompare(b.lea_name));
}

export function loadDistrictSitesCsv(path: string): DistrictSite[] {
  const sites = readCsv(path).map((row) => ({
    leaid: padLeaid(row.leaid),
    lea_name: row.lea_name ?? '',
    state: row.state ?? '',
    website: row.website ?? '',
    host: row.host || hostnameOf(row.website ?? ''),
    confidence: (row.confidence as SiteConfidence) || 'none',
    score: Number(row.score) || 0,
    evidence: row.evidence ?? '',
    source: row.source ?? '',
    email_domain: row.email_domain ?? '',
    needs_review: row.needs_review === 'true' || row.needs_review === '1',
    review_reason: row.review_reason ?? '',
  }));
  return applyWebsiteOverrides(sites);
}

export function writeDistrictSites(runDir: string, sites: DistrictSite[]): void {
  const rows = applyWebsiteOverrides(sites);
  writeCsv(
    join(runDir, 'district_sites.csv'),
    rows.map((row) => rowToRecord(row)),
    DISTRICT_SITE_COLUMNS,
  );
  const review = rows.filter((row) => row.needs_review || row.confidence === 'none' || !row.website);
  writeCsv(
    join(runDir, 'district_site_review.csv'),
    review.map((row) => rowToRecord(row)),
    DISTRICT_SITE_COLUMNS,
  );
  writeJson(join(runDir, 'district_sites_summary.json'), {
    districts: rows.length,
    with_website: rows.filter((row) => row.website).length,
    high: rows.filter((row) => row.confidence === 'high').length,
    medium: rows.filter((row) => row.confidence === 'medium').length,
    low: rows.filter((row) => row.confidence === 'low').length,
    none: rows.filter((row) => row.confidence === 'none').length,
    review: review.length,
    sources: Object.fromEntries(
      [...new Set(rows.map((row) => row.source || 'none'))].map((source) => [
        source,
        rows.filter((row) => (row.source || 'none') === source).length,
      ]),
    ),
  });
}

export function sitesFromEmailDomains(districts: DistrictSiteInput[]): DistrictSite[] {
  return districts.map((district) => {
    const extra: SiteCandidate[] = [];
    const verified = bestVerified(district);
    if (verified) extra.push(verified);
    if (district.email_domain) {
      extra.push({
        url: toWebsite(district.email_domain),
        title: district.lea_name,
        snippet: 'furnace email domain',
        position: 1,
        source: 'furnace_email',
      });
    }
    return pickDistrictWebsite(district, extra);
  });
}

type SiteCheckpoint = {
  version: 1;
  status: 'in_progress' | 'completed';
  next_index: number;
  serper_calls: number;
  results: Record<string, DistrictSite>;
};

export async function resolveDistrictSites(options: {
  runDir: string;
  schools: ListedSchool[];
  domains?: DistrictDomain[];
  dryRun?: boolean;
  live?: boolean;
  fixtures?: boolean;
  maxRows?: number | null;
}): Promise<{ sites: DistrictSite[]; serper_calls: number; estimated_serper_calls: number }> {
  const districts = truncateRows(districtsFromSchools(options.schools, options.domains ?? []), options.maxRows ?? null);
  const seeded = sitesFromEmailDomains(districts);
  const needsSearch = districts.filter((district, index) => {
    const site = seeded[index];
    return !site || site.confidence === 'low' || site.confidence === 'none' || !site.website;
  });

  const estimate = {
    dry_run: Boolean(options.dryRun),
    districts: districts.length,
    seeded_high_or_medium: seeded.filter((row) => row.confidence === 'high' || row.confidence === 'medium').length,
    estimated_serper_calls: needsSearch.length,
    estimated_serper_usd: Number((needsSearch.length * 0.001).toFixed(3)),
  };

  if (options.dryRun && !options.fixtures) {
    writeJson(join(options.runDir, 'sites_dry_run.json'), estimate);
    console.error(
      `[resolve-sites] dry-run districts=${estimate.districts} seeded=${estimate.seeded_high_or_medium} serper=${estimate.estimated_serper_calls} (~$${estimate.estimated_serper_usd})`,
    );
    return { sites: seeded, serper_calls: 0, estimated_serper_calls: needsSearch.length };
  }

  if (!options.fixtures) {
    requireLiveForPaid({
      live: Boolean(options.live),
      dryRun: Boolean(options.dryRun),
      fixtures: false,
      vendor: 'Serper',
    });
  }

  const checkpointPath = join(options.runDir, 'sites_checkpoint.json');
  const existing = loadJson<SiteCheckpoint>(checkpointPath);
  const checkpoint: SiteCheckpoint = existing ?? {
    version: 1,
    status: 'in_progress',
    next_index: 0,
    serper_calls: 0,
    results: Object.fromEntries(seeded.filter((row) => row.confidence === 'high' || row.confidence === 'medium').map((row) => [row.leaid, row])),
  };

  for (let i = checkpoint.next_index; i < districts.length; i++) {
    const district = districts[i]!;
    const already = checkpoint.results[district.leaid];
    if (already && (already.confidence === 'high' || already.confidence === 'medium') && already.website) {
      checkpoint.next_index = i + 1;
      writeJson(checkpointPath, checkpoint);
      continue;
    }
    const extras: SiteCandidate[] = [];
    const verified = bestVerified(district);
    if (verified) extras.push(verified);
    if (district.email_domain) {
      extras.push({
        url: toWebsite(district.email_domain),
        title: district.lea_name,
        snippet: 'furnace email domain',
        position: 1,
        source: 'furnace_email',
      });
    }
    const seededPick = pickDistrictWebsite(district, extras);
    if (seededPick.confidence === 'high' || seededPick.confidence === 'medium') {
      checkpoint.results[district.leaid] = seededPick;
    } else {
      const query = serperQueryForDistrict(district);
      const json = await serperSearch(query, {
        useFixtures: Boolean(options.fixtures),
        onCall: () => {
          checkpoint.serper_calls += 1;
        },
      });
      const picked = pickDistrictWebsite(district, [...extras, ...candidatesFromSerper(json)]);
      checkpoint.results[district.leaid] = picked;
      if (!options.fixtures) await sleepWithJitter(200, 120);
    }
    checkpoint.next_index = i + 1;
    writeJson(checkpointPath, checkpoint);
  }

  checkpoint.status = 'completed';
  writeJson(checkpointPath, checkpoint);
  const sites = districts.map(
    (district) =>
      checkpoint.results[district.leaid] ??
      pickDistrictWebsite(district, []),
  );
  writeDistrictSites(options.runDir, sites);
  console.error(
    `[resolve-sites] sites=${sites.length} with_website=${sites.filter((row) => row.website).length} serper_calls=${checkpoint.serper_calls}`,
  );
  return { sites, serper_calls: checkpoint.serper_calls, estimated_serper_calls: needsSearch.length };
}
