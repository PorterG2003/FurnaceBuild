/** Stable campaign id for idempotent re-runs (override with SEED_CAMPAIGN_ID). */
export const DEFAULT_BUCKET_INSIGHTS_CAMPAIGN_ID = 'f0000000-0000-4000-8000-00000000b001';

export const BUCKET_INSIGHTS_EMAIL_VARIANT_ID = 'f0000000-0000-4000-8000-00000000b002';

/** Total leads seeded into the campaign bucket. */
export const BUCKET_INSIGHTS_LEAD_COUNT = 2500;

/** Tagged on direct inserts; import RPC rows use source `api`. */
export const BUCKET_INSIGHTS_LEAD_SOURCE = 'seed-bucket-insights-smoke';

export const BUCKET_INSIGHTS_CAMPAIGN_NAME = 'Bucket Insights Smoke (2500 leads)';

export function bucketInsightsCampaignIdShort(campaignId: string): string {
  return campaignId.replace(/-/g, '').slice(0, 12);
}
