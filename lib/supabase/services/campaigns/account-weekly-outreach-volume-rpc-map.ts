export interface AccountWeeklyOutreachVolume {
  weekStart: string;
  emailsSent: number;
  leadsFirstContacted: number;
}

export type AccountWeeklyOutreachVolumeRpcRow = {
  week_start: string;
  emails_sent: number | string | null;
  leads_first_contacted: number | string | null;
};

function num(v: number | string | null | undefined): number {
  if (v == null) return 0;
  const n = typeof v === 'string' ? Number(v) : v;
  return Number.isFinite(n) ? n : 0;
}

function toYmd(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return new Date(value).toISOString().slice(0, 10);
}

export function mapAccountWeeklyOutreachVolumeRows(
  rows: AccountWeeklyOutreachVolumeRpcRow[],
): AccountWeeklyOutreachVolume[] {
  return rows.map((r) => ({
    weekStart: toYmd(r.week_start),
    emailsSent: num(r.emails_sent),
    leadsFirstContacted: num(r.leads_first_contacted),
  }));
}
