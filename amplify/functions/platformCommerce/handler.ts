import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { buildAmendmentUpgradeQuote } from '../../../lib/billing/amendmentQuote';
import { getNextMonthlyAnchorDate } from '../../../lib/billing/calendar';
import { buildBillingAnchorPlan } from '../../../lib/billing/proration';
import { buildAccountUpgradeIdempotencyKey } from './idempotency';
import {
  buildPlatformPaymentQuote,
  buildPlatformRecurringInvoiceQuote,
  getPlatformPaymentRouteOption,
  getServerPlatformPaymentFeeConfig,
  isPlatformPaymentRoute,
  type PlatformPaymentQuote,
  type PlatformPaymentRoute,
} from '../../../lib/billing/paymentRoutes';

function json(statusCode: number, body: unknown) {
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
  terms_accepted_at: string | null;
  prepared_full_name: string | null;
  prepared_account_name: string | null;
  auto_add_internal_admins: boolean;
  current_revision_number: number;
  published_revision_number: number | null;
  checkout_revision_number: number | null;
  stripe_customer_id: string | null;
};

type InvitationRevisionRow = {
  email: string;
  currency: string;
  monthly_retainer_cents: number;
};

type ResolvedInvitationCheckout = InvitationCheckoutRow & {
  effective_email: string;
  effective_currency: string;
  effective_monthly_retainer_cents: number;
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
      'id, email, status, currency, monthly_retainer_cents, terms_accepted_at, prepared_full_name, prepared_account_name, auto_add_internal_admins, current_revision_number, published_revision_number, checkout_revision_number, stripe_customer_id',
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
    .select('email, currency, monthly_retainer_cents')
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
    effective_revision_number: effectiveRevisionNumber,
  };
}

function buildCheckoutQuote(invitation: ResolvedInvitationCheckout, paymentRoute: PlatformPaymentRoute) {
  return buildPlatformPaymentQuote({
    monthlyRetainerCents: invitation.effective_monthly_retainer_cents,
    paymentRoute,
    routeConfig: getServerPlatformPaymentFeeConfig()[paymentRoute],
  });
}

function buildRecurringQuote(
  invitation: ResolvedInvitationCheckout,
  paymentRoute: PlatformPaymentRoute,
  plan: ReturnType<typeof buildBillingAnchorPlan>,
) {
  return buildPlatformRecurringInvoiceQuote({
    monthlyRetainerCents: invitation.effective_monthly_retainer_cents,
    firstRecurringSubtotalCents: plan.firstRecurringAmountDueCents,
    paymentRoute,
    routeConfig: getServerPlatformPaymentFeeConfig()[paymentRoute],
  });
}

function buildQuoteResponse(
  invitation: ResolvedInvitationCheckout,
  quote: PlatformPaymentQuote,
  plan: ReturnType<typeof buildBillingAnchorPlan>,
  recurringQuote: ReturnType<typeof buildRecurringQuote>,
) {
  return {
    invitationId: invitation.id,
    paymentRoute: quote.paymentRoute,
    monthlyRetainerCents: quote.baseAmountCents,
    subtotalCents: quote.subtotalCents,
    routeFeeCents: quote.routeFeeCents,
    totalDueTodayCents: quote.totalDueTodayCents,
    recurringAnchorAt: plan.anchorDateIso,
    firstRecurringSubtotalCents: recurringQuote.firstRecurringSubtotalCents,
    firstRecurringRouteFeeCents: recurringQuote.firstRecurringRouteFeeCents,
    firstRecurringInvoiceCents: recurringQuote.firstRecurringTotalCents,
    firstRecurringDiscountCents: plan.overlapCreditCents,
    ongoingMonthlyRetainerCents: invitation.effective_monthly_retainer_cents,
    ongoingMonthlyRouteFeeCents: recurringQuote.ongoingMonthlyRouteFeeCents,
    ongoingMonthlyTotalCents: recurringQuote.ongoingMonthlyTotalCents,
    currency: invitation.effective_currency,
    revisionNumber: invitation.effective_revision_number,
  };
}

