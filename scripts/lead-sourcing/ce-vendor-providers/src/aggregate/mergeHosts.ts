import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readCsv } from '../lib/csv.js';
import { hostnameOf } from '../lib/url.js';
import { repoRoot } from '../lib/env.js';
import type { ProspectRow } from '../lib/types.js';
import { companyKey } from './tiers.js';

const CE_CREDIT =
  /\b(ceu?s?\b|cpe\b|pdh\b|continuing education|ce credit|ce credits|contact hours?)\b/i;

export type WebinarHostCeRow = {
  company_name: string;
  company_domain: string;
  sample_url: string;
  snippet: string;
};

export function isCeWebinarText(...parts: string[]): boolean {
  return CE_CREDIT.test(parts.join(' '));
}

/** Latest webinar-hosts run with a stage3 CSV, else the 2026-07-08 run. */
export function defaultWebinarHostsRunDir(): string | null {
  const root = join(repoRoot, 'scripts/lead-sourcing/webinar-hosts/output/runs');
  if (!existsSync(root)) return null;
  const dirs = readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
    .reverse();
  for (const name of dirs) {
    const stage3 = join(root, name, 'stage3_webinar_host_entities.csv');
    if (existsSync(stage3)) return join(root, name);
  }
  return null;
}

export function loadWebinarHostCeSlice(runDir: string): WebinarHostCeRow[] {
  const stage2Path = join(runDir, 'stage2_linkedin_webinar_posts_extracted.csv');
  const stage3Path = join(runDir, 'stage3_webinar_host_entities.csv');
  const stage2 = existsSync(stage2Path) ? readCsv(stage2Path) : [];
  const stage3 = existsSync(stage3Path) ? readCsv(stage3Path) : [];
  const cePosts = stage2.filter((row) =>
    isCeWebinarText(row.post_text ?? '', row.result_title ?? '', row.result_snippet ?? ''),
  );
  const byCompany = new Map<string, WebinarHostCeRow>();

  for (const post of cePosts) {
    const name = (post.author_employer_name || post.author_name || '').trim();
    if (!name) continue;
    const key = companyKey(name);
    if (!key || byCompany.has(key)) continue;
    byCompany.set(key, {
      company_name: name,
      company_domain: '',
      sample_url: post.result_url || post.sample_post_url || '',
      snippet: (post.post_text || post.result_snippet || '').slice(0, 280),
    });
  }

  for (const org of stage3) {
    const name = (org.company_name || '').trim();
    if (!name) continue;
    const hay = `${org.webinar_topic ?? ''} ${org.target_audience ?? ''} ${org.industry ?? ''}`;
    const key = companyKey(name);
    const existing = byCompany.get(key);
    if (!existing && !isCeWebinarText(hay)) continue;
    const domain = (org.company_domain || '').replace(/^www\./i, '').toLowerCase();
    if (existing) {
      existing.company_domain = existing.company_domain || domain;
      continue;
    }
    byCompany.set(key, {
      company_name: name,
      company_domain: domain,
      sample_url: org.sample_post_url || org.registration_urls || '',
      snippet: hay.slice(0, 280),
    });
  }

  return [...byCompany.values()];
}

export function mergeWebinarHostsIntoProspects(
  hosts: ProspectRow[],
  slice: WebinarHostCeRow[],
): ProspectRow[] {
  const byDomain = new Set(
    hosts.map((h) => hostnameOf(h.example_urls.split('|')[0] ?? '') || h.registration_host_domain).filter(Boolean),
  );
  const byName = new Set(hosts.map((h) => companyKey(h.company_name)));
  const extra: ProspectRow[] = [];
  for (const row of slice) {
    const domain = row.company_domain.replace(/^www\./i, '').toLowerCase();
    if (domain && byDomain.has(domain)) continue;
    if (byName.has(companyKey(row.company_name))) continue;
    extra.push({
      company_name: row.company_name,
      fit_tier: 0,
      host_tier: 1,
      activity_count: 1,
      entity_class: 'education_company',
      self_provided: false,
      is_free: null,
      registration_kind: domain ? 'own_domain' : 'unknown',
      registration_host_domain: domain,
      audience_profession: '',
      audience_relationship: 'customer',
      company_sells_what: '',
      has_formal_grant_program: false,
      ce_formats: 'live_online',
      primary_ce_format: 'live_online',
      has_live_online: true,
      source_directories: 'webinar-hosts',
      example_urls: row.sample_url,
      needs_review: true,
      easy_audience_access_review: '',
    });
    if (domain) byDomain.add(domain);
    byName.add(companyKey(row.company_name));
  }
  return [...hosts, ...extra];
}
