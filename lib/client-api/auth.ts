import crypto from 'node:crypto';

export interface AuthenticatedApiKey {
  id: string;
  accountId: string;
  name: string;
  secretPrefix: string;
  expiresAt: string | null;
  revokedAt: string | null;
}

export function hashApiKey(secret: string): string {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

export function getBearerToken(headerValue: string | null | undefined): string | null {
  if (!headerValue) return null;
  if (!headerValue.startsWith('Bearer ')) return null;
  const token = headerValue.slice(7).trim();
  return token.length > 0 ? token : null;
}

export function isApiKeyExpired(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) return false;
  return Date.parse(expiresAt) <= Date.now();
}
