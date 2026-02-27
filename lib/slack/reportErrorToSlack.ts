/**
 * Report an error to Slack via Incoming Webhook.
 * No-op if SLACK_ERROR_WEBHOOK_URL is not set. Fire-and-forget: does not throw.
 */

export interface ReportErrorContext {
  severity?: 'critical' | 'warning';
  [key: string]: string | undefined;
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
    const rest = { ...context };
    delete rest.severity;
    for (const [key, value] of Object.entries(rest)) {
      if (value !== undefined && value !== '') {
        parts.push(`• ${key}: ${String(value)}`);
      }
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
