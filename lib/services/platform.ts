import outputs from '@/amplify_outputs.json';
import { getAccessToken } from '@/lib/services/auth-token';
import type { PlatformPaymentRoute } from '@/lib/billing/paymentRoutes';

const custom = (outputs as {
  custom?: {
    sendPlatformInvitationEmailUrl?: string;
    platformBillingUrl?: string;
  };
}).custom;

const SEND_PLATFORM_INVITATION_URL = custom?.sendPlatformInvitationEmailUrl;
const PLATFORM_BILLING_URL = custom?.platformBillingUrl;

export interface PlatformCheckoutQuote {
  invitationId: string;
  paymentRoute: PlatformPaymentRoute;
  monthlyRetainerCents: number;
  firstMonthDiscountCents: number;
  subtotalCents: number;
  routeFeeCents: number;
  totalDueTodayCents: number;
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

export async function sendPlatformInvitationEmail(params: {
  to: string;
  inviterName: string;
  monthlyRetainerCents: number;
  acceptUrl: string;
  proposalTitle?: string;
  accountName?: string;
}) {
  if (!SEND_PLATFORM_INVITATION_URL) {
    throw new Error('Platform invitation email URL is not configured.');
  }
  const token = await getAccessToken();
  if (!token) throw new Error('You must be signed in to send a platform invitation.');
  return postJson(SEND_PLATFORM_INVITATION_URL, params, token);
}

export async function ensurePlatformInviteAuthUser(invitationId: string, password: string) {
  if (!PLATFORM_BILLING_URL) {
    throw new Error('Platform billing URL is not configured.');
  }
  return postJson(PLATFORM_BILLING_URL, {
    action: 'ensureAuthUser',
    invitationId,
    password,
  });
}

export async function getPlatformCheckoutQuote(params: {
  invitationId: string;
  paymentRoute: PlatformPaymentRoute;
}): Promise<PlatformCheckoutQuote> {
  if (!PLATFORM_BILLING_URL) {
    throw new Error('Platform billing URL is not configured.');
  }
  const result = await postJson(PLATFORM_BILLING_URL, {
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
  if (!PLATFORM_BILLING_URL) {
    throw new Error('Platform billing URL is not configured.');
  }
  const token = await getAccessToken();
  if (!token) throw new Error('You must be signed in to start checkout.');
  return postJson(
    PLATFORM_BILLING_URL,
    {
      action: 'createCheckoutSession',
      invitationId: params.invitationId,
      successUrl: params.successUrl,
      cancelUrl: params.cancelUrl,
      paymentRoute: params.paymentRoute,
    },
    token
  );
}
