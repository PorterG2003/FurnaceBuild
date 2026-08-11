import outputs from '@/amplify_outputs.json';
import { getAccessToken } from '@/lib/services/auth-token';
import type { AmendmentUpgradeQuote } from '@/lib/billing/amendmentQuote';
import type { PlatformPaymentRoute } from '@/lib/billing/paymentRoutes';
import type { PlatformInviteProrationMode } from '@/lib/billing/proration';

const custom = (outputs as { custom?: { platformCommerceUrl?: string } }).custom;
const PLATFORM_COMMERCE_URL = custom?.platformCommerceUrl;

export interface PlatformCheckoutQuote {
  invitationId: string;
  paymentRoute: PlatformPaymentRoute;
  monthlyRetainerCents: number;
  subtotalCents: number;
  routeFeeCents: number;
  totalDueTodayCents: number;
  recurringAnchorAt: string;
  prorationMode: PlatformInviteProrationMode;
  // Days of the signup month the due-today charge covers. Equal to dueTodayMonthDays when not prorated.
  dueTodayCoveredDays: number;
  dueTodayMonthDays: number;
  // Invoice subtotal after the overlap credit is applied, before any route fee.
  firstRecurringSubtotalCents: number;
  firstRecurringRouteFeeCents: number;
  // Total amount due on the first recurring invoice, including any route fee.
  firstRecurringInvoiceCents: number;
  // Credit for the portion of the first recurring billing period already covered by the upfront month.
  firstRecurringDiscountCents: number;
  ongoingMonthlyRetainerCents: number;
  ongoingMonthlyRouteFeeCents: number;
  ongoingMonthlyTotalCents: number;
  currency: string;
  revisionNumber: number;
}

async function postJson(url: string, body: Record<string, unknown>, token?: string | null) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || res.statusText || 'Request failed');
  }
  return data as Record<string, unknown>;
}

function requirePlatformCommerceUrl() {
  if (!PLATFORM_COMMERCE_URL) {
    throw new Error('Platform commerce URL is not configured.');
  }
  return PLATFORM_COMMERCE_URL;
}

export async function ensurePlatformInviteAuthUser(invitationId: string, password: string) {
  return postJson(requirePlatformCommerceUrl(), {
    action: 'ensureAuthUser',
    invitationId,
    password,
  });
}

export async function getPlatformCheckoutQuote(params: {
  invitationId: string;
  paymentRoute: PlatformPaymentRoute;
}): Promise<PlatformCheckoutQuote> {
  const result = await postJson(requirePlatformCommerceUrl(), {
    action: 'quoteCheckout',
    invitationId: params.invitationId,
    paymentRoute: params.paymentRoute,
  });
  return result as unknown as PlatformCheckoutQuote;
}

export async function createPlatformCheckoutSession(params: {
  invitationId: string;
  successUrl: string;
  cancelUrl: string;
  paymentRoute: PlatformPaymentRoute;
}) {
  const token = await getAccessToken();
  if (!token) throw new Error('You must be signed in to start checkout.');
  return postJson(
    requirePlatformCommerceUrl(),
    {
      action: 'createCheckoutSession',
      invitationId: params.invitationId,
      successUrl: params.successUrl,
      cancelUrl: params.cancelUrl,
      paymentRoute: params.paymentRoute,
    },
    token,
  );
}

export async function applyAccountUpgrade(params: {
  accountId: string;
  amendmentId?: string | null;
  newMonthlyRetainerCents: number;
}) {
  const token = await getAccessToken();
  if (!token) throw new Error('You must be signed in to apply billing changes.');
  return postJson(
    requirePlatformCommerceUrl(),
    {
      action: 'applyAccountUpgrade',
      accountId: params.accountId,
      amendmentId: params.amendmentId ?? null,
      newMonthlyRetainerCents: params.newMonthlyRetainerCents,
    },
    token,
  );
}

export async function createAccountUpgradeCheckoutSession(params: {
  accountId: string;
  amendmentId: string;
  newMonthlyRetainerCents: number;
  paymentRoute: PlatformPaymentRoute;
  successUrl: string;
  cancelUrl: string;
}) {
  const token = await getAccessToken();
  if (!token) throw new Error('You must be signed in to start checkout.');
  return postJson(
    requirePlatformCommerceUrl(),
    {
      action: 'createAccountUpgradeCheckoutSession',
      accountId: params.accountId,
      amendmentId: params.amendmentId,
      newMonthlyRetainerCents: params.newMonthlyRetainerCents,
      paymentRoute: params.paymentRoute,
      successUrl: params.successUrl,
      cancelUrl: params.cancelUrl,
    },
    token,
  );
}

export async function getAccountUpgradeQuote(params: {
  accountId: string;
  amendmentId?: string | null;
  newMonthlyRetainerCents: number;
  paymentRoute?: PlatformPaymentRoute;
}): Promise<AmendmentUpgradeQuote> {
  const token = await getAccessToken();
  if (!token) throw new Error('You must be signed in to review billing changes.');
  const result = await postJson(
    requirePlatformCommerceUrl(),
    {
      action: 'quoteAccountUpgrade',
      accountId: params.accountId,
      amendmentId: params.amendmentId ?? null,
      newMonthlyRetainerCents: params.newMonthlyRetainerCents,
      paymentRoute: params.paymentRoute ?? null,
    },
    token,
  );
  return result as unknown as AmendmentUpgradeQuote;
}

export async function createAccountPaymentMethodUpdateSession(params: {
  accountId: string;
  amendmentId?: string | null;
  paymentRoute: PlatformPaymentRoute;
  successUrl: string;
  cancelUrl: string;
}) {
  const token = await getAccessToken();
  if (!token) throw new Error('You must be signed in to update the billing method.');
  return postJson(
    requirePlatformCommerceUrl(),
    {
      action: 'createAccountPaymentMethodUpdateSession',
      accountId: params.accountId,
      amendmentId: params.amendmentId ?? null,
      paymentRoute: params.paymentRoute,
      successUrl: params.successUrl,
      cancelUrl: params.cancelUrl,
    },
    token,
  );
}

export async function finalizeAccountPaymentMethodUpdate(params: {
  checkoutSessionId: string;
}) {
  const token = await getAccessToken();
  if (!token) throw new Error('You must be signed in to finalize the billing method update.');
  return postJson(
    requirePlatformCommerceUrl(),
    {
      action: 'finalizeAccountPaymentMethodUpdate',
      checkoutSessionId: params.checkoutSessionId,
    },
    token,
  );
}

export async function scheduleAccountDowngrade(params: {
  accountId: string;
  newMonthlyRetainerCents: number;
}) {
  const token = await getAccessToken();
  if (!token) throw new Error('You must be signed in to schedule billing changes.');
  return postJson(
    requirePlatformCommerceUrl(),
    {
      action: 'scheduleAccountDowngrade',
      accountId: params.accountId,
      newMonthlyRetainerCents: params.newMonthlyRetainerCents,
    },
    token,
  );
}
