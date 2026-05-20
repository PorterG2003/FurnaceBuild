export type ClientApiErrorShape = {
  error: {
    type: 'invalid_request_error' | 'authentication_error' | 'permission_error' | 'rate_limit_error' | 'api_error';
    code: string;
    message: string;
    param?: string;
  };
};

export class ClientApiError extends Error {
  readonly status: number;
  readonly payload: ClientApiErrorShape;

  constructor(
    status: number,
    code: ClientApiErrorShape['error']['code'],
    message: string,
    type: ClientApiErrorShape['error']['type'] = 'invalid_request_error',
    param?: string
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
    };
  }
}

export function invalidRequest(code: string, message: string, param?: string): never {
  throw new ClientApiError(400, code, message, 'invalid_request_error', param);
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
