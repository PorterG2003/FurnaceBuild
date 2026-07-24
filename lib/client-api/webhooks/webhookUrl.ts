/**
 * Isomorphic webhook URL policy (safe for Node + Expo client).
 * Requires public HTTPS; rejects localhost, private IPs, link-local, and userinfo.
 */

function isIpv4PrivateOrLocal(hostname: string): boolean {
  const parts = hostname.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

/** Decode IPv4-mapped IPv6 (::ffff:a.b.c.d or ::ffff:7f00:1) to dotted IPv4. */
function ipv4FromMappedIpv6(hostname: string): string | null {
  const dotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(hostname);
  if (dotted?.[1]) return dotted[1];

  // Node's URL often rewrites ::ffff:127.0.0.1 → ::ffff:7f00:1
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(hostname);
  if (!hex) return null;
  const hi = Number.parseInt(hex[1], 16);
  const lo = Number.parseInt(hex[2], 16);
  if (!Number.isFinite(hi) || !Number.isFinite(lo) || hi < 0 || hi > 0xffff || lo < 0 || lo > 0xffff) {
    return null;
  }
  const value = ((hi << 16) >>> 0) + lo;
  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ].join('.');
}

function isIpv6PrivateOrLocal(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === '::1' || h === '::') return true;
  if (h.startsWith('fe80:') || h.startsWith('fe8') || h.startsWith('fe9') || h.startsWith('fea') || h.startsWith('feb')) {
    return true; // link-local
  }
  if (h.startsWith('fc') || h.startsWith('fd')) return true; // ULA

  const mappedIpv4 = ipv4FromMappedIpv6(h);
  if (mappedIpv4) return isIpv4PrivateOrLocal(mappedIpv4);

  return false;
}

function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === 'metadata.google.internal') return true;
  if (host.endsWith('.local') || host.endsWith('.internal')) return true;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
    return isIpv4PrivateOrLocal(host);
  }
  if (host.includes(':')) {
    return isIpv6PrivateOrLocal(host);
  }
  return false;
}

/**
 * Returns true only for public https webhook endpoints.
 */
export function isValidHttpsWebhookUrl(url: string): boolean {
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== 'https:') return false;
    if (parsed.username || parsed.password) return false;
    if (isBlockedHostname(parsed.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}
