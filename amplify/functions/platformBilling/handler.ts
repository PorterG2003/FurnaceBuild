import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { buildBillingAnchorPlan } from '../../../lib/billing/proration';
import {
  buildPlatformPaymentQuote,
  getPlatformPaymentRouteOption,
  getServerPlatformPaymentFeeConfig,
  isPlatformPaymentRoute,
  type PlatformPaymentQuote,
  type PlatformPaymentRoute,
} from '../../../lib/billing/paymentRoutes';

function json(statusCode: number, body: Record<string, unknown>) {
  return {
    statusCode,
    body: JSON.stringify(body),
  };
}

function getSupabaseAdminClient() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !supabaseSecretKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SECRET_KEY');
  }
  return createClient(supabaseUrl, supabaseSecretKey);
}

function getStripeClient() {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) throw new Error('Missing STRIPE_SECRET_KEY');
  return new Stripe(stripeKey);
}

type InvitationCheckoutRow = {
  id: string;
  email: string;
  status: string;
  currency: string;
  monthly_retainer_cents: number;
  first_month_discount_cents: number;
  terms_accepted_at: string | null;
  prepared_full_name: string | null;
  prepared_account_name: string | null;
  auto_add_internal_admins: boolean;
  current_revision_number: number;
  published_revision_number: number | null;
  checkout_revision_number: number | null;
};

type InvitationRevisionRow = {
  email: string;
  currency: string;
  monthly_retainer_cents: number;
  first_month_discount_cents: number;
};

type ResolvedInvitationCheckout = InvitationCheckoutRow & {
  effective_email: string;
  effective_currency: string;
  effective_monthly_retainer_cents: number;
  effective_first_month_discount_cents: number;
  effective_revision_number: number;
};

function normalizePlatformPaymentRoute(value: unknown): PlatformPaymentRoute {
  if (!isPlatformPaymentRoute(value)) {
    throw new Error('Unsupported payment route');
  }
  return value;
}

type CheckoutPaymentMethodType = 'card' | 'us_bank_account';

function getStripePaymentMethodTypes(
  paymentRoute: PlatformPaymentRoute,
): CheckoutPaymentMethodType[] {
  switch (paymentRoute) {
    case 'card':
      return ['card'];
    case 'ach':
      return ['us_bank_account'];
  }
}

async function loadInvitationForCheckout(invitationId: string): Promise<ResolvedInvitationCheckout> {
  const supabase = getSupabaseAdminClient();
  const { data: invitation, error: invitationError } = await supabase
    .from('platform_invitations')
    .select(
      'id, email, status, currency, monthly_retainer_cents, first_month_discount_cents, terms_accepted_at, prepared_full_name, prepared_account_name, auto_add_internal_admins, current_revision_number, published_revision_number, checkout_revision_number',
    )
    .eq('id', invitationId)
    .maybeSingle();
  if (invitationError) throw new Error(invitationError.message);
  if (!invitation) throw new Error('Invitation not found');

  const effectiveRevisionNumber =
    invitation.checkout_revision_number ??
    invitation.published_revision_number ??
    invitation.current_revision_number;

  const { data: revision, error: revisionError } = await supabase
    .from('platform_invitation_revisions')
    .select('email, currency, monthly_retainer_cents, first_month_discount_cents')
    .eq('invitation_id', invitationId)
    .eq('revision_number', effectiveRevisionNumber)
    .maybeSingle();
  if (revisionError) throw new Error(revisionError.message);

  const revisionData = revision as InvitationRevisionRow | null;
  return {
    ...(invitation as InvitationCheckoutRow),
    effective_email: revisionData?.email ?? invitation.email,
    effective_currency: revisionData?.currency ?? invitation.currency,
    effective_monthly_retainer_cents:
      revisionData?.monthly_retainer_cents ?? invitation.monthly_retainer_cents,
    effective_first_month_discount_cents:
      revisionData?.first_month_discount_cents ?? invitation.first_month_discount_cents,
    effective_revision_number: effectiveRevisionNumber,
  };
}

