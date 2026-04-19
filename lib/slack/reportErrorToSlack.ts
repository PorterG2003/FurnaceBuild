/**
 * Report an error to Slack via Incoming Webhook.
 * No-op if SLACK_ERROR_WEBHOOK_URL is not set. Fire-and-forget: does not throw.
 */

import { mergeConciseGatewayError } from './summarizeUpstreamGatewayError.js';

export type AlertSeverity = 'critical' | 'warning';
export type AlertPolicy =
  | 'none'
  | 'transient_retryable_warning'
  | 'persistent_config_warning'
  | 'critical_failure';

export type AlertFieldValue = string | boolean | number | undefined;
export type AlertFields = Record<string, AlertFieldValue>;

type ReportErrorMetadata = {
  severity?: AlertSeverity;
  /**
   * When true (default), Cloudflare/HTML gateway error bodies in `error` are summarized for Slack.
   * Set false to post the raw `error` string (e.g. debugging).
   */
  summarizeGatewayErrors?: boolean;
  /**
   * Shared policy tier used to decide whether repeated alerts should aggregate.
   * Defaults to `none`.
   */
  alertPolicy?: AlertPolicy;
  /**
   * Optional aggregation key. Alerts with the same key are tracked together.
   */
  aggregationKey?: string;
  /**
   * Override the policy's default aggregation window in milliseconds.
   */
  aggregationWindowMs?: number;
  /**
   * Stable fields to carry into summary posts. Defaults to the most recent normalized fields.
   */
  summaryFields?: AlertFields;
  /**
   * Deprecated aliases maintained for compatibility while call sites migrate.
   */
  dedupeKey?: string;
  dedupeWindowMs?: number;
};

export type ReportErrorContext = ReportErrorMetadata & Record<string, AlertFieldValue | AlertFields>;

type ResolvedAggregationMode = 'none' | 'first_and_summary';

type ResolvedAlertPolicy = {
  policy: AlertPolicy;
  aggregationMode: ResolvedAggregationMode;
  aggregationWindowMs: number;
};

type AlertAggregationState = {
  count: number;
  firstSeenAt: number;
  lastSeenAt: number;
  message: string;
  severity: AlertSeverity;
  fields: Record<string, string>;
  summaryFields: Record<string, string>;
  aggregationWindowMs: number;
};

const DEFAULT_AGGREGATION_WINDOW_MS = 60 * 60_000;

const alertAggregationState = new Map<string, AlertAggregationState>();

function resolveAlertPolicy(context?: ReportErrorContext): ResolvedAlertPolicy {
  const hasLegacyAggregation =
    typeof context?.dedupeKey === 'string' && context.dedupeKey.length > 0;
  const policy = context?.alertPolicy ?? (hasLegacyAggregation ? 'persistent_config_warning' : 'none');

  const configuredWindow =
    typeof context?.aggregationWindowMs === 'number' && context.aggregationWindowMs > 0
      ? context.aggregationWindowMs
      : typeof context?.dedupeWindowMs === 'number' && context.dedupeWindowMs > 0
        ? context.dedupeWindowMs
        : undefined;

  switch (policy) {
    case 'transient_retryable_warning':
      return {
        policy,
        aggregationMode: 'first_and_summary',
        aggregationWindowMs: configuredWindow ?? DEFAULT_AGGREGATION_WINDOW_MS,
      };
    case 'persistent_config_warning':
      return {
        policy,
        aggregationMode: 'first_and_summary',
        aggregationWindowMs: configuredWindow ?? DEFAULT_AGGREGATION_WINDOW_MS,
      };
    case 'critical_failure':
      return {
        policy,
        aggregationMode: 'none',
        aggregationWindowMs: configuredWindow ?? 0,
      };
    case 'none':
    default:
      return {
        policy: 'none',
        aggregationMode: 'none',
        aggregationWindowMs: configuredWindow ?? 0,
      };
  }
}

function formatFieldValue(value: AlertFieldValue): string | null {
  if (value === undefined) {
    return null;
  }
  if (typeof value === 'string') {
    return value.length > 0 ? value : null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return null;
}

function toSlackFieldMap(fields: AlertFields): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(fields)) {
    const rendered = formatFieldValue(value);
    if (rendered !== null) {
      result[key] = rendered;
    }
  }
  return result;
}

