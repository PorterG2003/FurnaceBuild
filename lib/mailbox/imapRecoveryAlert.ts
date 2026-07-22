const SYSTEMIC_INFRA_CODES = new Set([
  'ECONNECTION',
  'ECONNREFUSED',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'ENOTFOUND',
  'ETIMEDOUT',
]);

export interface ImapRecoveryFailure {
  host: string;
  code?: string | null;
  message: string;
}

export function inferImapInfraFailureCode(failure: {
  code?: string | null;
  message?: string | null;
}): string | null {
  const explicit = failure.code?.trim().toUpperCase();
  if (explicit && SYSTEMIC_INFRA_CODES.has(explicit)) {
    return explicit;
  }

  const message = failure.message ?? '';
  if (/getaddrinfo ENOTFOUND/i.test(message)) return 'ENOTFOUND';
  if (/ECONNREFUSED/i.test(message)) return 'ECONNREFUSED';
  if (/ETIMEDOUT/i.test(message)) return 'ETIMEDOUT';
  if (/ECONNECTION/i.test(message)) return 'ECONNECTION';
  if (/ENETUNREACH/i.test(message)) return 'ENETUNREACH';
  if (/EHOSTUNREACH/i.test(message)) return 'EHOSTUNREACH';
  return null;
}

/** Recovery: same infra code against the same host across the whole batch. */
export function isSystemicInfraFailure(failures: ImapRecoveryFailure[]): boolean {
  if (failures.length === 0) {
    return false;
  }

  const inferred = failures.map((failure) => ({
    host: failure.host,
    code: inferImapInfraFailureCode(failure),
  }));
  const firstCode = inferred[0]?.code;
  const firstHost = inferred[0]?.host;

  if (!firstCode || !firstHost) {
    return false;
  }

  return inferred.every((failure) => failure.code === firstCode && failure.host === firstHost);
}

/** Hot path: every failure in the batch is an infra-class connect error (any host). */
export function allFailuresAreInfraClass(failures: ImapRecoveryFailure[]): boolean {
  if (failures.length === 0) {
    return false;
  }

  return failures.every((failure) => inferImapInfraFailureCode(failure) != null);
}
