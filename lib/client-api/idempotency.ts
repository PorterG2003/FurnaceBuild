import crypto from 'node:crypto';

export function hashRequestBody(body: string): string {
  return crypto.createHash('sha256').update(body).digest('hex');
}
