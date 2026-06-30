import type { Account } from '../../types';
import { rpc } from './rpc';

export type OnboardingSegment = 'self_serve' | 'dfy';

/**
 * Platform-admin override for an account's onboarding audience. Pass `null` to
 * clear the override and fall back to runtime derivation from the billing
 * agreement type.
 */
export async function adminSetAccountOnboardingSegment(
  accountId: string,
  segment: OnboardingSegment | null,
): Promise<Account> {
  const { data, error } = await rpc('admin_set_account_onboarding_segment', {
    p_account_id: accountId,
    p_segment: segment,
  });
  if (error) throw new Error(error.message);
  return data as Account;
}
