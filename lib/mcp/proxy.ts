import type {
  ClientApiProxyRequest,
  ClientApiProxyResult,
} from './types.js';

const DEFAULT_TIMEOUT_MS = 55_000;
const BODY_SNIPPET_MAX = 500;

export type ClientApiProxyOptions = {
  baseUrl: string;
  /** Outbound fetch timeout. Defaults to 55s (under a 60s Lambda). */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

function trimSnippet(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= BODY_SNIPPET_MAX) return trimmed;
  return `${trimmed.slice(0, BODY_SNIPPET_MAX)}…`;
}

function looksLikeHtml(text: string): boolean {
  const trimmed = text.trim().toLowerCase();
  return trimmed.startsWith('<!doctype') || trimmed.startsWith('<html');
}

function shouldIncludeBodySnippet(text: string | undefined, parsedAsJson: boolean): boolean {
  if (!text?.trim()) return false;
  if (looksLikeHtml(text)) return false;
  if (!parsedAsJson) return false;
  return true;
}

function buildUrl(
  baseUrl: string,
  path: string,
  query?: ClientApiProxyRequest['query'],
): string {
  const url = new URL(path.startsWith('/') ? path : `/${path}`, baseUrl.replace(/\/$/, '') + '/');
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function parseErrorBody(text: string): { message?: string; code?: string } {
  try {
    const json = JSON.parse(text) as {
      error?: { message?: string; code?: string };
      message?: string;
    };
    return {
      message: json.error?.message ?? json.message,
      code: json.error?.code,
    };
  } catch {
    return {};
  }
}

/**
 * Forwards a request to the Furnace Client API with the caller's Bearer token.
 */
export async function proxyClientApi(
  options: ClientApiProxyOptions,
  request: ClientApiProxyRequest,
): Promise<ClientApiProxyResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = buildUrl(options.baseUrl, request.path, request.query);

  const headers = new Headers({
    Authorization: request.authorization.startsWith('Bearer ')
      ? request.authorization
      : `Bearer ${request.authorization}`,
    Accept: 'application/json',
  });
  if (request.accountId) {
    headers.set('X-Furnace-Account-Id', request.accountId);
  }
  if (request.idempotencyKey) {
    headers.set('Idempotency-Key', request.idempotencyKey);
  }

  const method = request.method.toUpperCase();
  let body: string | undefined;
  if (request.body !== undefined && method !== 'GET' && method !== 'DELETE') {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(request.body);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = () => controller.abort();
  request.signal?.addEventListener('abort', onExternalAbort);

  try {
    const response = await fetchImpl(url, {
      method,
      headers,
      body,
      signal: controller.signal,
    });
    const text = await response.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    if (!response.ok) {
      const parsedAsJson = typeof data === 'object' && data !== null;
      const parsed = parsedAsJson
        ? parseErrorBody(JSON.stringify(data))
        : parseErrorBody(text);
      return {
        ok: false,
        status: response.status,
        error: {
          message:
            parsed.message ||
            `Client API request failed with status ${response.status}`,
          status: response.status,
          bodySnippet: shouldIncludeBodySnippet(text, parsedAsJson)
            ? trimSnippet(text)
            : undefined,
          code: parsed.code,
        },
      };
    }

    return { ok: true, status: response.status, data };
  } catch (err) {
    const aborted =
      (err instanceof Error && err.name === 'AbortError') ||
      request.signal?.aborted ||
      controller.signal.aborted;
    if (aborted) {
      return {
        ok: false,
        status: 504,
        error: {
          message: `Client API request timed out after ${timeoutMs}ms`,
          status: 504,
          code: 'timeout',
        },
      };
    }
    return {
      ok: false,
      status: 502,
      error: {
        message: err instanceof Error ? err.message : 'Client API request failed',
        status: 502,
        code: 'proxy_error',
      },
    };
  } finally {
    clearTimeout(timeout);
    request.signal?.removeEventListener('abort', onExternalAbort);
  }
}

export function formatProxyFailureForTool(failure: Extract<ClientApiProxyResult, { ok: false }>): string {
  const parts = [
    `Client API error ${failure.error.status}: ${failure.error.message}`,
  ];
  if (failure.error.code) parts.push(`code=${failure.error.code}`);
  if (failure.error.bodySnippet) parts.push(failure.error.bodySnippet);
  return parts.join('\n');
}
