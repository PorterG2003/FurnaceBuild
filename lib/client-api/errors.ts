export type ClientApiErrorShape = {
  error: {
    type: 'invalid_request_error' | 'authentication_error' | 'permission_error' | 'rate_limit_error' | 'api_error';
    code: string;
    message: string;
    param?: string;
  };
  details?: Array<{
    path: string;
    code: string;
    message: string;
  }>;
  current_flow_revision?: string;
};

export class ClientApiError extends Error {
  readonly status: number;
  readonly payload: ClientApiErrorShape;

  constructor(
    status: number,
    code: ClientApiErrorShape['error']['code'],
    message: string,
    type: ClientApiErrorShape['error']['type'] = 'invalid_request_error',
    param?: string,
    details?: ClientApiErrorShape['details'],
    extensions?: Pick<ClientApiErrorShape, 'current_flow_revision'>,
  ) {
    super(message);
    this.name = 'ClientApiError';
    this.status = status;
    this.payload = {
      error: {
        type,
        code,
        message,
        ...(param ? { param } : {}),
      },
      ...(details?.length ? { details } : {}),
      ...(extensions?.current_flow_revision
        ? { current_flow_revision: extensions.current_flow_revision }
        : {}),
    };
  }
}

export function invalidRequest(code: string, message: string, param?: string): never {
  throw new ClientApiError(400, code, message, 'invalid_request_error', param);
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** Throws invalid_request_error / invalid_id when value is not a UUID. */
export function assertUuid(value: string, paramName = 'id'): asserts value is string {
  if (!isUuid(value)) {
    invalidRequest('invalid_id', `${paramName} must be a UUID`, paramName);
  }
}

/** Reject strings that contain NUL (Postgres rejects these as unicode escapes). */
export function assertNoNul(value: string, paramName: string): void {
  if (value.includes('\0')) {
    invalidRequest('invalid_string', `${paramName} contains invalid characters`, paramName);
  }
}

export function invalidRequestWithDetails(
  code: string,
  message: string,
  details: NonNullable<ClientApiErrorShape['details']>,
  param?: string,
): never {
  throw new ClientApiError(400, code, message, 'invalid_request_error', param, details);
}

export function unauthorized(code: string, message: string): never {
  throw new ClientApiError(401, code, message, 'authentication_error');
}

export function forbidden(code: string, message: string): never {
  throw new ClientApiError(403, code, message, 'permission_error');
}

export function notFound(code: string, message: string): never {
  throw new ClientApiError(404, code, message, 'invalid_request_error');
}

export function rateLimited(code: string, message: string): never {
  throw new ClientApiError(429, code, message, 'rate_limit_error');
}

export function flowRevisionConflict(currentFlowRevision: string, message = 'Flow revision conflict'): never {
  throw new ClientApiError(
    412,
    'flow_revision_conflict',
    message,
    'invalid_request_error',
    undefined,
    undefined,
    { current_flow_revision: currentFlowRevision },
  );
}
