import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AccountMembership } from '@/lib/supabase/services/accounts';
import type { AccountBilling, AccountUser, BlockListEntry, Invitation, User } from '@/lib/supabase/types';
import type { PlatformAdminAccessStatus } from '@/lib/account/platformAdminAccess';

const CACHE_KEY = 'furnace:account-cache';

export interface CachedAccountState {
  userId: string;
  user: User;
  memberships: AccountMembership[];
  currentAccountId: string | null;
  teamMembers: Array<{ user: User; membership: AccountUser }>;
  invitations: Invitation[];
  blockList: BlockListEntry[];
  platformAdminAccess: Exclude<PlatformAdminAccessStatus, 'loading'>;
  billing: AccountBilling | null;
  cachedAt: number;
}

export async function loadAccountCache(userId: string): Promise<CachedAccountState | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as CachedAccountState;
    if (parsed.userId !== userId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function saveAccountCache(userId: string, state: Omit<CachedAccountState, 'userId' | 'cachedAt'>): Promise<void> {
  try {
    const payload: CachedAccountState = {
      userId,
      ...state,
      cachedAt: Date.now(),
    };
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch {
    // Cache persistence is best-effort.
  }
}

export async function clearAccountCache(): Promise<void> {
  try {
    await AsyncStorage.removeItem(CACHE_KEY);
  } catch {
    // Cache clearing is best-effort.
  }
}
