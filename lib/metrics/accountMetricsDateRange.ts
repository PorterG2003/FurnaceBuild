/** UTC calendar day `YYYY-MM-DD` from an instant (uses `toISOString`). */
export function ymdUtcFromInstant(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export const ACCOUNT_METRICS_DATE_PRESET_IDS = [
  'last_7',
  'last_30',
  'last_90',
  'ytd',
  'last_365',
] as const;

export type AccountMetricsDatePresetId = (typeof ACCOUNT_METRICS_DATE_PRESET_IDS)[number];

export function presetRange(
  presetId: AccountMetricsDatePresetId,
  now: Date,
): { start: string; end: string } {
  const end = ymdUtcFromInstant(now);
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const day = now.getUTCDate();

  switch (presetId) {
    case 'last_7': {
      const start = ymdUtcFromInstant(new Date(Date.UTC(y, m, day - 6)));
      return { start, end };
    }
    case 'last_30': {
      const start = ymdUtcFromInstant(new Date(Date.UTC(y, m, day - 29)));
      return { start, end };
    }
    case 'last_90': {
      const start = ymdUtcFromInstant(new Date(Date.UTC(y, m, day - 89)));
      return { start, end };
    }
    case 'ytd':
      return { start: `${y}-01-01`, end };
    case 'last_365': {
      const start = ymdUtcFromInstant(new Date(Date.UTC(y, m, day - 364)));
      return { start, end };
    }
  }
}

export function defaultMetricsDateRange(now: Date = new Date()): {
  start: string;
  end: string;
} {
  return presetRange('last_30', now);
}

export function findMatchingPreset(
  start: string,
  end: string,
  now: Date = new Date(),
): AccountMetricsDatePresetId | 'custom' {
  for (const id of ACCOUNT_METRICS_DATE_PRESET_IDS) {
    const r = presetRange(id, now);
    if (r.start === start && r.end === end) {
      return id;
    }
  }
  return 'custom';
}
