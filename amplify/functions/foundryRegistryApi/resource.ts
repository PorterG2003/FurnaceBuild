import { defineFunction, secret } from '@aws-amplify/backend';

/**
 * Foundry registry API — Function URL + Supabase JWT.
 *
 * Environment:
 * - SUPABASE_URL: injected in amplify/backend.ts from EXPO_PUBLIC_SUPABASE_URL at synth
 * - LEADS_SUPABASE_URL: injected in amplify/backend.ts from process.env.LEADS_SUPABASE_URL
 * - FOUNDRY_NORMALIZE_STATE_MACHINE_ARN: injected in amplify/backend.ts from the normalize state machine
 * - SUPABASE_SECRET_KEY, LEADS_SUPABASE_SECRET_KEY: Amplify secrets
 */
export const foundryRegistryApi = defineFunction({
  name: 'foundryRegistryApi',
  entry: './handler.ts',
  memoryMB: 512,
  timeoutSeconds: 60,
  environment: {
    SUPABASE_SECRET_KEY: secret('SUPABASE_SECRET_KEY'),
    LEADS_SUPABASE_SECRET_KEY: secret('LEADS_SUPABASE_SECRET_KEY'),
  },
});
