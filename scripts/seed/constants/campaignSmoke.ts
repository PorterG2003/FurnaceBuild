/** Stable campaign id for idempotent re-runs (override with SEED_CAMPAIGN_ID). */
export const DEFAULT_SEED_CAMPAIGN_ID = 'f0000000-0000-4000-8000-00000000ca01';

/** Fixed variant UUIDs so flow_data and nodes stay stable across runs. */
export const SMOKE_VARIANT_IDS = [
  'f0000000-0000-4000-8000-00000000ca02',
  'f0000000-0000-4000-8000-00000000ca03',
] as const;

/** Deterministic interval row for upsert (unique on campaign_id + interval_time). */
export const SMOKE_INTERVAL_TIME_ISO = '2099-06-15T15:00:00.000Z';

/** Leads tagged with this source can be safely removed on re-seed. */
export const SEED_LEAD_SOURCE = 'seed-campaign-smoke';

export const SEED_WORKER_ID = 'seed-campaign-smoke';

export function campaignIdShort(campaignId: string): string {
  return campaignId.replace(/-/g, '').slice(0, 12);
}
