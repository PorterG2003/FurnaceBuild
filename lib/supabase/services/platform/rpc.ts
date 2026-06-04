import { supabase } from '../../client';

export const rpc = (supabase as any).rpc.bind(supabase as any) as (
  fn: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
