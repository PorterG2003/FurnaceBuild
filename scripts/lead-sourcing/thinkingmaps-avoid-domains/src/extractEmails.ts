import { decodeEntities, htmlToText } from './lib/html.js';
import { normalizeDomain } from './lib/url.js';
import { isUnusableEmailDomain } from './vendorHosts.js';

const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,24}/g;

export function decodeMailtoTarget(href: string): string {
  let rest = href.replace(/^mailto:/i, '').split('?')[0] ?? '';
  try {
    rest = decodeURIComponent(rest);
  } catch {
    // keep raw
  }
  return decodeEntities(rest).trim();
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase().replace(/[>,;]+$/, '');
}

export function domainFromEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 0) return '';
  return normalizeDomain(email.slice(at + 1));
}

/** mail.lausd.net → lausd.net (block-list exact match still records both). */
export function stripMailPrefix(domain: string): string {
  return domain.replace(/^(mail|smtp|webmail|email|mx|owa)\./i, '');
}

export function isPlausibleStaffEmail(email: string): boolean {
  const normalized = normalizeEmail(email);
  if (!normalized.includes('@')) return false;
  if (/\.(png|jpe?g|gif|svg|webp|css|js|woff2?)$/i.test(normalized)) return false;
  if (/^(noreply|no-reply|donotreply|webmaster|postmaster)@/i.test(normalized)) return false;
  const domain = domainFromEmail(normalized);
  if (!domain || isUnusableEmailDomain(domain)) return false;
  return true;
}

export function extractEmailsFromHtml(html: string): string[] {
  const found = new Set<string>();

  const mailtoRe = /mailto:([^"'>\s]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = mailtoRe.exec(html))) {
    const target = decodeMailtoTarget(`mailto:${match[1]}`);
    const email = normalizeEmail(target);
    if (isPlausibleStaffEmail(email)) found.add(email);
  }

  const text = htmlToText(html);
  for (const raw of text.match(EMAIL_RE) ?? []) {
    const email = normalizeEmail(raw);
    if (isPlausibleStaffEmail(email)) found.add(email);
  }

  return [...found];
}

export type RankedDomain = {
  domain: string;
  count: number;
  stripped: string;
};

export function rankEmailDomains(emails: string[]): RankedDomain[] {
  const counts = new Map<string, number>();
  for (const email of emails) {
    const domain = domainFromEmail(email);
    if (!domain || isUnusableEmailDomain(domain)) continue;
    counts.set(domain, (counts.get(domain) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([domain, count]) => ({ domain, count, stripped: stripMailPrefix(domain) }))
    .sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain));
}

export function pickDominantDomain(ranked: RankedDomain[]): {
  domain: string;
  competing: boolean;
  notes: string[];
} {
  const notes: string[] = [];
  if (ranked.length === 0) return { domain: '', competing: false, notes };

  const top = ranked[0]!;
  const second = ranked[1];
  const competing = Boolean(second && second.count >= top.count && second.domain !== top.domain);

  let domain = top.stripped && !isUnusableEmailDomain(top.stripped) ? top.stripped : top.domain;
  if (top.stripped !== top.domain) {
    notes.push(`stripped_mail_prefix:${top.domain}->${top.stripped}`);
  }
  if (competing) {
    notes.push(`competing_domains:${ranked.slice(0, 3).map((r) => `${r.domain}x${r.count}`).join('|')}`);
  }
  return { domain, competing, notes };
}
