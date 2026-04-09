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
  const looksLikeCloudflareHtml =
    /<!DOCTYPE html/i.test(t) &&
    /cloudflare|cf-error-details|cdn-cgi\/styles\/main\.css/i.test(t);

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
    'No immediate fix on our side if this is occasional — the scheduler will retry on the next tick. If it happens often: check https://status.supabase.com/, your Supabase project logs and metrics, and when contacting Supabase support include the Ray ID below.';

  return rayId ? { error, action, ray_id: rayId } : { error, action };
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