async function ensureStripeCustomer(args: {
  stripe: ReturnType<typeof getStripeClient>;
  invitation: ResolvedInvitationCheckout;
}) {
  const existingCustomerId = args.invitation.stripe_customer_id?.trim();
  if (existingCustomerId) {
    return existingCustomerId;
  }

  const customer = await args.stripe.customers.create({
    email: args.invitation.effective_email,
    name: args.invitation.prepared_full_name ?? undefined,
    metadata: {
      invitationId: args.invitation.id,
      preparedAccountName: args.invitation.prepared_account_name ?? '',
    },
  });
  return customer.id;
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
    invitation.status === 'draft'
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
  const recurringQuote = buildRecurringQuote(invitation, args.paymentRoute, plan);
  const customerId = await ensureStripeCustomer({ stripe, invitation });
  const routeOption = getPlatformPaymentRouteOption(args.paymentRoute);
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    success_url: args.successUrl,
    cancel_url: args.cancelUrl,
    customer: customerId,
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
    invoice_creation: {
      enabled: true,
      invoice_data: {
        description: `Furnace managed outreach upfront invoice for ${invitation.prepared_account_name ?? invitation.effective_email}`,
        metadata: {
          invitationId: invitation.id,
          invoiceKind: 'platform_upfront',
        },
      },
    },
    payment_intent_data: {
      setup_future_usage: 'off_session',
      description: `Furnace managed outreach upfront invoice for ${invitation.prepared_account_name ?? invitation.effective_email}`,
      metadata: {
        invitationId: invitation.id,
        paymentKind: 'platform_upfront',
      },
    },
    metadata: {
      invitationId: invitation.id,
      paymentRoute: args.paymentRoute,
      paymentRouteFeeCents: String(quote.routeFeeCents),
      paymentSubtotalCents: String(quote.subtotalCents),
      paymentTotalDueTodayCents: String(quote.totalDueTodayCents),
      monthlyRetainerCents: String(invitation.effective_monthly_retainer_cents),
      currency: invitation.effective_currency,
      anchorDateIso: plan.anchorDateIso,
      firstRecurringSubtotalCents: String(recurringQuote.firstRecurringSubtotalCents),
      firstRecurringRouteFeeCents: String(recurringQuote.firstRecurringRouteFeeCents),
      firstRecurringInvoiceAmountCents: String(recurringQuote.firstRecurringTotalCents),
      firstRecurringDiscountCents: String(plan.overlapCreditCents),
      firstRecurringCouponAmountCents: String(recurringQuote.firstRecurringTotalDiscountCents),
      ongoingMonthlyRouteFeeCents: String(recurringQuote.ongoingMonthlyRouteFeeCents),
      ongoingMonthlyTotalCents: String(recurringQuote.ongoingMonthlyTotalCents),
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
      stripe_customer_id: customerId,
      recurring_anchor_at: plan.anchorDateIso,
      first_recurring_invoice_target_cents: recurringQuote.firstRecurringTotalCents,
      updated_at: new Date().toISOString(),
    })
    .eq('id', invitation.id);
  if (updateError) throw new Error(updateError.message);

  return {
    url: session.url,
    id: session.id,
  };
}

type AccountBillingRow = {
  account_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  monthly_retainer_cents: number;
  billing_status: string;
  preferred_payment_route: PlatformPaymentRoute | null;
  currency?: string;
};

