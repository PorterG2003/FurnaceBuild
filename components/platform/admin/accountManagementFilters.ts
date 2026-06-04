import type { PlatformInvitationLifecycleStatus } from '@/lib/supabase/services/platform';

export const lifecycleFilters: Array<{
  id: 'all' | PlatformInvitationLifecycleStatus | 'active' | 'pending_terms';
  label: string;
}> = [
  { id: 'all', label: 'Active pipeline' },
  { id: 'draft', label: 'Draft' },
  { id: 'sent', label: 'Sent' },
  { id: 'pending_payment', label: 'Pending payment' },
  { id: 'active', label: 'Active' },
  { id: 'pending_terms', label: 'Pending owner acceptance' },
  { id: 'revoked', label: 'Revoked' },
  { id: 'expired', label: 'Expired' },
];

export const billingFilters = [
  { id: 'all', label: 'All billing' },
  { id: 'active', label: 'Active' },
  { id: 'payment_required', label: 'Payment required' },
  { id: 'canceled', label: 'Canceled' },
  { id: 'none', label: 'No billing' },
] as const;

export type AccountManagementLifecycleFilter = (typeof lifecycleFilters)[number]['id'];
export type AccountManagementBillingFilter = (typeof billingFilters)[number]['id'];

const archivedLifecycleStatuses = new Set<AccountManagementLifecycleFilter>(['revoked', 'expired']);

export function matchesAccountManagementLifecycleFilter(
  lifecycleStatus: AccountManagementLifecycleFilter | PlatformInvitationLifecycleStatus | 'active',
  filter: AccountManagementLifecycleFilter,
  record?: { has_pending_terms?: boolean },
): boolean {
  if (filter === 'pending_terms') {
    return record?.has_pending_terms === true;
  }
  if (filter === 'all') {
    return !archivedLifecycleStatuses.has(lifecycleStatus as AccountManagementLifecycleFilter);
  }

  return lifecycleStatus === filter;
}

export function countActiveAccountManagementFilters(params: {
  lifecycle: AccountManagementLifecycleFilter;
  billing: AccountManagementBillingFilter;
}) {
  return (params.lifecycle !== 'all' ? 1 : 0) + (params.billing !== 'all' ? 1 : 0);
}
