import type { SupabaseClient } from '@supabase/supabase-js';

/** Untyped client: generated `Database` omits several tables used by seed scenarios. */
export type SeedSupabase = SupabaseClient;

export interface SeedContext {
  supabase: SeedSupabase;
  scenarioId: string;
  wipe: boolean;
  dryRun: boolean;
  log: (...args: unknown[]) => void;
}

export interface SeedModule {
  id: string;
  description?: string;
  /** Module ids that must run before this one (must exist in `allModules`). */
  deps?: string[];
  run(ctx: SeedContext): Promise<void>;
}
