/**
 * Report an error to Slack via Incoming Webhook.
 * No-op if SLACK_ERROR_WEBHOOK_URL is not set. Fire-and-forget: does not throw.
 */

import { mergeConciseGatewayError } from './summarizeUpstreamGatewayError.js';

export interface ReportErrorContext {
  severity?: 'critical' | 'warning';
  /**
   * When true (default), Cloudflare/HTML gateway error bodies in `error` are summarized for Slack.
   * Set false to post the raw `error` string (e.g. debugging).
   */
  summarizeGatewayErrors?: boolean;
  [key: string]: string | boolean | undefined;
}

/**
 * Send an error message to the configured Slack error channel.
 * Reads process.env.SLACK_ERROR_WEBHOOK_URL. If missing or empty, returns without doing anything.
 * On network failure, logs and returns without throwing so callers are not affected.
 */
export function reportErrorToSlack(
  message: string,
  context?: ReportErrorContext
): void {
  const url = process.env.SLACK_ERROR_WEBHOOK_URL?.trim();
  if (!url) {
    return;
  }

  const severity = context?.severity ?? 'warning';
  const parts: string[] = [`*[${severity.toUpperCase()}]* ${message}`];
  if (context) {
    const summarizeGateway = context.summarizeGatewayErrors !== false;
    const { severity: _sev, summarizeGatewayErrors: _sum, ...rest } = context;

    let fields: ReportErrorContext = rest;

    if (summarizeGateway && typeof rest.error === 'string' && rest.error.length > 0) {
      const raw = rest.error;
      const { error: _err, ...withoutError } = rest;
      fields = mergeConciseGatewayError(withoutError as ReportErrorContext, raw);
    }

    for (const [key, value] of Object.entries(fields)) {
      if (typeof value !== 'string' || value === '') {
        continue;
      }
      parts.push(`• ${key}: ${value}`);
    }
  }
  const text = parts.join('\n');

  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  }).catch((err) => {
    console.error('[reportErrorToSlack] Failed to post to Slack:', err?.message ?? err);
  });
}

/**
 * Stringify thrown values for logs and Slack. Supabase Postgrest/RPC errors are often
 * plain objects with `message`, not `instanceof Error`, so `String(err)` becomes "[object Object]".
 */
export function formatUnknownError(error: unknown): string {
  if (error === null || error === undefined) {
    return String(error);
  }
  if (error instanceof Error) {
    return error.message || error.name || String(error);
  }
  if (typeof error === 'object') {
    const o = error as Record<string, unknown>;
    if (typeof o.message === 'string' && o.message.length > 0) {
      const parts = [o.message];
      if (typeof o.code === 'string' && o.code.length > 0) {
        parts.push(`code=${o.code}`);
      }
      if (typeof o.details === 'string' && o.details.length > 0 && o.details !== o.message) {
        parts.push(o.details);
      }
      return parts.join(' | ');
    }
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
