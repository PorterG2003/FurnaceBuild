import { useCallback } from 'react';
import { useRouter, type Href } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { useAccount } from '@/contexts/AccountContext';
import {
  syncMembershipToContext,
  type MembershipActivationResult,
} from '@/lib/account/membershipActivation';

export type EnterWorkspaceOptions = {
  expectedAccountId?: string | null;
  destination: string;
  userId?: string | null;
  email?: string | null;
  maxAttempts?: number;
  delayMs?: number;
  navigate?: boolean;
};

export function membershipActivationFailureMessage(
  result: Exclude<MembershipActivationResult, { kind: 'ready' }>,
  timedOutMessage = 'Workspace setup is taking longer than expected. Please refresh or email support.',
): string {
  if (result.kind === 'timed_out') {
    return timedOutMessage;
  }
  return result.message
    ? `We could not confirm your workspace access yet: ${result.message}`
    : 'We could not confirm your workspace access yet. Please refresh or email support.';
}

export function useEnterWorkspace() {
  const router = useRouter();
  const { user } = useAuth();
  const { refetch } = useAccount();

  const enterWorkspace = useCallback(
    async ({
      expectedAccountId,
      destination,
      userId: userIdOverride,
      email: emailOverride,
      maxAttempts,
      delayMs,
      navigate = true,
    }: EnterWorkspaceOptions): Promise<MembershipActivationResult> => {
      const userId = userIdOverride ?? user?.id;
      if (!userId) {
        return {
          kind: 'error',
          message: 'You must be signed in to enter your workspace.',
        };
      }

      const result = await syncMembershipToContext({
        userId,
        email: emailOverride ?? user?.email ?? null,
        refetch,
        expectedAccountId,
        maxAttempts,
        delayMs,
      });

      if (result.kind === 'ready' && navigate) {
        router.replace(destination as Href);
      }

      return result;
    },
    [refetch, router, user?.email, user?.id],
  );

  return { enterWorkspace };
}
