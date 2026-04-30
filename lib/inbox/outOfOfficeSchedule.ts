export type OooScheduleMode = 'return_date' | 'instant';

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
 * Resume instant the OOO modal sends as `p_resume_at`: UTC noon on a chosen day, or “now”
 * for immediate resume (`p_resume_at <= NOW()` in `mark_email_thread_out_of_office`).
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
