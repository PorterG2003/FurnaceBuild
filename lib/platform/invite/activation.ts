import {
  pollMembershipVisibility,
  type MembershipActivationResult,
} from '@/lib/account/membershipActivation';
import type { AccountMembership } from '@/lib/supabase/services/accounts';

export type InviteActivationPollResult =
  | { kind: 'ready' }
  | { kind: 'timed_out' }
  | { kind: 'error'; message: string };

/** @deprecated Prefer syncMembershipToContext / useEnterWorkspace from lib/account */
export async function waitForInviteActivation(args: {
  checkMemberships: () => Promise<number>;
  maxAttempts?: number;
  delayMs?: number;
}): Promise<InviteActivationPollResult> {
  const result = await pollMembershipVisibility({
    maxAttempts: args.maxAttempts,
    delayMs: args.delayMs,
    async fetchMemberships() {
      const count = await args.checkMemberships();
      if (count <= 0) return [];
      return [
        {
          account: { id: '__legacy__' },
          membership: { is_owner: true },
        } as AccountMembership,
      ];
    },
  });

  if (result.kind === 'ready') {
    return { kind: 'ready' };
  }

  return result as Exclude<MembershipActivationResult, { kind: 'ready' }>;
}

export { pollMembershipVisibility, syncMembershipToContext } from '@/lib/account/membershipActivation';