function buildCheckoutQuote(invitation: ResolvedInvitationCheckout, paymentRoute: PlatformPaymentRoute) {
  return buildPlatformPaymentQuote({
    monthlyRetainerCents: invitation.effective_monthly_retainer_cents,
    firstMonthDiscountCents: invitation.effective_first_month_discount_cents,
    paymentRoute,
    routeConfig: getServerPlatformPaymentFeeConfig()[paymentRoute],
  });
}

function buildQuoteResponse(
  invitation: ResolvedInvitationCheckout,
  quote: PlatformPaymentQuote,
) {
  return {
    invitationId: invitation.id,
    paymentRoute: quote.paymentRoute,
    monthlyRetainerCents: quote.baseAmountCents,
    firstMonthDiscountCents: quote.discountCents,
    subtotalCents: quote.subtotalCents,
    routeFeeCents: quote.routeFeeCents,
    totalDueTodayCents: quote.totalDueTodayCents,
    currency: invitation.effective_currency,
    revisionNumber: invitation.effective_revision_number,
  };
}

async function verifyAuthToken(token: string) {
  const supabase = getSupabaseAdminClient();
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) throw new Error('Invalid or expired token');
  return user;
}

async function ensureInvitationAuthUser(args: {
  invitationId: string;
  password: string;
}) {
  const supabase = getSupabaseAdminClient();
  const { data: invitation, error: invitationError } = await supabase
    .from('platform_invitations')
    .select('id, email, status')
    .eq('id', args.invitationId)
    .maybeSingle();
  if (invitationError) throw new Error(invitationError.message);
  if (!invitation) throw new Error('Invitation not found');
  if (
    invitation.status === 'revoked' ||
    invitation.status === 'expired' ||
    invitation.status === 'draft' ||
    invitation.status === 'approved'
  ) {
    throw new Error('Invitation is no longer valid');
  }

  const email = invitation.email.toLowerCase();
  const existing = await supabase.auth.admin.listUsers();
  const match = existing.data.users.find((u) => u.email?.toLowerCase() === email);
  if (!match) {
    const { error } = await supabase.auth.admin.createUser({
      email,
      password: args.password,
      email_confirm: true,
    });
    if (error) throw new Error(error.message);
  }

  return { email };
}

async function createCheckoutSession(args: {
  token: string;
  invitationId: string;
  successUrl: string;
  cancelUrl: string;
  paymentRoute: PlatformPaymentRoute;
}) {
  const user = await verifyAuthToken(args.token);
  const supabase = getSupabaseAdminClient();
  const stripe = getStripeClient();
  const invitation = await loadInvitationForCheckout(args.invitationId);
  const quote = buildCheckoutQuote(invitation, args.paymentRoute);
  if ((user.email ?? '').toLowerCase() !== invitation.effective_email.toLowerCase()) {
    throw new Error('This invite is for a different email address.');
  }
  if (!invitation.terms_accepted_at || !invitation.prepared_full_name || !invitation.prepared_account_name) {
    throw new Error('Invitation is not ready for payment yet.');
  }

  const startedAt = new Date();
  const plan = buildBillingAnchorPlan(startedAt, invitation.effective_monthly_retainer_cents);
  const routeOption = getPlatformPaymentRouteOption(args.paymentRoute);
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    success_url: args.successUrl,
    cancel_url: args.cancelUrl,
    customer_creation: 'always',
    payment_method_types: getStripePaymentMethodTypes(args.paymentRoute),
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: invitation.effective_currency,
          unit_amount: quote.totalDueTodayCents,
          product_data: {
            name: `Furnace managed outreach - ${routeOption.label.toLowerCase()} initial retainer`,
          },
        },
      },
    ],
    metadata: {
      invitationId: invitation.id,
      paymentRoute: args.paymentRoute,
      paymentRouteFeeCents: String(quote.routeFeeCents),
      paymentSubtotalCents: String(quote.subtotalCents),
      paymentTotalDueTodayCents: String(quote.totalDueTodayCents),
      monthlyRetainerCents: String(invitation.effective_monthly_retainer_cents),
      firstMonthDiscountCents: String(invitation.effective_first_month_discount_cents),
      currency: invitation.effective_currency,
      anchorDateIso: plan.anchorDateIso,
      firstRecurringInvoiceAmountCents: String(plan.firstRecurringInvoiceAmountCents),
      firstRecurringCreditCents: String(plan.firstRecurringCreditCents),
      checkoutRevisionNumber: String(invitation.effective_revision_number),
      autoAddInternalAdmins: invitation.auto_add_internal_admins ? 'true' : 'false',
    },
  });

  const { error: updateError } = await supabase
    .from('platform_invitations')
    .update({
      stripe_checkout_session_id: session.id,
      selected_payment_route: args.paymentRoute,
      selected_payment_route_fee_cents: quote.routeFeeCents,
      selected_payment_subtotal_cents: quote.subtotalCents,
      selected_payment_total_cents: quote.totalDueTodayCents,
      updated_at: new Date().toISOString(),
    })
    .eq('id', invitation.id);
  if (updateError) throw new Error(updateError.message);

  return {
    url: session.url,
    id: session.id,
  };
}

