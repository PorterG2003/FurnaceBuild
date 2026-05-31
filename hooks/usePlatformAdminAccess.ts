import { useAccount } from '@/contexts/AccountContext';

export type { PlatformAdminAccessStatus } from '@/lib/account/platformAdminAccess';

export function usePlatformAdminAccess() {
  const { platformAdminAccess } = useAccount();
  return platformAdminAccess;
}
