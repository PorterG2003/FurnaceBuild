import { join } from 'node:path';
import { PROSPECT_COLUMNS } from './columns.js';
import { cell, readCsv, writeCsv } from '../lib/csv.js';
import { writeJson } from '../lib/io.js';
import { writeJsonl } from '../lib/jsonl.js';
import { configDir } from '../lib/env.js';
import type { CompanyRecord, DoorResult, ReviewRow } from '../types.js';
import { scoreAllDoors, type RoutedCompany } from './score.js';

export { PROSPECT_COLUMNS };

export function scoreAndExport(options: {
  runDir: string;
  companies: CompanyRecord[];
  review: ReviewRow[];
}): { routed: Array<RoutedCompany & { company: CompanyRecord }>; coverage: { gold: number; recovered: number; recall: number } } {
  const routed = options.companies.map((company) => ({ ...scoreAllDoors(company), company }));
  routed.sort((a, b) => b.routing_score - a.routing_score);

  const doorRows: DoorResult[] = routed.flatMap((r) => r.doors);
  writeJsonl(join(options.runDir, 'doors', 'cold_email.jsonl'), doorRows.filter((d) => d.door === 'cold_email'));
  writeJsonl(join(options.runDir, 'doors', 'webinar.jsonl'), doorRows.filter((d) => d.door === 'webinar'));

  const exclusionRows = doorRows
    .filter((d) => !d.qualified && d.exclusion_reason && d.exclusion_reason !== 'reserved_not_built')
    .map((d) => {
      const company = routed.find((r) => r.company_id === d.company_id)?.company;
      return {
        company: company?.name ?? '',
        domain: company?.domain ?? '',
        door: d.door,
        exclusion_reason: d.exclusion_reason,
        stage: 'doors',
      };
    });
  writeCsv(join(options.runDir, 'output', 'exclusions.csv'), exclusionRows, [
    'company',
    'domain',
    'door',
    'exclusion_reason',
    'stage',
  ]);

  const ranked = routed.map((r, i) => prospectRow(i + 1, r.company, r));
  writeCsv(join(options.runDir, 'output', 'prospects.csv'), ranked, PROSPECT_COLUMNS);

  const reviewRows = options.review.map((r) => ({
    company: r.company,
    domain: r.domain,
    reason: r.reason,
    stage: r.stage,
  }));
  for (const r of routed) {
    if (r.company.outbound_marketer_title_only) {
      reviewRows.push({
        company: r.company.name,
        domain: r.company.domain ?? '',
        reason: 'outbound_marketer_title_only',
        stage: 'gtm',
      });
    }
    if (r.company.hiring_outbound_marketer) {
      reviewRows.push({
        company: r.company.name,
        domain: r.company.domain ?? '',
        reason: 'hiring_outbound_marketer',
        stage: 'gtm',
      });
    }
    if (r.company.runs_webinars >= 0.6 && r.company.webinar_purpose !== 'unknown') {
      // purpose calibration: keep high-confidence webinar purpose in review on first runs
    }
  }
  writeCsv(join(options.runDir, 'output', 'review.csv'), reviewRows, ['company', 'domain', 'reason', 'stage']);

  const coverage = measureCoverage(options.companies);
  writeJson(join(options.runDir, 'output', 'coverage.json'), coverage);
  return { routed, coverage };
}

function prospectRow(rank: number, c: CompanyRecord, r: RoutedCompany): Record<string, string> {
  const cold = r.doors.find((d) => d.door === 'cold_email');
  const web = r.doors.find((d) => d.door === 'webinar');
  const recentFunding =
    Boolean(c.last_funding_date) && Date.now() - Date.parse(c.last_funding_date) < 18 * 30.44 * 24 * 3600 * 1000;
  return {
    rank: String(rank),
    company: cell(c.name),
    primary_door: cell(r.primary_door),
    routing_score: cell(r.routing_score.toFixed(2)),
    secondary_door: cell(r.secondary_door),
    cold_email_qualified: cell(Boolean(cold?.qualified)),
    cold_email_score: cell(cold?.score),
    webinar_qualified: cell(Boolean(web?.qualified)),
    webinar_score: cell(web?.score),
    city: cell(c.city),
    query_city: cell(c.query_city),
    county: cell(c.county),
    state: cell(c.state || 'UT'),
    domain: cell(c.domain),
    what_they_sell: cell(c.what_they_sell),
    category: cell(c.category),
    b2b_type: cell(c.b2b_type),
    primary_buyer: cell(c.primary_buyer),
    customer_geo: cell(c.customer_geo),
    target_audience: cell(c.target_audience),
    employees: cell(c.employees),
    search_employee_band: cell(c.search_employee_band),
    revenue_est: cell(c.revenue_est),
    low_confidence_size: cell(c.low_confidence_size),
    sdr_headcount: cell(c.sdr_headcount),
    ae_headcount: cell(c.ae_headcount),
    outbound_marketer_detected: cell(c.outbound_marketer_detected),
    sequencer_detected: cell(c.sequencer_detected),
    sequencer_orphaned: cell(c.sequencer_orphaned),
    runs_webinars: cell(c.runs_webinars),
    webinar_platform: cell(c.webinar_platform),
    webinar_purpose: cell(c.webinar_purpose),
    webinar_cadence: cell(c.webinar_cadence),
    webinar_recency: cell(c.webinar_recency),
    webinar_audience: cell(c.webinar_audience),
    audience_is_ce_profession: cell(c.audience_is_ce_profession),
    webinar_role_detected: cell(c.webinar_role_detected),
    hiring_gtm: cell(c.hiring_gtm),
    headcount_growth_pct: cell(c.headcount_growth_pct),
    recent_funding: cell(recentFunding),
    hq_verification: cell(c.hq_verification),
    hq_address: cell(c.hq_address),
    sources: cell(c.sources.join('|')),
  };
}

export function measureCoverage(companies: CompanyRecord[]): {
  gold: number;
  recovered: number;
  recall: number;
  missing: string[];
} {
  const goldPath = join(configDir, 'coverage-gold.csv');
  let gold: Record<string, string>[] = [];
  try {
    gold = readCsv(goldPath);
  } catch {
    return { gold: 0, recovered: 0, recall: 0, missing: [] };
  }
  const domains = new Set(companies.map((c) => (c.domain ?? '').toLowerCase()).filter(Boolean));
  const names = new Set(companies.map((c) => c.name.toLowerCase()));
  const missing: string[] = [];
  let recovered = 0;
  for (const row of gold) {
    const domain = (row.domain ?? '').toLowerCase();
    const name = (row.company ?? row.name ?? '').toLowerCase();
    if ((domain && domains.has(domain)) || (name && names.has(name))) recovered += 1;
    else missing.push(row.company || row.name || domain);
  }
  return {
    gold: gold.length,
    recovered,
    recall: gold.length ? recovered / gold.length : 0,
    missing,
  };
}