async function loadAccountBilling(accountId: string): Promise<AccountBillingRow> {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from('account_billing')
    .select(
      'account_id, stripe_customer_id, stripe_subscription_id, monthly_retainer_cents, billing_status, preferred_payment_route',
    )
    .eq('account_id', accountId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Account billing not found');
  return data as AccountBillingRow;
}

async function loadAmendmentPaymentStartedAt(amendmentId: string): Promise<Date | null> {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from('platform_account_amendments')
    .select('payment_started_at')
    .eq('id', amendmentId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.payment_started_at) return null;
  return new Date(data.payment_started_at);
}

async function buildAccountUpgradeQuote(args: {
  accountId: string;
  amendmentId?: string | null;
  newMonthlyRetainerCents: number;
  paymentRoute?: PlatformPaymentRoute | null;
}) {
  const billing = await loadAccountBilling(args.accountId);
  const paymentRoute = args.paymentRoute ?? billing.preferred_payment_route ?? 'card';
  const effectiveAt =
    args.amendmentId ? (await loadAmendmentPaymentStartedAt(args.amendmentId)) ?? new Date() : new Date();
  const quote = buildAmendmentUpgradeQuote({
    effectiveAt,
    oldMonthlyRetainerCents: billing.monthly_retainer_cents,
    newMonthlyRetainerCents: args.newMonthlyRetainerCents,
    paymentRoute,
    routeConfig: getServerPlatformPaymentFeeConfig()[paymentRoute],
  });

  return {
    billing,
    paymentRoute,
    effectiveAt,
    quote,
  };
}

async function assertCanApplyAccountBillingChange(userId: string, accountId: string) {
  const supabase = getSupabaseAdminClient();
  const { data: membership, error: membershipError } = await supabase
    .from('account_users')
    .select('is_owner')
    .eq('account_id', accountId)
    .eq('user_id', userId)
    .maybeSingle();
  if (membershipError) throw new Error(membershipError.message);
  if (membership?.is_owner) return;

  const { data: adminFlag, error: flagError } = await supabase
    .from('user_access_flags')
    .select('user_id')
    .eq('user_id', userId)
    .eq('flag_key', 'platform_admin')
    .maybeSingle();
  if (flagError) throw new Error(flagError.message);
  if (!adminFlag) {
    throw new Error('Not authorized to change account billing');
  }
}

async function syncAccountDefaultPaymentMethod(args: {
  stripe: ReturnType<typeof getStripeClient>;
  accountId: string;
  paymentMethodId: string;
}) {
  const billing = await loadAccountBilling(args.accountId);
  if (!billing.stripe_customer_id) {
    throw new Error('Stripe customer is not linked for this account');
  }

  await args.stripe.customers.update(billing.stripe_customer_id, {
    invoice_settings: {
      default_payment_method: args.paymentMethodId,
    },
  });

  if (billing.stripe_subscription_id) {
    await args.stripe.subscriptions.update(billing.stripe_subscription_id, {
      default_payment_method: args.paymentMethodId,
    });
  }
}

async function quoteAccountUpgradeAction(args: {
  userId: string;
  accountId: string;
  amendmentId?: string | null;
  newMonthlyRetainerCents: number;
  paymentRoute?: PlatformPaymentRoute | null;
}) {
  await assertCanApplyAccountBillingChange(args.userId, args.accountId);
  const { quote } = await buildAccountUpgradeQuote({
    accountId: args.accountId,
    amendmentId: args.amendmentId,
    newMonthlyRetainerCents: args.newMonthlyRetainerCents,
    paymentRoute: args.paymentRoute ?? null,
  });
  return quote;
}

async function createAccountPaymentMethodUpdateSession(args: {
  userId: string;
  accountId: string;
  amendmentId?: string | null;
  paymentRoute: PlatformPaymentRoute;
  successUrl: string;
  cancelUrl: string;
}) {
  const stripe = getStripeClient();
  await assertCanApplyAccountBillingChange(args.userId, args.accountId);
  const billing = await loadAccountBilling(args.accountId);

  if (!billing.stripe_customer_id) {
    throw new Error('Stripe customer is not linked for this account');
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'setup',
    customer: billing.stripe_customer_id,
    payment_method_types: getStripePaymentMethodTypes(args.paymentRoute),
    success_url: args.successUrl,
    cancel_url: args.cancelUrl,
    metadata: {
      flowKind: 'account_payment_method_update',
      accountId: args.accountId,
      amendmentId: args.amendmentId ?? '',
      paymentRoute: args.paymentRoute,
    },
    ...(args.paymentRoute === 'ach'
      ? {
          payment_method_options: {
            us_bank_account: {
              financial_connections: {
                permissions: ['payment_method'],
              },
            },
          },
        }
      : {}),
  });

  return {
    id: session.id,
    url: session.url,
  };
}

