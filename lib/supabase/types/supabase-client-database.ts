import type { Database as RawDatabase } from './database';

/**
 * Hand-maintained `database.ts` table shapes omit `Relationships`, which
 * @supabase/supabase-js v2.99+ requires on every table for typed `.from()` calls.
 */
export type Database = {
  public: {
    Tables: {
      [K in keyof RawDatabase['public']['Tables']]: RawDatabase['public']['Tables'][K] & {
        Relationships: [];
      };
    };
    Views: RawDatabase['public']['Views'];
    Functions: RawDatabase['public']['Functions'];
    Enums: RawDatabase['public']['Enums'];
  };
};
