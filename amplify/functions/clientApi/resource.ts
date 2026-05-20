import { defineFunction, secret } from '@aws-amplify/backend';

/**
 * Client API — public account API keys, OpenAPI docs, and Furnace REST resources.
 *
 * Environment:
 * - SUPABASE_URL: injected in amplify/backend.ts from EXPO_PUBLIC_SUPABASE_URL
 * - SUPABASE_SECRET_KEY: Amplify secret
 * - CLIENT_API_BASE_URL: injected in amplify/backend.ts for absolute docs/spec links
 * - CLIENT_API_DOCS_ORIGIN: optional branded origin override for docs
 * - CLIENT_API_WEBHOOK_QUEUE_URL / CLIENT_API_IMPORT_QUEUE_URL: optional embedded queue URLs
 */
export const clientApi = defineFunction({
  name: 'clientApi',
  entry: './handler.ts',
  memoryMB: 1024,
  timeoutSeconds: 60,
  environment: {
    SUPABASE_SECRET_KEY: secret('SUPABASE_SECRET_KEY'),
  },
});
