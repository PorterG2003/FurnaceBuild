import type { ReportErrorContext } from './reportErrorToSlack.js';

/**
 * Detects Cloudflare / Supabase HTML error pages and other obvious transient gateway
 * responses so Slack gets a short summary plus what to do, instead of multi-KB HTML.
 */
export function summarizeUpstreamGatewayError(raw: string): {
  error: string;
  action: string;
  ray_id?: string;
} | null {
  if (typeof raw !== 'string' || raw.length < 40) {
    return null;
  }

  const t = raw.trim();
  // Full CF error pages include DOCTYPE; edge/minimal 502 pages are often just <html>…<center>cloudflare</center>.
  const looksLikeCloudflareHtml =
    (/<!DOCTYPE html/i.test(t) &&
      /cloudflare|cf-error-details|cdn-cgi\/styles\/main\.css/i.test(t)) ||
    (/<html[\s>]/i.test(t) &&
      /\bcloudflare\b/i.test(t) &&
      /\b(50[0-4]|520|521|522|523|524)\b/.test(t));
  if (!looksLikeCloudflareHtml) {
    return null;
  }

  const rayMatch =
    t.match(/Cloudflare Ray ID:\s*(?:<[^>]+>\s*)?([a-fA-F0-9]+)/i) ||
    t.match(/Ray ID:\s*([a-fA-F0-9]+)/i);
  const rayId = rayMatch?.[1];

  const codeMatch = t.match(/Error code (\d{3})/i) || t.match(/\b(502|503|504|520|521|522|523|524)\b/);
  const code = codeMatch ? codeMatch[1] : '502';

  const error = `Transient HTTP ${code} from Supabase (Cloudflare could not get a valid response from origin). Not a bug in our query or scheduler logic.`;

  const action =
    'If this is occasional, retry after a short backoff. If it happens often: check https://status.supabase.com/, your Supabase project logs and metrics, and when contacting Supabase support include the Ray ID below.';

  return rayId ? { error, action, ray_id: rayId } : { error, action };
}

/**
 * True when `message` is (or was derived from) a Cloudflare/Supabase gateway HTML error,
 * including our summarized one-liner after mergeConciseGatewayError.
 */
export function isTransientUpstreamGatewayErrorMessage(message: string): boolean {
  if (typeof message !== 'string' || message.length === 0) {
    return false;
  }
  if (summarizeUpstreamGatewayError(message)) {
    return true;
  }
  return (
    message.includes('Transient HTTP') &&
    message.includes('Cloudflare could not get a valid response from origin')
  );
}

/**
 * If `rawError` looks like an upstream gateway HTML page, replaces it with concise
 * `error`, `action`, and optional `ray_id` fields. Otherwise passes `rawError` through as `error`.
 */
export function mergeConciseGatewayError(
  context: ReportErrorContext,
  rawError: string
): ReportErrorContext {
  const summarized = summarizeUpstreamGatewayError(rawError);
  if (!summarized) {
    return { ...context, error: rawError };
  }
  const out: ReportErrorContext = { ...context, error: summarized.error, action: summarized.action };
  if (summarized.ray_id) {
    out.ray_id = summarized.ray_id;
  }
  return out;
}
