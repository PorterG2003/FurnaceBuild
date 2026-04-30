export type OooInboxCaseKey = 'normal' | 'ooo_only' | 'ooo_future' | 'ooo_due';

export const OOO_INBOX_CASE_KEYS: OooInboxCaseKey[] = [
  'normal',
  'ooo_only',
  'ooo_future',
  'ooo_due',
];

export const DEFAULT_SEED_OOO_CAMPAIGN_ID = 'f0000000-0000-4000-8000-00000000d101';

export const OOO_INTERVAL_TIME_ISO = '2099-07-15T15:00:00.000Z';

export const OOO_SEED_SOURCE = 'seed-ooo-mixed-inbox';
export const OOO_SEED_WORKER_ID = 'seed-ooo-mixed-inbox';

export const OOO_THREAD_IDS: Record<OooInboxCaseKey, string> = {
  normal: 'f0000000-0000-4000-8000-00000000d111',
  ooo_only: 'f0000000-0000-4000-8000-00000000d112',
  ooo_future: 'f0000000-0000-4000-8000-00000000d113',
  ooo_due: 'f0000000-0000-4000-8000-00000000d114',
};

export function oooCampaignIdShort(campaignId: string): string {
  return campaignId.replace(/-/g, '').slice(0, 12);
}

export function headerMessageId(key: OooInboxCaseKey, kind: 'sent' | 'received'): string {
  return `<seed-ooo-${key.replace(/_/g, '-')}-${kind}@furnace.test>`;
}
