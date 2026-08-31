import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { splitName } from '../../webinar-hosts/src/stage3-enrich/apolloClient.js';
import { readCsv, writeCsv } from '../../webinar-hosts/src/lib/csv.js';
import { ceVendorsIcpPath, loadIcpConfig, type IcpConfig } from './config.js';
import {
  classifyContactTier,
  parseEmployeeCount,
  type ContactTier,
} from './contactTier.js';
import {
  LEAD_COLUMNS,
  RESOLVED_COMPANY_COLUMNS,
  type LeadRow,
  type ResolvedCompanyRow,
} from './types.js';

export type HunterLeadRow = {
  company_name: string;
  company_domain: string;
  employee_count: string;
  industry: string;
  apollo_org_id: string;
  source_lists: string;
  person_name: string;
  person_title: string;
  email: string;
  linkedin: string;
  outcome: string;
};

function normalizeDomain(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/^www\./, '');
}

function normalizeEmail(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

export function keepApolloLead(lead: LeadRow, icp: IcpConfig): boolean {
  const tier = classifyContactTier(lead.contact_title, icp.contact_search.contact_tiers);
  if (tier === 'program' || tier === 'marketing') return true;
  if (tier !== 'executive') return false;
  const n = parseEmployeeCount(lead.employee_count);
  return n == null || n < 50;
}

export function hunterToLead(row: HunterLeadRow, icp: IcpConfig): LeadRow | null {
  const email = normalizeEmail(row.email);
  if (!email.includes('@')) return null;
  const { first_name, last_name } = splitName((row.person_name ?? '').trim());
  const classified = classifyContactTier(row.person_title, icp.contact_search.contact_tiers);
  const contact_tier: ContactTier | 'hunter' =
    classified === 'excluded' || classified === 'unknown' ? 'hunter' : classified;
  return {
    email,
    first_name,
    last_name,
    company_name: row.company_name ?? '',
    website: normalizeDomain(row.company_domain),
    linkedin_url: row.linkedin ?? '',
    company_linkedin_url: '',
    contact_title: row.person_title ?? '',
    contact_tier,
    contact_pick_reason: 'hunter_mv_pass',
    employee_count: row.employee_count ?? '',
    industry: row.industry ?? '',
    apollo_org_id: row.apollo_org_id ?? '',
    source_lists: row.source_lists ?? '',
  };
}

function slotRank(lead: LeadRow, icp: IcpConfig): number {
  if (lead.contact_pick_reason === 'hunter_mv_pass') {
    const classified = classifyContactTier(lead.contact_title, icp.contact_search.contact_tiers);
    if (classified === 'program') return 0;
    if (classified === 'marketing') return 1;
    if (classified === 'executive') return 2;
    return 3;
  }
  const tier = classifyContactTier(lead.contact_title, icp.contact_search.contact_tiers);
  if (tier === 'program') return 0;
  if (tier === 'marketing') return 1;
  if (tier === 'executive') return 2;
  return 4;
}

export function capTwoPerDomain(leads: LeadRow[], icp: IcpConfig): LeadRow[] {
  const byDomain = new Map<string, LeadRow[]>();
  for (const lead of leads) {
    const domain = normalizeDomain(lead.website);
    if (!domain) continue;
    const list = byDomain.get(domain) ?? [];
    list.push(lead);
    byDomain.set(domain, list);
  }
  const out: LeadRow[] = [];
  for (const group of byDomain.values()) {
    group.sort((a, b) => slotRank(a, icp) - slotRank(b, icp) || a.email.localeCompare(b.email));
    const seen = new Set<string>();
    for (const lead of group) {
      if (seen.has(lead.email)) continue;
      seen.add(lead.email);
      out.push(lead);
      if (seen.size >= 2) break;
    }
  }
  return out;
}

export function companyNeedsCeSearch(leads: LeadRow[], employeeCount: string | undefined): boolean {
  const n = parseEmployeeCount(employeeCount);
  const small = n == null || n < 50;
  let program = false;
  let marketing = false;
  let exec = false;
  for (const lead of leads) {
    if (lead.contact_tier === 'program') program = true;
    else if (lead.contact_tier === 'marketing') marketing = true;
    else if (lead.contact_tier === 'executive' || lead.contact_tier === 'hunter') exec = true;
  }
  const hasProgramOrMkt = program || marketing;
  if (small) return !(exec && hasProgramOrMkt);
  if (!hasProgramOrMkt) return true;
  return leads.length < 2;
}

export function buildCeKeepList(options: {
  apolloLeads: LeadRow[];
  hunterRows: HunterLeadRow[];
  icp: IcpConfig;
}): LeadRow[] {
  const apolloKept = options.apolloLeads
    .filter((lead) => keepApolloLead(lead, options.icp))
    .map((lead) => ({
      ...lead,
      contact_tier: classifyContactTier(lead.contact_title, options.icp.contact_search.contact_tiers),
    }));
  const hunterKept: LeadRow[] = [];
  for (const row of options.hunterRows) {
    if ((row.outcome ?? '') !== 'mv_pass') continue;
    const lead = hunterToLead(row, options.icp);
    if (lead) hunterKept.push(lead);
  }
  const byEmail = new Map<string, LeadRow>();
  for (const lead of [...apolloKept, ...hunterKept]) {
    const email = normalizeEmail(lead.email);
    if (!email || byEmail.has(email)) continue;
    byEmail.set(email, lead);
  }
  return capTwoPerDomain([...byEmail.values()], options.icp);
}

export function selectGapCompanies(
  resolved: ResolvedCompanyRow[],
  keepLeads: LeadRow[],
): ResolvedCompanyRow[] {
  const byDomain = new Map<string, LeadRow[]>();
  for (const lead of keepLeads) {
    const domain = normalizeDomain(lead.website);
    const list = byDomain.get(domain) ?? [];
    list.push(lead);
    byDomain.set(domain, list);
  }
  return resolved.filter((company) => {
    if (company.enrichment_status !== 'ok' || !company.apollo_org_id) return false;
    const domain = normalizeDomain(company.company_domain);
    const leads = byDomain.get(domain) ?? [];
    return companyNeedsCeSearch(leads, company.employee_count);
  });
}

export function writeCeKeepList(options: {
  runDir: string;
  hunterPath?: string;
  icpPath?: string;
}): { keepPath: string; kept: number; hunterKept: number; apolloKept: number } {
  const runDir = resolve(options.runDir);
  const icp = loadIcpConfig(options.icpPath ?? ceVendorsIcpPath());
  const apolloLeads = readCsv(join(runDir, 'leads.csv')) as LeadRow[];
  const hunterPath = options.hunterPath ?? join(runDir, 'hunter', 'hunter_leads.csv');
  const hunterRows = existsSync(hunterPath)
    ? (readCsv(hunterPath) as HunterLeadRow[])
    : [];
  const hunterPass = hunterRows.filter((r) => r.outcome === 'mv_pass');
  const kept = buildCeKeepList({ apolloLeads, hunterRows, icp });
  const hunterKept = kept.filter((l) => l.contact_pick_reason === 'hunter_mv_pass').length;
  const apolloKept = kept.length - hunterKept;
  const keepPath = join(runDir, 'leads_ce_icp.csv');
  writeCsv(
    keepPath,
    kept.map((row) => ({ ...row })),
    [...LEAD_COLUMNS],
  );
  return { keepPath, kept: kept.length, hunterKept, apolloKept };
}

export function mergeCeKeepAndGap(options: {
  keepLeads: LeadRow[];
  gapLeads: LeadRow[];
  icp: IcpConfig;
}): LeadRow[] {
  const byEmail = new Map<string, LeadRow>();
  for (const lead of options.keepLeads) {
    const email = normalizeEmail(lead.email);
    if (email) byEmail.set(email, lead);
  }
  for (const lead of options.gapLeads) {
    if (!keepApolloLead(lead, options.icp)) continue;
    const email = normalizeEmail(lead.email);
    if (!email || byEmail.has(email)) continue;
    byEmail.set(email, lead);
  }
  return capTwoPerDomain([...byEmail.values()], options.icp);
}

export function writeCeCombinedLeads(options: {
  keepPath: string;
  gapPath: string;
  outPath: string;
  icpPath?: string;
}): {
  outPath: string;
  kept: number;
  keepInput: number;
  gapAdded: number;
  domains: number;
} {
  const icp = loadIcpConfig(options.icpPath ?? ceVendorsIcpPath());
  const keepLeads = readCsv(resolve(options.keepPath)) as LeadRow[];
  const gapLeads = readCsv(resolve(options.gapPath)) as LeadRow[];
  const kept = mergeCeKeepAndGap({ keepLeads, gapLeads, icp });
  const keepEmails = new Set(keepLeads.map((l) => normalizeEmail(l.email)).filter(Boolean));
  const gapAdded = kept.filter((l) => !keepEmails.has(normalizeEmail(l.email))).length;
  const domains = new Set(kept.map((l) => normalizeDomain(l.website)).filter(Boolean)).size;
  const outPath = resolve(options.outPath);
  writeCsv(
    outPath,
    kept.map((row) => ({ ...row })),
    [...LEAD_COLUMNS],
  );
  return {
    outPath,
    kept: kept.length,
    keepInput: keepLeads.length,
    gapAdded,
    domains,
  };
}

export function writeCeRoleGapRun(options: {
  sourceRunDir: string;
  destRunDir: string;
  icpPath?: string;
}): { destRunDir: string; gaps: number; keepPath: string } {
  const sourceRunDir = resolve(options.sourceRunDir);
  const destRunDir = resolve(options.destRunDir);
  const icp = loadIcpConfig(options.icpPath ?? ceVendorsIcpPath());
  const apolloLeads = readCsv(join(sourceRunDir, 'leads.csv')) as LeadRow[];
  const hunterPath = join(sourceRunDir, 'hunter', 'hunter_leads.csv');
  const hunterRows = existsSync(hunterPath)
    ? (readCsv(hunterPath) as HunterLeadRow[])
    : [];
  const kept = buildCeKeepList({ apolloLeads, hunterRows, icp });
  const resolved = readCsv(join(sourceRunDir, 'companies_resolved.csv')) as ResolvedCompanyRow[];
  const gaps = selectGapCompanies(resolved, kept);
  writeCsv(
    join(destRunDir, 'companies_resolved.csv'),
    gaps.map((row) => ({ ...row })),
    [...RESOLVED_COMPANY_COLUMNS],
  );
  const keepPath = join(destRunDir, 'leads_ce_icp.csv');
  writeCsv(
    keepPath,
    kept.map((row) => ({ ...row })),
    [...LEAD_COLUMNS],
  );
  return { destRunDir, gaps: gaps.length, keepPath };
}
