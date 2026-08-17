import { supabase } from '../../client';
import type { Json } from '../../types/database';

export type UserAccountSettings = Record<string, Json | undefined>;

async function requireUserId(): Promise<string> {
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) throw new Error('Not authenticated');
  return userData.user.id;
}

function asSettingsObject(value: unknown): UserAccountSettings {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as UserAccountSettings;
  }
  return {};
}

/** Own row for this account; empty settings object if none. */
export async function getUserAccountPreferences(accountId: string): Promise<UserAccountSettings> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from('user_account_preferences')
    .select('settings')
    .eq('user_id', userId)
    .eq('account_id', accountId)
    .maybeSingle();

  if (error) throw new Error(`Failed to load account preferences: ${error.message}`);
  return asSettingsObject(data?.settings);
}

/** Upsert and shallow-merge `settings` so other keys are not clobbered. */
export async function mergeUserAccountSettings(
  accountId: string,
  patch: UserAccountSettings,
): Promise<UserAccountSettings> {
  const userId = await requireUserId();
  const existing = await getUserAccountPreferences(accountId);
  const settings = { ...existing, ...patch };
  const { error } = await supabase.from('user_account_preferences').upsert(
    {
      user_id: userId,
      account_id: accountId,
      settings,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,account_id' },
  );

  if (error) throw new Error(`Failed to save account preferences: ${error.message}`);
  return settings;
}

/** Remove one settings key. No-op if the row or key is missing. */
export async function deleteUserAccountSetting(
  accountId: string,
  key: string,
): Promise<UserAccountSettings> {
  const userId = await requireUserId();
  const existing = await getUserAccountPreferences(accountId);
  if (!(key in existing)) return existing;

  const { [key]: _removed, ...rest } = existing;
  const { error } = await supabase.from('user_account_preferences').upsert(
    {
      user_id: userId,
      account_id: accountId,
      settings: rest,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,account_id' },
  );

  if (error) throw new Error(`Failed to update account preferences: ${error.message}`);
  return rest;
}
