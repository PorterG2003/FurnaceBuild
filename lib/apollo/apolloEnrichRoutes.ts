import { createHash, timingSafeEqual } from 'node:crypto';

/** Parse POST /sessions/{sessionId} from a Function URL rawPath. */
export function parseApolloWebhookSessionPath(rawPath: string | undefined): string | null {
  if (!rawPath) return null;
  const normalized = rawPath.replace(/\/+$/, '') || '/';
  const match = normalized.match(/^\/sessions\/([0-9a-f-]{36})$/i);
  return match?.[1] ?? null;
}

/** Build the Function URL base from an incoming Lambda Function URL event (avoids CDK circular deps). */
export function resolveFunctionUrlBase(event: {
  requestContext?: { domainName?: string };
  headers?: Record<string, string | undefined>;
}): string | null {
  const domain = event.requestContext?.domainName?.trim();
  if (domain) {
    return `https://${domain}`;
  }
  const host = event.headers?.host ?? event.headers?.Host;
  if (host?.trim()) {
    return `https://${host.trim()}`;
  }
  return null;
}

/** Build the webhook callback URL for a session. */
export function buildApolloWebhookUrl(baseUrl: string, sessionId: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  return `${trimmed}/sessions/${sessionId}`;
}

/** Verify Apollo webhook signature when a secret is configured. */
export function verifyApolloWebhookSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  secret: string | undefined,
): boolean {
  if (!secret?.trim()) return true;
  if (!signatureHeader?.trim()) return false;
  const expected = createHash('sha256').update(rawBody + secret).digest('hex');
  const provided = signatureHeader.replace(/^sha256=/i, '').trim();
  if (expected.length !== provided.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
  } catch {
    return false;
  }
}

/** Extract phone_numbers from Apollo webhook payload shapes. */
export function extractApolloWebhookPhones(payload: unknown): import('./apolloClient').ApolloPhoneNumber[] {
  if (!payload || typeof payload !== 'object') return [];
  const root = payload as Record<string, unknown>;

  const direct = root.phone_numbers;
  if (Array.isArray(direct)) {
    return direct as import('./apolloClient').ApolloPhoneNumber[];
  }

  const people = root.people ?? root.person;
  if (Array.isArray(people)) {
    for (const entry of people) {
      if (entry && typeof entry === 'object' && Array.isArray((entry as { phone_numbers?: unknown }).phone_numbers)) {
        return (entry as { phone_numbers: import('./apolloClient').ApolloPhoneNumber[] }).phone_numbers;
      }
    }
  }
  if (people && typeof people === 'object' && Array.isArray((people as { phone_numbers?: unknown }).phone_numbers)) {
    return (people as { phone_numbers: import('./apolloClient').ApolloPhoneNumber[] }).phone_numbers;
  }

  return [];
}

/** Postgres unique-violation error code. */
export function isUniqueViolation(error: { code?: string } | null | undefined): boolean {
  return error?.code === '23505';
}
