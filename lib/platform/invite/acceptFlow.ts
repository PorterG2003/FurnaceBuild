import { isFreeRetainer } from '@/lib/platform/billing/retainer';

export type InviteAcceptFlowKind = 'free' | 'paid';

export function resolveInviteAcceptFlow(monthlyRetainerCents: number | null | undefined): InviteAcceptFlowKind {
  return isFreeRetainer(monthlyRetainerCents) ? 'free' : 'paid';
}
