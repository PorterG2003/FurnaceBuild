import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import type { LambdaFunctionURLEvent } from 'aws-lambda';
import { app } from './app.js';

export async function handler(
  event: LambdaFunctionURLEvent
): Promise<APIGatewayProxyStructuredResultV2> {
  const url = new URL(event.rawPath || '/', 'https://client-api.internal');
  if (event.rawQueryString) {
    url.search = event.rawQueryString;
  }
  const headers = new Headers();
  for (const [key, value] of Object.entries(event.headers ?? {})) {
    if (typeof value === 'string') headers.set(key, value);
  }
  const request = new Request(url.toString(), {
    method: event.requestContext.http.method,
    headers,
    body:
      event.body == null
        ? undefined
        : event.isBase64Encoded
          ? Buffer.from(event.body, 'base64')
          : event.body,
  });
  const response = await app.fetch(request);
  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });
  return {
    statusCode: response.status,
    headers: responseHeaders,
    body: await response.text(),
  };
}
