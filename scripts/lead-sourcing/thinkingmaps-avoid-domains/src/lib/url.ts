export function stripWww(host: string): string {
  return host.replace(/^www\./i, '').toLowerCase();
}

export function hostnameOf(url: string): string {
  try {
    return stripWww(new URL(url.includes('://') ? url : `https://${url}`).hostname);
  } catch {
    return '';
  }
}

export function hostEqualsOrUnder(host: string, root: string): boolean {
  const h = stripWww(host);
  const r = stripWww(root);
  if (!h || !r) return false;
  return h === r || h.endsWith(`.${r}`);
}

export function isSameHost(a: string, b: string): boolean {
  const ha = hostnameOf(a);
  const hb = hostnameOf(b);
  return Boolean(ha && hb && ha === hb);
}

export function homepageUrl(hostOrUrl: string): string {
  const trimmed = hostOrUrl.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${stripWww(trimmed)}`;
}

export function normalizeDomain(raw: string): string {
  let value = raw.trim().toLowerCase();
  if (!value) return '';
  value = value.replace(/^https?:\/\//, '').replace(/^www\./, '');
  value = value.split('/')[0] ?? value;
  value = value.split('?')[0] ?? value;
  value = value.replace(/\.$/, '');
  return value;
}
