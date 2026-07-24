import { ClientApiError } from './errors.js';

export type MappedClientApiError = {
  status: number;
  code: string;
  message: string;
  type: ClientApiError['payload']['error']['type'];
};

function looksLikeHtml(message: string): boolean {
  const trimmed = message.trim().toLowerCase();
  return trimmed.includes('<!doctype') || trimmed.includes('<html');
}

function sanitizePublicMessage(message: string): string {
  if (looksLikeHtml(message)) {
    return 'Upstream request failed';
  }
  // Avoid dumping huge gateway bodies into API clients.
  if (message.length > 500) {
    return `${message.slice(0, 500)}…`;
  }
  return message;
}

/**
 * Map bare thrown Errors (often wrapping PostgREST/Postgres/gateway text) to
 * structured Client API responses. Returns null to keep generic 500 handling
 * (after HTML sanitization by the caller).
 */
export function mapClientApiThrownError(err: unknown): MappedClientApiError | null {
  const raw = err instanceof Error ? err.message : String(err);
  const message = raw;

  if (/invalid input syntax for type uuid/i.test(message)) {
    return {
      status: 400,
      code: 'invalid_id',
      message: 'One or more ids must be a UUID',
      type: 'invalid_request_error',
    };
  }
  if (/invalid input syntax for type timestamp/i.test(message)) {
    return {
      status: 400,
      code: 'invalid_datetime',
      message: 'date_from/date_to must be a valid ISO-8601 datetime',
      type: 'invalid_request_error',
    };
  }
  if (/unsupported Unicode escape sequence/i.test(message)) {
    return {
      status: 400,
      code: 'invalid_string',
      message: 'String contains invalid characters',
      type: 'invalid_request_error',
    };
  }

  return null;
}

export function publicErrorMessageFromThrown(err: unknown): string {
  const mapped = mapClientApiThrownError(err);
  if (mapped) return mapped.message;
  const raw = err instanceof Error ? err.message : String(err);
  return sanitizePublicMessage(raw) || 'Internal server error';
}
