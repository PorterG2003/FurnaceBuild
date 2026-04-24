import { supabase } from '@/lib/supabase/client';

/** Known keys — add more as features ship; grant via service role INSERT. */
export const ACCESS_FLAG_FOUNDRY = 'foundry' as const;
export const ACCESS_FLAG_FLUX = 'flux' as const;

/** True if the user has the given flag row (service-managed). */
export async function getUserHasAccessFlag(userId: string, flagKey: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('user_access_flags')
    .select('user_id')
    .eq('user_id', userId)
    .eq('flag_key', flagKey)
    .maybeSingle();

  if (error) {
    console.warn('[user-access-flags]', error.message);
    return false;
  }
  return data != null;
}

export function getUserHasFoundryAccess(userId: string): Promise<boolean> {
  return getUserHasAccessFlag(userId, ACCESS_FLAG_FOUNDRY);
}

export function getUserHasFluxAccess(userId: string): Promise<boolean> {
  return getUserHasAccessFlag(userId, ACCESS_FLAG_FLUX);
}
