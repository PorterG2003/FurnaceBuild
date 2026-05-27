import { useAccount } from '@/contexts/AccountContext';
import { resolveAccountBootstrap, type AccountBootstrapState } from './resolveAccountBootstrap';

export type { AccountBootstrapState };

export function useAccountBootstrap(): AccountBootstrapState {
  const { account, loading, error } = useAccount();
  return resolveAccountBootstrap({
    loading,
    accountId: account?.id,
    contextError: error,
  });
}
