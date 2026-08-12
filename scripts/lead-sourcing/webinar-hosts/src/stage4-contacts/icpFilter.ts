import type { Stage3Row } from '../lib/types.js';
import type { IcpConfig } from '../lib/config.js';
import { evaluatePipelineIntent } from './pipelineIntentFilter.js';

export type IcpDecision = {
  pass: boolean;
  reason: string;
};

export type FilterEntitiesOptions = {
  icpConfig: IcpConfig;
  postTextByUrl: Map<string, string>;
};

export function evaluateIcp(
  entity: Stage3Row,
  config: IcpConfig,
  postTextByUrl: Map<string, string>,
): IcpDecision {
  if (entity.enrichment_status === 'not_found') {
    return { pass: false, reason: 'enrichment_not_found' };
  }

  if (!entity.apollo_org_id?.trim()) {
    return { pass: false, reason: 'no_apollo_org_id' };
  }

  if (config.pipeline_filter.enabled) {
    const postText = postTextByUrl.get(entity.sample_post_url) ?? '';
    const pipeline = evaluatePipelineIntent(postText);
    if (!pipeline.pass) {
      return { pass: false, reason: 'pipeline_not_plausible' };
    }
  }

  const industry = entity.industry.trim().toLowerCase();
  if (industry && config.industry_blocklist.length > 0) {
    const blocked = config.industry_blocklist.some((item) => industry.includes(item.toLowerCase()));
    if (blocked) return { pass: false, reason: 'industry_blocked' };
  }

  const companyName = entity.company_name.trim().toLowerCase();
  if (companyName && config.entity_blocklist?.length > 0) {
    const blocked = config.entity_blocklist.some((item) => companyName.includes(item.toLowerCase()));
    if (blocked) return { pass: false, reason: 'entity_blocked' };
  }

  if (config.industry_allowlist.length > 0) {
    const allowed = config.industry_allowlist.some((item) => industry.includes(item.toLowerCase()));
    if (!allowed) return { pass: false, reason: 'industry_not_allowed' };
  }

  return { pass: true, reason: 'icp_pass' };
}

export function filterEntities(
  entities: Stage3Row[],
  options: FilterEntitiesOptions,
): { passed: Stage3Row[]; rejected: Array<Stage3Row & { rejection_reason: string }> } {
  const passed: Stage3Row[] = [];
  const rejected: Array<Stage3Row & { rejection_reason: string }> = [];

  for (const entity of entities) {
    const decision = evaluateIcp(entity, options.icpConfig, options.postTextByUrl);
    if (decision.pass) passed.push(entity);
    else rejected.push({ ...entity, rejection_reason: decision.reason });
  }

  return { passed, rejected };
}

export function countRejectionReasons(
  rejected: Array<{ rejection_reason: string }>,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rejected) {
    const reason = row.rejection_reason || 'unknown';
    counts[reason] = (counts[reason] ?? 0) + 1;
  }
  return counts;
}

export function buildPostTextByUrl(
  stage2Rows: Array<{ result_url?: string; post_text?: string }>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of stage2Rows) {
    const url = row.result_url?.trim();
    const text = row.post_text?.trim();
    if (url && text) map.set(url, text);
  }
  return map;
}

export function buildAuthorProfileByUrl(
  stage2Rows: Array<{ result_url?: string; author_profile_url?: string }>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of stage2Rows) {
    const url = row.result_url?.trim();
    const authorUrl = row.author_profile_url?.trim();
    if (url && authorUrl) map.set(url, authorUrl);
  }
  return map;
}
