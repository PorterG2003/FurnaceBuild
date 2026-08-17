import type { Account } from '../../types';
import { rpc } from './rpc';

export type AccountManager = 'porter' | 'kyle';

/**
 * Platform-admin owner for Need Help strategy/check-in routing.
 * Pass `null` to clear the override (runtime defaults to Porter).
 */
export async function adminSetAccountManager(
  accountId: string,
  manager: AccountManager | null,
): Promise<Account> {
  const { data, error } = await rpc('admin_set_account_manager', {
    p_account_id: accountId,
    p_manager: manager,
  });
  if (error) throw new Error(error.message);
  return data as Account;
}
