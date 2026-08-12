import { join } from 'node:path';
import { ensureDir, loadJson, readCsv, writeCsv, writeJson } from './io.js';
import { serperSearch, type SerperOrganic } from './serperClient.js';
import { normalizeLinkedInProfileUrl } from './pass5Prep.js';
import { brandTokens } from './domainScore.js';

export const LINKEDIN_CANDIDATE_COLUMNS = [
  'ad_id',
  'company_name',
  'company_domain',
  'platform',
  'person_name',
  'landing_url',
  'query',
  'linkedin_url',
  'serper_title',
  'serper_snippet',
  'score',
  'reasons',
  'status',
  'error',
  'ad_library_url',
] as const;

function tokenHit(hay: string, tokens: string[]): number {
  const h = hay.toLowerCase();
  let n = 0;
  for (const t of tokens) if (t.length >= 3 && h.includes(t)) n += 1;
  return n;
}

export function scoreLinkedInOrganic(
  personName: string,
  companyName: string,
  companyDomain: string,
  organic: SerperOrganic,
): { score: number; reasons: string[]; url: string } | null {
  const raw = (organic.link || '').trim();
  const url = normalizeLinkedInProfileUrl(raw);
  if (!url) return null;

  let score = 0.2;
  const reasons: string[] = ['linkedin_in'];
  const title = organic.title || '';
  const snippet = organic.snippet || '';
  const blob = `${title}\n${snippet}\n${url}`;

  const personTokens = brandTokens(personName);
  const companyTokens = [
    ...brandTokens(companyName),
    ...(companyDomain ? [companyDomain.split('.')[0] || ''] : []),
  ].filter((t) => t.length >= 3);

  const personHits = tokenHit(blob, personTokens);
  if (personHits === 0) {
    return null;
  }

  const titleLower = title.toLowerCase();
  const slug = (url.split('/in/')[1] || '').toLowerCase();
  const first = personTokens[0] || '';
  const last = personTokens[personTokens.length - 1] || '';
  const slugHasName = Boolean(first && last && slug.includes(first) && slug.includes(last));
  const titleStartsWithName =
    Boolean(first && last) &&
    (titleLower.startsWith(`${first} ${last}`) ||
      titleLower.startsWith(`${first}-${last}`) ||
      new RegExp(`^${first}\\s+${last}\\b`, 'i').test(title));

  // Reject profiles that only mention the person in a snippet (colleague/reference)
  if (!slugHasName && !titleStartsWithName) {
    return null;
  }

  score += Math.min(0.5, 0.25 * personHits);
  reasons.push('person_tokens');
  if (slugHasName) {
    score += 0.25;
    reasons.push('slug_name');
  }
  if (titleStartsWithName) {
    score += 0.2;
    reasons.push('title_name');
  }

  const companyHits = tokenHit(blob, companyTokens);
  if (companyHits > 0) {
    score += Math.min(0.35, 0.2 * companyHits);
    reasons.push('company_tokens');
  }

  if ((organic.position ?? 99) === 1) {
    score += 0.1;
    reasons.push('pos1');
  }

  return { score, reasons, url };
}

export function pickBestLinkedInCandidate(
  personName: string,
  companyName: string,
  companyDomain: string,
  organic: SerperOrganic[],
): {
  linkedin_url: string;
  serper_title: string;
  serper_snippet: string;
  score: number;
  reasons: string;
  status: string;
} {
  const scored: Array<{
    url: string;
    score: number;
    reasons: string[];
    title: string;
    snippet: string;
  }> = [];

  for (const hit of organic) {
    const s = scoreLinkedInOrganic(personName, companyName, companyDomain, hit);
    if (!s) continue;
    scored.push({
      url: s.url,
      score: s.score,
      reasons: s.reasons,
      title: hit.title || '',
      snippet: hit.snippet || '',
    });
  }

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || best.score < 0.35) {
    return {
      linkedin_url: '',
      serper_title: best?.title || '',
      serper_snippet: best?.snippet || '',
      score: best?.score ?? 0,
      reasons: best?.reasons.join('|') || 'no_candidate',
      status: 'no_match',
    };
  }

  return {
    linkedin_url: best.url,
    serper_title: best.title,
    serper_snippet: best.snippet,
    score: best.score,
    reasons: best.reasons.join('|'),
    status: best.score >= 0.55 ? 'candidate' : 'weak_candidate',
  };
}