async function finalizeAccountPaymentMethodUpdateAction(args: {
  userId: string;
  checkoutSessionId: string;
}) {
  const stripe = getStripeClient();
  const session = await stripe.checkout.sessions.retrieve(args.checkoutSessionId, {
    expand: ['setup_intent.payment_method'],
  });
  const metadata = session.metadata ?? {};
  if (metadata.flowKind !== 'account_payment_method_update' || !metadata.accountId) {
    throw new Error('Checkout session is not a payment method update flow');
  }

  await assertCanApplyAccountBillingChange(args.userId, metadata.accountId);

  const setupIntent =
    session.setup_intent && typeof session.setup_intent !== 'string' ? session.setup_intent : null;
  const paymentMethodId =
    setupIntent?.payment_method && typeof setupIntent.payment_method !== 'string'
      ? setupIntent.payment_method.id
      : typeof setupIntent?.payment_method === 'string'
        ? setupIntent.payment_method
        : null;

  if (!paymentMethodId) {
    throw new Error('Checkout session does not have a reusable payment method yet');
  }

  await syncAccountDefaultPaymentMethod({
    stripe,
    accountId: metadata.accountId,
    paymentMethodId,
  });

  const supabase = getSupabaseAdminClient();
  const paymentRoute = normalizePlatformPaymentRoute(metadata.paymentRoute ?? 'card');
  const { error } = await supabase
    .from('account_billing')
    .update({
      preferred_payment_route: paymentRoute,
      updated_at: new Date().toISOString(),
    })
    .eq('account_id', metadata.accountId);
  if (error) throw new Error(error.message);

  return {
    success: true,
    accountId: metadata.accountId,
    paymentRoute,
    paymentMethodId,
  };
}

