import { useAccount } from '@/contexts/AccountContext';

export function useAccountBillingStatus(accountId: string | null) {
  const { account, billing, loading, error } = useAccount();
  const matchesAccount = accountId != null && account?.id === accountId;

  return {
    billing: matchesAccount ? billing : null,
    loading: accountId != null && loading,
    error: matchesAccount ? error : null,
    isFrontendBlocked: matchesAccount ? billing?.billing_status === 'payment_required' : false,
  };
}
