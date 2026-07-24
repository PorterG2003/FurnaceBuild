import type { APIGatewayProxyStructuredResultV2, LambdaFunctionURLEvent } from 'aws-lambda';
import { app } from './app.js';

function isBinaryContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  const normalized = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  return (
    normalized.startsWith('image/') ||
    normalized === 'application/octet-stream' ||
    normalized === 'application/font-woff' ||
    normalized === 'application/font-woff2'
  );
}

export async function handler(
  event: LambdaFunctionURLEvent,
): Promise<APIGatewayProxyStructuredResultV2> {
  const url = new URL(event.rawPath || '/', 'https://mcp.internal');
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
  const contentType = response.headers.get('content-type');
  if (isBinaryContentType(contentType)) {
    const bytes = Buffer.from(await response.arrayBuffer());
    return {
      statusCode: response.status,
      headers: responseHeaders,
      body: bytes.toString('base64'),
      isBase64Encoded: true,
    };
  }
  return {
    statusCode: response.status,
    headers: responseHeaders,
    body: await response.text(),
  };
}
