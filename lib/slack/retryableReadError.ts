import { isTransientUpstreamGatewayErrorMessage } from './summarizeUpstreamGatewayError.js';

export type RetryableReadErrorInput =
  | string
  | {
      message?: string | null;
      code?: string | null;
      details?: string | null;
      hint?: string | null;
      status?: number | null;
      name?: string | null;
    }
  | null
  | undefined;

function getErrorMessage(input: RetryableReadErrorInput): string {
  if (typeof input === 'string') {
    return input;
  }
  return input?.message ?? '';
}

function getErrorStatus(input: RetryableReadErrorInput): number | null {
  if (typeof input === 'string') {
    return null;
  }
  return typeof input?.status === 'number' ? input.status : null;
}

const RETRYABLE_READ_PATTERNS = [
  /upstream request timeout/i,
  /canceling statement due to statement timeout/i,
  /jwt issued at future/i,
  /gateway timeout/i,
  /could not query the database for the schema cache\. retrying\./i,
  /code=pgrst002/i,
];

export function isRetryableSupabaseReadError(input: RetryableReadErrorInput): boolean {
  const message = getErrorMessage(input).trim();
  const status = getErrorStatus(input);

  if (!message && status === null) {
    return false;
  }

  if (status !== null && [408, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524].includes(status)) {
    return true;
  }

  if (isTransientUpstreamGatewayErrorMessage(message)) {
    return true;
  }

  return RETRYABLE_READ_PATTERNS.some((pattern) => pattern.test(message));
}
