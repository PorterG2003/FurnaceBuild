import path from 'node:path';
import { createOpenAPI } from 'fumadocs-openapi/server';

export const OPENAPI_DOCUMENT_ID = path.join(process.cwd(), 'public', 'openapi.json');

export const openapi = createOpenAPI({
  input: [OPENAPI_DOCUMENT_ID],
});