async function applyAccountUpgradeAction(args: {
  userId: string;
  accountId: string;
  amendmentId?: string | null;
  newMonthlyRetainerCents: number;
}) {
  const supabase = getSupabaseAdminClient();
  const stripe = getStripeClient();
  await assertCanApplyAccountBillingChange(args.userId, args.accountId);
  const { billing, paymentRoute, quote } = await buildAccountUpgradeQuote({
    accountId: args.accountId,
    amendmentId: args.amendmentId,
    newMonthlyRetainerCents: args.newMonthlyRetainerCents,
  });

  if (!billing.stripe_customer_id) {
    throw new Error('Stripe customer is not linked for this account');
  }
  if (!billing.stripe_subscription_id) {
    throw new Error('Stripe subscription is not linked for this account');
  }
  if (args.newMonthlyRetainerCents <= billing.monthly_retainer_cents) {
    throw new Error('New retainer must be higher than the current retainer');
  }

  const subscription = await stripe.subscriptions.retrieve(billing.stripe_subscription_id);
  const subscriptionItemId = subscription.items.data[0]?.id;
  if (!subscriptionItemId) {
    throw new Error('Subscription item not found');
  }

  const idempotencyKey = buildAccountUpgradeIdempotencyKey({
    accountId: args.accountId,
    amendmentId: args.amendmentId ?? null,
    newMonthlyRetainerCents: args.newMonthlyRetainerCents,
    paymentRoute,
    dueTodayTotalCents: quote.dueTodayTotalCents,
    ongoingMonthlyTotalCents: quote.ongoingMonthlyTotalCents,
  });
  const subscriptionUnitAmount = subscription.items.data[0]?.price?.unit_amount ?? null;

  if (args.amendmentId && subscriptionUnitAmount === quote.ongoingMonthlyTotalCents) {
    const invoices = await stripe.invoices.list({
      customer: billing.stripe_customer_id,
      limit: 20,
    });
    const existingUpgradeInvoice =
      invoices.data.find(
        (invoice) =>
          invoice.status === 'paid' &&
          invoice.metadata?.invoiceKind === 'platform_upgrade_delta' &&
          invoice.metadata?.accountId === args.accountId &&
          invoice.metadata?.amendmentId === args.amendmentId,
      ) ?? null;

    const { error: completeExistingError } = await supabase.rpc('complete_account_amendment_upgrade', {
      p_amendment_id: args.amendmentId,
      p_new_monthly_retainer_cents: args.newMonthlyRetainerCents,
      p_pending_first_delta_coupon_cents:
        quote.nextInvoiceCreditCents > 0 ? quote.nextInvoiceCreditCents : null,
      p_upgrade_delta_invoice_id: existingUpgradeInvoice?.id ?? null,
      p_accepted_by_user_id: args.userId,
    });
    if (completeExistingError) throw new Error(completeExistingError.message);

    const { error: activateExistingError } = await supabase.rpc('set_account_billing_status', {
      p_account_id: args.accountId,
      p_billing_status: 'active',
    });
    if (activateExistingError) throw new Error(activateExistingError.message);

    return {
      success: true,
      invoiceId: existingUpgradeInvoice?.id ?? null,
      deltaCents: quote.dueTodayTotalCents,
      pendingCouponCents: quote.nextInvoiceCreditCents,
      paymentRoute,
    };
  }

  const invoice = await stripe.invoices.create(
    {
      customer: billing.stripe_customer_id,
      collection_method: 'charge_automatically',
      auto_advance: true,
      metadata: {
        accountId: args.accountId,
        amendmentId: args.amendmentId ?? '',
        invoiceKind: 'platform_upgrade_delta',
        paymentRoute,
        deltaCents: String(quote.deltaCents),
        dueTodaySubtotalCents: String(quote.dueTodaySubtotalCents),
        dueTodayRouteFeeCents: String(quote.dueTodayRouteFeeCents),
        dueTodayTotalCents: String(quote.dueTodayTotalCents),
        nextInvoiceCreditCents: String(quote.nextInvoiceCreditCents),
      },
    },
    { idempotencyKey: `${idempotencyKey}-invoice` },
  );

  await stripe.invoiceItems.create(
    {
      customer: billing.stripe_customer_id,
      invoice: invoice.id,
      currency: 'usd',
      amount: quote.dueTodayTotalCents,
      description: 'Furnace plan upgrade charge (due immediately)',
    },
    { idempotencyKey: `${idempotencyKey}-invoice-item` },
  );

  let paidInvoice: Awaited<ReturnType<typeof stripe.invoices.pay>>;
  try {
    paidInvoice = await stripe.invoices.pay(invoice.id!, {
      off_session: true,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('Invoice is already paid')) {
      const existingInvoice = await stripe.invoices.retrieve(invoice.id!);
      if (existingInvoice.status === 'paid') {
        paidInvoice = existingInvoice;
      } else {
        throw error;
      }
    } else {
      throw error;
    }
  }

  const chargeInitiated =
    paidInvoice.status === 'paid' || (paymentRoute === 'ach' && paidInvoice.status !== 'void');

  if (!chargeInitiated) {
    await supabase.rpc('set_account_billing_status', {
      p_account_id: args.accountId,
      p_billing_status: 'payment_required',
    });
    throw new Error('Upgrade payment did not complete');
  }

  const product = await stripe.products.create(
    {
      name: 'Furnace managed outreach',
      metadata: { accountId: args.accountId },
    },
    { idempotencyKey: `${idempotencyKey}-product` },
  );

  await stripe.subscriptions.update(
    billing.stripe_subscription_id,
    {
      proration_behavior: 'none',
      items: [
        {
          id: subscriptionItemId,
          price_data: {
            currency: 'usd',
            recurring: { interval: 'month' },
            unit_amount: quote.ongoingMonthlyTotalCents,
            product: product.id,
          },
        },
      ],
      metadata: {
        ...subscription.metadata,
        accountId: args.accountId,
        pendingUpgradeDeltaCouponCents:
          quote.nextInvoiceCreditCents > 0
            ? String(quote.nextInvoiceCreditCents)
            : '',
        paymentRoute,
        upgradeAnchorDateIso: quote.anchorDateIso,
      },
    },
    { idempotencyKey: `${idempotencyKey}-subscription` },
  );

  if (args.amendmentId) {
    const { error: completeError } = await supabase.rpc('complete_account_amendment_upgrade', {
      p_amendment_id: args.amendmentId,
      p_new_monthly_retainer_cents: args.newMonthlyRetainerCents,
      p_pending_first_delta_coupon_cents:
        quote.nextInvoiceCreditCents > 0 ? quote.nextInvoiceCreditCents : null,
      p_upgrade_delta_invoice_id: paidInvoice.id,
      p_accepted_by_user_id: args.userId,
    });
    if (completeError) throw new Error(completeError.message);
  } else {
    const { error: updateError } = await supabase
      .from('account_billing')
      .update({
        monthly_retainer_cents: args.newMonthlyRetainerCents,
        pending_first_delta_coupon_cents:
          quote.nextInvoiceCreditCents > 0 ? quote.nextInvoiceCreditCents : null,
        upgrade_delta_invoice_id: paidInvoice.id,
        upgrade_delta_charged_at: new Date().toISOString(),
        preferred_payment_route: paymentRoute,
        updated_at: new Date().toISOString(),
      })
      .eq('account_id', args.accountId);
    if (updateError) throw new Error(updateError.message);
  }

  const { error: activateError } = await supabase.rpc('set_account_billing_status', {
    p_account_id: args.accountId,
    p_billing_status: 'active',
  });
  if (activateError) throw new Error(activateError.message);

  return {
    success: true,
    invoiceId: paidInvoice.id,
    deltaCents: quote.dueTodayTotalCents,
    pendingCouponCents: quote.nextInvoiceCreditCents,
    paymentRoute,
    chargeStatus: paidInvoice.status,
  };
}

async function scheduleAccountDowngradeAction(args: {
  userId: string;
  accountId: string;
  newMonthlyRetainerCents: number;
}) {
  const supabase = getSupabaseAdminClient();
  await assertCanApplyAccountBillingChange(args.userId, args.accountId);
  const billing = await loadAccountBilling(args.accountId);

  if (!billing.stripe_subscription_id) {
    throw new Error('Stripe subscription is not linked for this account');
  }
  if (args.newMonthlyRetainerCents >= billing.monthly_retainer_cents) {
    throw new Error('New retainer must be lower than the current retainer');
  }

  const effectiveAt = getNextMonthlyAnchorDate(new Date());

  const { error } = await supabase
    .from('account_billing')
    .update({
      scheduled_monthly_retainer_cents: args.newMonthlyRetainerCents,
      scheduled_retainer_effective_at: effectiveAt.toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('account_id', args.accountId);
  if (error) throw new Error(error.message);

  return {
    success: true,
    scheduledMonthlyRetainerCents: args.newMonthlyRetainerCents,
    scheduledRetainerEffectiveAt: effectiveAt.toISOString(),
  };
}

async function quoteCheckout(args: {
  invitationId: string;
  paymentRoute: PlatformPaymentRoute;
}) {
  const invitation = await loadInvitationForCheckout(args.invitationId);
  if (
    invitation.status === 'draft' ||
    invitation.status === 'revoked' ||
    invitation.status === 'expired'
  ) {
    throw new Error('Invitation is not available for payment.');
  }
  const quote = buildCheckoutQuote(invitation, args.paymentRoute);
  const plan = buildBillingAnchorPlan(new Date(), invitation.effective_monthly_retainer_cents);
  const recurringQuote = buildRecurringQuote(invitation, args.paymentRoute, plan);
  return buildQuoteResponse(invitation, quote, plan, recurringQuote);
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
      checkoutSessionId?: string;
      paymentRoute?: string;
      accountId?: string;
      amendmentId?: string | null;
      newMonthlyRetainerCents?: number;
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

    if (parsed.action === 'applyAccountUpgrade') {
      const auth = event.headers?.authorization || event.headers?.Authorization;
      const token = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : null;
      if (!token) return json(401, { error: 'Missing or invalid Authorization header' });
      const user = await verifyAuthToken(token);
      if (!parsed.accountId || !parsed.newMonthlyRetainerCents) {
        return json(400, { error: 'Missing accountId or newMonthlyRetainerCents' });
      }
      const result = await applyAccountUpgradeAction({
        userId: user.id,
        accountId: parsed.accountId,
        amendmentId: parsed.amendmentId ?? null,
        newMonthlyRetainerCents: parsed.newMonthlyRetainerCents,
      });
      return json(200, result);
    }

    if (parsed.action === 'quoteAccountUpgrade') {
      const auth = event.headers?.authorization || event.headers?.Authorization;
      const token = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : null;
      if (!token) return json(401, { error: 'Missing or invalid Authorization header' });
      const user = await verifyAuthToken(token);
      if (!parsed.accountId || !parsed.newMonthlyRetainerCents) {
        return json(400, { error: 'Missing accountId or newMonthlyRetainerCents' });
      }
      const result = await quoteAccountUpgradeAction({
        userId: user.id,
        accountId: parsed.accountId,
        amendmentId: parsed.amendmentId ?? null,
        newMonthlyRetainerCents: parsed.newMonthlyRetainerCents,
        paymentRoute: parsed.paymentRoute
          ? normalizePlatformPaymentRoute(parsed.paymentRoute)
          : null,
      });
      return json(200, result);
    }

    if (parsed.action === 'createAccountPaymentMethodUpdateSession') {
      const auth = event.headers?.authorization || event.headers?.Authorization;
      const token = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : null;
      if (!token) return json(401, { error: 'Missing or invalid Authorization header' });
      const user = await verifyAuthToken(token);
      if (!parsed.accountId || !parsed.successUrl || !parsed.cancelUrl || !parsed.paymentRoute) {
        return json(400, { error: 'Missing payment method update parameters' });
      }
      const result = await createAccountPaymentMethodUpdateSession({
        userId: user.id,
        accountId: parsed.accountId,
        amendmentId: parsed.amendmentId ?? null,
        paymentRoute: normalizePlatformPaymentRoute(parsed.paymentRoute),
        successUrl: parsed.successUrl,
        cancelUrl: parsed.cancelUrl,
      });
      return json(200, { success: true, ...result });
    }

    if (parsed.action === 'finalizeAccountPaymentMethodUpdate') {
      const auth = event.headers?.authorization || event.headers?.Authorization;
      const token = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : null;
      if (!token) return json(401, { error: 'Missing or invalid Authorization header' });
      const user = await verifyAuthToken(token);
      if (!parsed.checkoutSessionId) {
        return json(400, { error: 'Missing checkoutSessionId' });
      }
      const result = await finalizeAccountPaymentMethodUpdateAction({
        userId: user.id,
        checkoutSessionId: parsed.checkoutSessionId,
      });
      return json(200, result);
    }

    if (parsed.action === 'scheduleAccountDowngrade') {
      const auth = event.headers?.authorization || event.headers?.Authorization;
      const token = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : null;
      if (!token) return json(401, { error: 'Missing or invalid Authorization header' });
      const user = await verifyAuthToken(token);
      if (!parsed.accountId || !parsed.newMonthlyRetainerCents) {
        return json(400, { error: 'Missing accountId or newMonthlyRetainerCents' });
      }
      const result = await scheduleAccountDowngradeAction({
        userId: user.id,
        accountId: parsed.accountId,
        newMonthlyRetainerCents: parsed.newMonthlyRetainerCents,
      });
      return json(200, result);
    }

    return json(400, { error: 'Unsupported action' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json(500, { error: message });
  }
};
