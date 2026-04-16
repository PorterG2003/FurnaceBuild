/**
 * Iowa SOS / Akamai rate-limit and captcha interstitial detection.
 * When tripped, users are often sent to paths like `/ratelimit/captcha` with copy about a bird.
 */

const RATE_PATH_RE = /\/ratelimit\//i;
/** Iowa interstitial copy — avoid generic “rate limit” strings (they appear in third‑party scripts on normal pages). */
const RATE_HINTS = ['bird flew away', 'bird flew', 'a bird flew'];

export function looksLikeIowaSosRateLimitUrl(url: string): boolean {
  const u = url.trim();
  if (!u) return false;
  if (RATE_PATH_RE.test(u)) return true;
  if (/captcha/i.test(u) && /ratelimit|rate-limit|rate_limit/i.test(u)) return true;
  return false;
}

export function looksLikeIowaSosRateLimitBody(html: string): boolean {
  const h = html.toLowerCase();
  for (const phrase of RATE_HINTS) {
    if (h.includes(phrase)) return true;
  }
  if (h.includes('g-recaptcha') && h.includes('ratelimit')) return true;
  return false;
}

export function isIowaSosRateLimitedPage(url: string, html: string): boolean {
  return looksLikeIowaSosRateLimitUrl(url) || looksLikeIowaSosRateLimitBody(html);
}

export function rateLimitBackoffMs(attemptIndex: number): number {
  const base = Number(process.env.IOWA_RATELIMIT_BACKOFF_BASE_MS ?? '45000');
  const step = Number(process.env.IOWA_RATELIMIT_BACKOFF_STEP_MS ?? '35000');
  const cap = Number(process.env.IOWA_RATELIMIT_BACKOFF_CAP_MS ?? '240000');
  const raw = base + attemptIndex * step + Math.floor(Math.random() * 12_000);
  return Math.min(raw, cap);
}