async function quoteCheckout(args: {
  invitationId: string;
  paymentRoute: PlatformPaymentRoute;
}) {
  const invitation = await loadInvitationForCheckout(args.invitationId);
  if (
    invitation.status === 'draft' ||
    invitation.status === 'approved' ||
    invitation.status === 'revoked' ||
    invitation.status === 'expired'
  ) {
    throw new Error('Invitation is not available for payment.');
  }
  const quote = buildCheckoutQuote(invitation, args.paymentRoute);
  return buildQuoteResponse(invitation, quote);
}

export const handler = async (event: { headers?: Record<string, string>; body?: string | null; isBase64Encoded?: boolean }) => {
  try {
    const body = event.body ? (event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : event.body) : '{}';
    const parsed = JSON.parse(body) as {
      action?: string;
      invitationId?: string;
      password?: string;
      successUrl?: string;
      cancelUrl?: string;
      paymentRoute?: string;
    };

    if (parsed.action === 'ensureAuthUser') {
      if (!parsed.invitationId || !parsed.password) {
        return json(400, { error: 'Missing invitationId or password' });
      }
      const result = await ensureInvitationAuthUser({
        invitationId: parsed.invitationId,
        password: parsed.password,
      });
      return json(200, { success: true, ...result });
    }

    if (parsed.action === 'quoteCheckout') {
      if (!parsed.invitationId || !parsed.paymentRoute) {
        return json(400, { error: 'Missing invitationId or paymentRoute' });
      }
      const result = await quoteCheckout({
        invitationId: parsed.invitationId,
        paymentRoute: normalizePlatformPaymentRoute(parsed.paymentRoute),
      });
      return json(200, { success: true, ...result });
    }

    if (parsed.action === 'createCheckoutSession') {
      const auth = event.headers?.authorization || event.headers?.Authorization;
      const token = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : null;
      if (!token) return json(401, { error: 'Missing or invalid Authorization header' });
      if (!parsed.invitationId || !parsed.successUrl || !parsed.cancelUrl || !parsed.paymentRoute) {
        return json(400, { error: 'Missing checkout session parameters' });
      }
      const result = await createCheckoutSession({
        token,
        invitationId: parsed.invitationId,
        successUrl: parsed.successUrl,
        cancelUrl: parsed.cancelUrl,
        paymentRoute: normalizePlatformPaymentRoute(parsed.paymentRoute),
      });
      return json(200, { success: true, ...result });
    }

    return json(400, { error: 'Unsupported action' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json(500, { error: message });
  }
};
