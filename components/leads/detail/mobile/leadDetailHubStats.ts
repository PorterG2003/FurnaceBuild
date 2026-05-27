import type { AccountLeadDetail } from '@/lib/leads/types';

export function getLeadDetailHubStats(detail: AccountLeadDetail) {
  const membershipCount = detail.person.memberships.length;
  const threadCount = detail.threads.length;
  const activeCount = detail.person.memberships.filter((m) => m.enrollmentState === 'active').length;

  return { membershipCount, threadCount, activeCount };
}
