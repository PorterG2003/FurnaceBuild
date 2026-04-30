import { createClient } from '@supabase/supabase-js';
import type { SeedContext, SeedSupabase } from './types';

export function createSeedContext(options: {
  scenarioId: string;
  wipe: boolean;
  dryRun: boolean;
}): SeedContext {
  const url = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

  if (!url || !serviceKey) {
    console.error(
      'Seed requires SUPABASE_URL (or EXPO_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY). Do not use the anon/publishable key.'
    );
    process.exit(1);
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as SeedSupabase;

  const log = (...args: unknown[]) => console.log('[seed]', ...args);

  return {
    supabase,
    scenarioId: options.scenarioId,
    wipe: options.wipe,
    dryRun: options.dryRun,
    log,
  };
}
