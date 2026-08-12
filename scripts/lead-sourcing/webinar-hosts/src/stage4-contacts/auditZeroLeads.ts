/**
 * Audit why Stage 4 returned zero leads for specific entities.
 * Uses free Apollo api_search only (no bulk_match credits).
 *
 * Usage:
 *   npm run audit:zero-leads -- \
 *     --input output/runs/stage1-live/stage3_pilot_100.csv \
 *     --leads output/runs/stage1-live/stage4_pilot_100_leads_v2.csv \
 *     --stage2-input output/runs/stage1-live/stage2_linkedin_webinar_posts_extracted.csv
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureEnv } from '../lib/env.js';
import { loadIcpConfig } from '../lib/config.js';
import { readCsv, writeCsv } from '../lib/csv.js';
import { buildAuthorProfileByUrl } from './icpFilter.js';
import {
  classifyContactTier,
  isPosterEligible,
  pickContactSlots,
  type ContactTier,
} from './contactTier.js';
import { withRetry } from '../lib/retry.js';
import type { Stage3Row } from '../lib/types.js';

type ApiSearchPerson = {
  id: string;
  first_name?: string;
  title?: string;
  has_email?: boolean;
};

type AuditReason =
  | 'apollo_empty'
  | 'apollo_no_has_email'
  | 'all_titles_excluded'
  | 'all_titles_unknown'
  | 'tier_match_no_apollo_email'
  | 'slots_picked_likely_bulk_match_miss'
  | 'poster_eligible_org_search_also_empty';

type AuditRow = {
  company_name: string;
  employee_count: string;
  entity_source: string;
  apollo_org_id: string;
  audit_reason: string;
  poster_eligible: string;
  pool_size: string;
  pool_with_email: string;
  tier_webinar: string;
  tier_pipeline: string;
  tier_executive: string;
  tier_excluded: string;
  tier_unknown: string;
  sample_titles: string;
  would_pick_ids: string;
};

async function apolloPeopleApiSearch(
  organizationId: string,
  perPage: number,
): Promise<ApiSearchPerson[]> {
  const apiKey = process.env.APOLLO_API_KEY?.trim();
  if (!apiKey) throw new Error('APOLLO_API_KEY required');

  const url = new URL('https://api.apollo.io/api/v1/mixed_people/api_search');
  url.searchParams.append('organization_ids[]', organizationId);
  url.searchParams.set('page', '1');
  url.searchParams.set('per_page', String(perPage));

  return withRetry(async () => {
    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'X-Api-Key': apiKey,
      },
    });
    if (!response.ok) {
      throw new Error(`Apollo api_search failed: ${response.status}`);
    }
    const data = (await response.json()) as { people?: ApiSearchPerson[] };
    return data.people ?? [];
  });
}

function countByTier(
  people: ApiSearchPerson[],
  contactTiers: ReturnType<typeof loadIcpConfig>['contact_search']['contact_tiers'],
  emailOnly: boolean,
): Record<ContactTier, number> {
  const counts: Record<ContactTier, number> = {
    webinar_fill: 0,
    pipeline: 0,
    executive: 0,
    poster: 0,
    excluded: 0,
    unknown: 0,
  };
  for (const person of people) {
    if (emailOnly && person.has_email === false) continue;
    counts[classifyContactTier(person.title, contactTiers)]++;
  }
  return counts;
}

function diagnose(
  entity: Stage3Row,
  pool: ApiSearchPerson[],
  contactTiers: ReturnType<typeof loadIcpConfig>['contact_search']['contact_tiers'],
  posterEligible: boolean,
): AuditReason {
  if (pool.length === 0) return 'apollo_empty';

  const withEmail = pool.filter((p) => p.has_email !== false);
  if (withEmail.length === 0) return 'apollo_no_has_email';

  const tierCounts = countByTier(withEmail, contactTiers, true);
  const tierable = tierCounts.webinar_fill + tierCounts.pipeline + tierCounts.executive;

  if (tierCounts.excluded === withEmail.length) return 'all_titles_excluded';
  if (tierable === 0 && tierCounts.unknown > 0) return 'all_titles_unknown';

  const tierAnyEmail = countByTier(pool, contactTiers, false);
  const tierableAny = tierAnyEmail.webinar_fill + tierAnyEmail.pipeline + tierAnyEmail.executive;
  if (tierable === 0 && tierableAny > 0) return 'tier_match_no_apollo_email';

  const slots = pickContactSlots(withEmail, 2, contactTiers);
  if (slots.length > 0) return 'slots_picked_likely_bulk_match_miss';

  if (posterEligible) return 'poster_eligible_org_search_also_empty';
  return 'all_titles_unknown';
}

export async function auditZeroLeads(options: {
  inputPath: string;
  leadsPath: string;
  stage2InputPath: string;
  outputPath?: string;
}): Promise<{ audits: AuditRow[]; summary: Record<string, number> }> {
  await ensureEnv();
  const icpConfig = loadIcpConfig();
  const contactTiers = icpConfig.contact_search.contact_tiers;
  const perPage = icpConfig.contact_search.per_page;

  const entities = readCsv(resolve(options.inputPath)) as Stage3Row[];
  const leads = readCsv(resolve(options.leadsPath));
  const stage2 = readCsv(resolve(options.stage2InputPath));
  const authorByUrl = buildAuthorProfileByUrl(stage2);

  const leadCompanies = new Set(leads.map((l) => l.company_name));
  const zeroLead = entities.filter((e) => !leadCompanies.has(e.company_name));

  const audits: AuditRow[] = [];
  const summary: Record<string, number> = {};

  for (const entity of zeroLead) {
    const pool = await apolloPeopleApiSearch(entity.apollo_org_id, perPage);
    const posterEligible = isPosterEligible(entity, authorByUrl);
    const reason = diagnose(entity, pool, contactTiers, posterEligible);
    summary[reason] = (summary[reason] ?? 0) + 1;

    const withEmail = pool.filter((p) => p.has_email !== false);
    const tierWithEmail = countByTier(withEmail, contactTiers, true);
    const slots = pickContactSlots(withEmail, 2, contactTiers);

    audits.push({
      company_name: entity.company_name,
      employee_count: entity.employee_count,
      entity_source: entity.entity_source,
      apollo_org_id: entity.apollo_org_id,
      audit_reason: reason,
      poster_eligible: posterEligible ? 'yes' : 'no',
      pool_size: String(pool.length),
      pool_with_email: String(withEmail.length),
      tier_webinar: String(tierWithEmail.webinar_fill),
      tier_pipeline: String(tierWithEmail.pipeline),
      tier_executive: String(tierWithEmail.executive),
      tier_excluded: String(tierWithEmail.excluded),
      tier_unknown: String(tierWithEmail.unknown),
      sample_titles: pool
        .slice(0, 5)
        .map((p) => `${p.title ?? '?'}${p.has_email === false ? ' [no email]' : ''}`)
        .join(' | '),
      would_pick_ids: slots.map((s) => `${s.tier}:${s.title ?? s.id}`).join(' | '),
    });

    await new Promise((r) => setTimeout(r, 300));
  }

  const outputPath =
    options.outputPath ??
    resolve(options.leadsPath.replace(/\.csv$/, '_zero_lead_audit.csv'));

  writeCsv(outputPath, audits, [
    'company_name',
    'employee_count',
    'entity_source',
    'apollo_org_id',
    'audit_reason',
    'poster_eligible',
    'pool_size',
    'pool_with_email',
    'tier_webinar',
    'tier_pipeline',
    'tier_executive',
    'tier_excluded',
    'tier_unknown',
    'sample_titles',
    'would_pick_ids',
  ]);

  console.log(JSON.stringify({ zero_lead_count: zeroLead.length, summary, output: outputPath }, null, 2));
  return { audits, summary };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  const argv = process.argv.slice(2);
  let inputPath: string | undefined;
  let leadsPath: string | undefined;
  let stage2InputPath: string | undefined;
  let outputPath: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--input' && argv[i + 1]) inputPath = argv[++i];
    else if (arg === '--leads' && argv[i + 1]) leadsPath = argv[++i];
    else if (arg === '--stage2-input' && argv[i + 1]) stage2InputPath = argv[++i];
    else if (arg === '--output' && argv[i + 1]) outputPath = argv[++i];
  }
  if (!inputPath || !leadsPath || !stage2InputPath) {
    console.error(
      'Usage: tsx src/stage4-contacts/auditZeroLeads.ts --input stage3.csv --leads stage4.csv --stage2-input stage2.csv',
    );
    process.exit(1);
  }
  auditZeroLeads({ inputPath, leadsPath, stage2InputPath, outputPath }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