/**
 * Serper-discover linkedin.com/in URLs for landing-page people.
 */
export async function discoverLinkedInUrls(options: {
  inputCsv: string;
  outDir: string;
  dryRun?: boolean;
  liveConfirmed?: boolean;
  maxRows?: number | null;
  apiKey?: string;
}): Promise<{ path: string; candidates: number; queries: number }> {
  if (!options.dryRun && !options.liveConfirmed) {
    throw new Error('Pass dryRun or liveConfirmed for Serper discover');
  }

  const outDir = ensureDir(options.outDir);
  const outPath = join(outDir, 'linkedin_candidates.csv');
  const checkpointPath = join(outDir, 'discover_li_checkpoint.json');

  let rows = readCsv(options.inputCsv).filter(
    (r) => (r.person_name || '').trim() && (r.status === 'found' || !r.status),
  );
  // Dedupe by ad_id|person
  const seen = new Set<string>();
  rows = rows.filter((r) => {
    const k = `${r.ad_id}|${(r.person_name || '').toLowerCase()}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (options.maxRows != null) rows = rows.slice(0, options.maxRows);

  if (options.dryRun) {
    const estimate = {
      dry_run: true,
      people: rows.length,
      estimated_serper_queries: rows.length,
      note: '1 Serper query per person (site:linkedin.com/in)',
    };
    console.log(JSON.stringify(estimate, null, 2));
    writeJson(join(outDir, 'discover_li_dry_run.json'), estimate);
    return { path: outPath, candidates: 0, queries: 0 };
  }

  type Result = Record<string, string>;
  type Checkpoint = { next_index: number; results: Result[]; queries: number };
  let checkpoint = loadJson<Checkpoint>(checkpointPath) ?? {
    next_index: 0,
    results: [],
    queries: 0,
  };

  for (let i = checkpoint.next_index; i < rows.length; i++) {
    const row = rows[i]!;
    const person = (row.person_name || '').trim();
    const company = (row.company_name || '').trim();
    const domain = (row.company_domain || '').trim();
    const query = `"${person}" "${company}" site:linkedin.com/in`;
    console.error(`[discover-li] ${i + 1}/${rows.length} ${person} @ ${company}`);

    let error = '';
    let picked = {
      linkedin_url: '',
      serper_title: '',
      serper_snippet: '',
      score: 0,
      reasons: '',
      status: 'error',
    };

    try {
      const resp = await serperSearch(query, { apiKey: options.apiKey, num: 5 });
      checkpoint.queries += 1;
      const best = pickBestLinkedInCandidate(person, company, domain, resp.organic || []);
      picked = {
        linkedin_url: best.linkedin_url,
        serper_title: best.serper_title,
        serper_snippet: best.serper_snippet,
        score: typeof best.score === 'number' ? best.score : Number(best.score) || 0,
        reasons: best.reasons,
        status: best.status,
      };
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }

    checkpoint.results.push({
      ad_id: row.ad_id ?? '',
      company_name: company,
      company_domain: domain,
      platform: row.platform ?? '',
      person_name: person,
      landing_url: row.landing_url ?? '',
      query,
      linkedin_url: picked.linkedin_url,
      serper_title: picked.serper_title,
      serper_snippet: picked.serper_snippet,
      score: String(picked.score),
      reasons: picked.reasons,
      status: error ? 'error' : picked.status,
      error,
      ad_library_url: row.ad_library_url ?? '',
    });
    checkpoint.next_index = i + 1;
    writeJson(checkpointPath, checkpoint);
    writeCsv(outPath, checkpoint.results, [...LINKEDIN_CANDIDATE_COLUMNS]);
    await new Promise((r) => setTimeout(r, 150));
  }

  const candidates = checkpoint.results.filter(
    (r) => r.status === 'candidate' || r.status === 'weak_candidate',
  ).length;
  writeJson(join(outDir, 'discover_li_tally.json'), {
    queries: checkpoint.queries,
    candidates,
    no_match: checkpoint.results.filter((r) => r.status === 'no_match').length,
  });
  console.log(
    JSON.stringify({ done: true, queries: checkpoint.queries, candidates }, null, 2),
  );
  return { path: outPath, candidates, queries: checkpoint.queries };
}