function normalizeAlertFields(context?: ReportErrorContext): {
  severity: AlertSeverity;
  fields: Record<string, string>;
  summaryFields: Record<string, string>;
} {
  const severity = context?.severity ?? 'warning';
  if (!context) {
    return { severity, fields: {}, summaryFields: {} };
  }

  const summarizeGateway = context.summarizeGatewayErrors !== false;
  const {
    severity: _sev,
    summarizeGatewayErrors: _sum,
    alertPolicy: _policy,
    aggregationKey: _aggregationKey,
    aggregationWindowMs: _aggregationWindowMs,
    summaryFields,
    dedupeKey: _dedupeKey,
    dedupeWindowMs: _dedupeWindowMs,
    ...rest
  } = context;

  let normalizedFields: AlertFields = rest as AlertFields;
  if (summarizeGateway && typeof rest.error === 'string' && rest.error.length > 0) {
    const raw = rest.error;
    const { error: _err, ...withoutError } = rest;
    normalizedFields = mergeConciseGatewayError(withoutError as AlertFields, raw) as AlertFields;
  }

  return {
    severity,
    fields: toSlackFieldMap(normalizedFields),
    summaryFields: toSlackFieldMap(summaryFields ?? normalizedFields),
  };
}

function getAggregationKey(context?: ReportErrorContext): string {
  if (typeof context?.aggregationKey === 'string' && context.aggregationKey.length > 0) {
    return context.aggregationKey;
  }
  if (typeof context?.dedupeKey === 'string' && context.dedupeKey.length > 0) {
    return context.dedupeKey;
  }
  return '';
}

function mergeSeverity(current: AlertSeverity, next: AlertSeverity): AlertSeverity {
  return current === 'critical' || next === 'critical' ? 'critical' : 'warning';
}

function formatWindow(windowMs: number): string {
  if (windowMs % 60_000 === 0) {
    return `${windowMs / 60_000}m`;
  }
  if (windowMs % 1000 === 0) {
    return `${windowMs / 1000}s`;
  }
  return `${windowMs}ms`;
}

function sendSlackMessage(url: string, message: string, severity: AlertSeverity, fields: Record<string, string>): void {
  const parts: string[] = [`*[${severity.toUpperCase()}]* ${message}`];
  for (const [key, value] of Object.entries(fields)) {
    parts.push(`• ${key}: ${value}`);
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

function sendAggregatedSummary(url: string, state: AlertAggregationState): void {
  if (state.count <= 1) {
    return;
  }

  sendSlackMessage(url, `${state.message} (summary)`, state.severity, {
    occurrences: String(state.count),
    window: formatWindow(state.aggregationWindowMs),
    first_seen: new Date(state.firstSeenAt).toISOString(),
    last_seen: new Date(state.lastSeenAt).toISOString(),
    ...state.summaryFields,
  });
}

function trackAggregatedAlert(
  url: string,
  message: string,
  resolvedPolicy: ResolvedAlertPolicy,
  aggregationKey: string,
  severity: AlertSeverity,
  fields: Record<string, string>,
  summaryFields: Record<string, string>,
): void {
  const now = Date.now();
  const existing = alertAggregationState.get(aggregationKey);

  if (!existing) {
    alertAggregationState.set(aggregationKey, {
      count: 1,
      firstSeenAt: now,
      lastSeenAt: now,
      message,
      severity,
      fields,
      summaryFields,
      aggregationWindowMs: resolvedPolicy.aggregationWindowMs,
    });
    sendSlackMessage(url, message, severity, fields);
    return;
  }

  const expired = now - existing.firstSeenAt >= existing.aggregationWindowMs;
  if (expired) {
    sendAggregatedSummary(url, existing);
    const nextState: AlertAggregationState = {
      count: 1,
      firstSeenAt: now,
      lastSeenAt: now,
      message,
      severity,
      fields,
      summaryFields,
      aggregationWindowMs: resolvedPolicy.aggregationWindowMs,
    };
    alertAggregationState.set(aggregationKey, nextState);

    if (existing.count <= 1) {
      sendSlackMessage(url, message, severity, fields);
    }
    return;
  }

  existing.count += 1;
  existing.lastSeenAt = now;
  existing.message = message;
  existing.severity = mergeSeverity(existing.severity, severity);
  existing.fields = fields;
  existing.summaryFields = summaryFields;
}

export function resetSlackAggregationStateForTests(): void {
  alertAggregationState.clear();
}

export function resetSlackDedupeCacheForTests(): void {
  resetSlackAggregationStateForTests();
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

  const resolvedPolicy = resolveAlertPolicy(context);
  const aggregationKey = getAggregationKey(context);
  const { severity, fields, summaryFields } = normalizeAlertFields(context);

  if (resolvedPolicy.aggregationMode === 'first_and_summary' && aggregationKey.length > 0) {
    trackAggregatedAlert(url, message, resolvedPolicy, aggregationKey, severity, fields, summaryFields);
    return;
  }

  sendSlackMessage(url, message, severity, fields);
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
