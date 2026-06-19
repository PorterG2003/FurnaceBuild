export type OooScheduleMode = 'return_date' | 'instant';
export type OooQuickResumePreset = 'dated' | 'month' | 'instant';

/** Parse YYYY-MM-DD and return ISO string for that calendar day at 12:00 UTC. */
export function utcNoonIsoFromYmd(ymd: string): string | null {
  const m = ymd.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo, d, 12, 0, 0));
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString();
}

/**
 * Resume instant the OOO modal sends to the unified OOO facade:
 * UTC noon on a chosen day, or “now” for immediate resume.
 */
export function computeOooResumeAtIso(params: {
  resumeCampaign: boolean;
  mode: OooScheduleMode;
  returnDateYmd: string;
  /** When `mode` is `instant`; defaults to `new Date()` (override in tests). */
  instantNow?: Date;
}): string | null {
  if (!params.resumeCampaign) return null;
  if (params.mode === 'instant') {
    return (params.instantNow ?? new Date()).toISOString();
  }
  const ymd = params.returnDateYmd.trim();
  if (!ymd) return null;
  return utcNoonIsoFromYmd(ymd);
}

export function computeOooQuickResumeAtIso(params: {
  preset: OooQuickResumePreset;
  returnDateYmd?: string | null;
  /** Used for `instant` and `month`; defaults to `new Date()` (override in tests). */
  instantNow?: Date;
}): string | null {
  if (params.preset === 'instant') {
    return (params.instantNow ?? new Date()).toISOString();
  }

  if (params.preset === 'month') {
    const now = params.instantNow ?? new Date();
    return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
  }

  const ymd = params.returnDateYmd?.trim() ?? '';
  if (!ymd) return null;
  return utcNoonIsoFromYmd(ymd);
}
