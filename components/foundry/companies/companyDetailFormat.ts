import type { CompanyEntityMatchRow, CompanySourceLinkRow } from '@/lib/foundry/registry-types';

export function formatDetailTimestamp(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function dash<T>(v: T | null | undefined): string {
  if (v == null || v === '') return '—';
  return String(v);
}

/** Display link score: integer or ratio in 0..1. */
export function formatLinkScoreDisplay(score: number | null): string {
  if (score == null) return '—';
  if (score >= 0 && score <= 1) return `${Math.round(score * 100)}%`;
  return String(score);
}

export function formatEntityMatchScore(row: CompanyEntityMatchRow): string {
  const s = row.match_score;
  if (s == null) return '—';
  if (s >= 0 && s <= 1) return `${Math.round(s * 100)}%`;
  return String(s);
}

export function sourceLinkSortKey(row: CompanySourceLinkRow): number {
  const t = new Date(row.created_at).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/** Ensure a browser-openable http(s) URL from a user-typed or imported website field. */
export function normalizeWebsiteHref(raw: string): string {
  const t = raw.trim();
  if (!t) return '';
  if (/^https?:\/\//i.test(t)) return t;
  return `https://${t}`;
}

export function statusBadgeClass(status: string): string {
  const s = status.toLowerCase();
  if (s === 'linked') return 'text-emerald-400/95 bg-emerald-500/15 border-emerald-500/35';
  if (s === 'promoted') return 'text-violet-300/95 bg-violet-500/15 border-violet-500/40';
  if (s === 'candidate') return 'text-amber-400/95 bg-amber-500/12 border-amber-500/35';
  if (s === 'rejected') return 'text-red-400/95 bg-red-500/12 border-red-500/35';
  return 'text-gray-400 bg-[#2A2A2A] border-[#3A3A3A]';
}
