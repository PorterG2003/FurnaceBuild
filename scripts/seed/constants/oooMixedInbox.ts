export type OooInboxCaseKey = 'normal' | 'ooo_only' | 'ooo_future' | 'ooo_due';

export const OOO_INBOX_CASE_KEYS: OooInboxCaseKey[] = [
  'normal',
  'ooo_only',
  'ooo_future',
  'ooo_due',
];

export const OOO_BULK_CASE_COUNTS: Record<OooInboxCaseKey, number> = {
  normal: 8,
  /** Each OOO key maps 1:1 to enrollments that park on `waitTime-1` and can reach `email-2` after resume. */
  ooo_only: 4,
  ooo_future: 4,
  ooo_due: 4,
};

export const DEFAULT_SEED_OOO_CAMPAIGN_ID = 'f0000000-0000-4000-8000-00000000d101';

/**
 * Fixed anchor for **historical** email-1 `campaign_intervals` only. Intervals are completed
 * during the seed, then replaced with {@link buildOooRuntimeIntervalIsoTimes} so workers
 * are not anchored years ahead (which would block real `email-2` assignment).
 */
export const OOO_HISTORICAL_INTERVAL_ANCHOR_ISO = '2099-07-15T15:00:00.000Z';

/** @deprecated Prefer `OOO_HISTORICAL_INTERVAL_ANCHOR_ISO` */
export const OOO_INTERVAL_TIME_ISO = OOO_HISTORICAL_INTERVAL_ANCHOR_ISO;

/** Must match `sending_interval_seconds` on the seeded OOO campaign row. */
export const OOO_SEED_SENDING_INTERVAL_SECONDS = 300;

/**
 * How many future `campaign_intervals` rows to insert after historical email-1 completes.
 * Scheduler interval maintenance uses ~20 slots ahead; keep a buffer.
 */
export const OOO_RUNTIME_INTERVAL_COUNT = 28;

/** First runtime slot is this far after `referenceMs` so it stays `interval_time > now` during seed + short drift. */
export const OOO_RUNTIME_FIRST_INTERVAL_OFFSET_MS = 5 * 60 * 1000;

/**
 * Builds strictly increasing future interval timestamps for the live scheduler path
 * (`batchAssignIntervalJobs`: `interval_time > now`, not `completed`).
 */
export function buildOooRuntimeIntervalIsoTimes(referenceMs: number): string[] {
  const spacingMs = OOO_SEED_SENDING_INTERVAL_SECONDS * 1000;
  const out: string[] = [];
  for (let i = 0; i < OOO_RUNTIME_INTERVAL_COUNT; i += 1) {
    out.push(new Date(referenceMs + OOO_RUNTIME_FIRST_INTERVAL_OFFSET_MS + i * spacingMs).toISOString());
  }
  return out;
}

export const OOO_SEED_SOURCE = 'seed-ooo-mixed-inbox';
export const OOO_SEED_WORKER_ID = 'seed-ooo-mixed-inbox';

export function oooCampaignIdShort(campaignId: string): string {
  return campaignId.replace(/-/g, '').slice(0, 12);
}

const KIND_CODE: Record<OooInboxCaseKey, string> = {
  normal: '1',
  ooo_only: '2',
  ooo_future: '3',
  ooo_due: '4',
};

export type OooThreadSpec = {
  key: OooInboxCaseKey;
  index: number;
};

export function buildOooThreadSpecs(): OooThreadSpec[] {
  const specs: OooThreadSpec[] = [];
  for (const key of OOO_INBOX_CASE_KEYS) {
    for (let index = 1; index <= OOO_BULK_CASE_COUNTS[key]; index++) {
      specs.push({ key, index });
    }
  }
  return specs;
}

export function oooThreadId(key: OooInboxCaseKey, index: number): string {
  const code = KIND_CODE[key];
  const idx = index.toString(16).padStart(2, '0');
  return `f0000000-0000-4000-8${code}${idx}-000000000${code}${idx}`;
}

export function headerMessageId(
  key: OooInboxCaseKey,
  index: number,
  kind: 'sent' | 'received' | 'followup'
): string {
  return `<seed-ooo-${key.replace(/_/g, '-')}-${index}-${kind}@furnace.test>`;
}
