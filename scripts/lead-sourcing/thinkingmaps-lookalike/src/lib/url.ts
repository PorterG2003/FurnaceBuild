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

export function originOf(url: string): string {
  try {
    const parsed = new URL(url.includes('://') ? url : `https://${url}`);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return '';
  }
}

export function hostFromAny(raw: string): string {
  const value = raw.trim();
  if (!value) return '';
  return hostnameOf(value);
}

export function sameRegistrableHost(a: string, b: string): boolean {
  const left = stripWww(a);
  const right = stripWww(b);
  if (!left || !right) return false;
  return left === right || left.endsWith(`.${right}`) || right.endsWith(`.${left}`);
}

export function isFetchableUrl(url: string): boolean {
  const value = url.trim();
  if (!/^https?:\/\//i.test(value)) return false;
  if (/\s/.test(value)) return false;
  try {
    return Boolean(new URL(value).hostname);
  } catch {
    return false;
  }
}

export function toWebsite(raw: string): string {
  const value = raw.trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) {
    try {
      const parsed = new URL(value);
      parsed.hash = '';
      parsed.search = '';
      const path = parsed.pathname === '/' ? '/' : parsed.pathname.replace(/\/+$/, '') || '/';
      return `${parsed.protocol}//${parsed.host}${path === '/' ? '/' : path}`;
    } catch {
      return value;
    }
  }
  const host = hostFromAny(value);
  return host ? `https://www.${host}/` : '';
}
