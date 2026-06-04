import type { PlatformPaymentRoute } from '../../../lib/billing/paymentRoutes';

export function buildAccountUpgradeIdempotencyKey(args: {
  accountId: string;
  amendmentId?: string | null;
  newMonthlyRetainerCents: number;
  paymentRoute: PlatformPaymentRoute;
  dueTodayTotalCents: number;
  ongoingMonthlyTotalCents: number;
}) {
  return [
    'upgrade',
    args.accountId,
    args.amendmentId ?? 'admin',
    String(args.newMonthlyRetainerCents),
    args.paymentRoute,
    String(args.dueTodayTotalCents),
    String(args.ongoingMonthlyTotalCents),
  ].join('-');
}
