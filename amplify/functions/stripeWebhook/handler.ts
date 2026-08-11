import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import {
  buildPlatformRecurringInvoiceQuote,
  getServerPlatformPaymentFeeConfig,
  type PlatformPaymentRoute,
} from '../../../lib/billing/paymentRoutes';
import {
  buildInviteRecurringCouponParams,
  buildUpgradeDeltaCouponParams,
  resolveInviteRecurringCouponAmountCents,
} from './couponParams';

const INTERNAL_ADMIN_EMAILS = ['porter@getfurnace.io', 'kyle@getfurnace.io'];

type CheckoutSessionLike = {
  id: string;
  customer: string | null;
  invoice?: string | null;
  payment_intent?: string | null;
  subscription?: string | null;
  metadata?: Record<string, string> | null;
};

type InvoiceLike = {
  id: string;
  customer: string | null;
  subscription?: string | null;
  currency?: string | null;
  created?: number | null;
};

type SubscriptionLike = {
  id: string;
};

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

type StripeClient = ReturnType<typeof getStripeClient>;
type ExpandedCheckoutSession = Awaited<ReturnType<typeof getExpandedCheckoutSession>>;
type ExpandedPaymentIntent = ExpandedCheckoutSession['payment_intent'] extends infer T
  ? Exclude<T, string | null>
  : never;

function parseMetadataInteger(metadata: Record<string, string>, key: string) {
  const value = Number(metadata[key] ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function extractPaymentMethodId(
  paymentIntent: ExpandedPaymentIntent | null | undefined
) {
  if (!paymentIntent?.payment_method) return null;
  return typeof paymentIntent.payment_method === 'string'
    ? paymentIntent.payment_method
    : paymentIntent.payment_method.id;
}

async function getExpandedCheckoutSession(sessionId: string) {
  const stripe = getStripeClient();
  return stripe.checkout.sessions.retrieve(sessionId, {
    expand: ['invoice', 'payment_intent.payment_method', 'setup_intent.payment_method'],
  });
}

async function resolveDefaultPaymentMethodId(args: {
  stripe: StripeClient;
  customerId: string;
  paymentIntent: ExpandedPaymentIntent | null;
}) {
  const directPaymentMethodId = extractPaymentMethodId(args.paymentIntent);
  if (directPaymentMethodId) {
    await args.stripe.customers.update(args.customerId, {
      invoice_settings: {
        default_payment_method: directPaymentMethodId,
      },
    });
    return directPaymentMethodId;
  }

  const customer = await args.stripe.customers.retrieve(args.customerId);
  if (customer.deleted) return null;
  const defaultPaymentMethod = customer.invoice_settings.default_payment_method;
  if (!defaultPaymentMethod) return null;
  return typeof defaultPaymentMethod === 'string' ? defaultPaymentMethod : defaultPaymentMethod.id;
}

async function syncAccountPaymentMethodUpdate(session: ExpandedCheckoutSession) {
  const metadata = session.metadata ?? {};
  if (metadata.flowKind !== 'account_payment_method_update' || !metadata.accountId) {
    return false;
  }

  const customerId = typeof session.customer === 'string' ? session.customer : null;
  if (!customerId) {
    throw new Error('Missing Stripe customer for payment method update');
  }

  const setupIntent =
    session.setup_intent && typeof session.setup_intent !== 'string' ? session.setup_intent : null;
  const paymentMethodId =
    setupIntent?.payment_method && typeof setupIntent.payment_method !== 'string'
      ? setupIntent.payment_method.id
      : typeof setupIntent?.payment_method === 'string'
        ? setupIntent.payment_method
        : null;

  if (!paymentMethodId) {
    throw new Error('Missing reusable payment method for update session');
  }

  const stripe = getStripeClient();
  await stripe.customers.update(customerId, {
    invoice_settings: {
      default_payment_method: paymentMethodId,
    },
  });

  const supabase = getSupabaseAdminClient();
  const { data: billing, error: billingError } = await supabase
    .from('account_billing')
    .select('stripe_subscription_id')
    .eq('account_id', metadata.accountId)
    .maybeSingle();
  if (billingError) throw new Error(billingError.message);

  if (billing?.stripe_subscription_id) {
    await stripe.subscriptions.update(billing.stripe_subscription_id, {
      default_payment_method: paymentMethodId,
    });
  }

  const paymentRoute =
    metadata.paymentRoute === 'ach' || metadata.paymentRoute === 'card'
      ? metadata.paymentRoute
      : 'card';
  const { error } = await supabase
    .from('account_billing')
    .update({
      preferred_payment_route: paymentRoute,
      updated_at: new Date().toISOString(),
    })
    .eq('account_id', metadata.accountId);
  if (error) throw new Error(error.message);

  return true;
}

async function ensureRecurringSubscription(session: ExpandedCheckoutSession) {
  const stripe = getStripeClient();
  const metadata = session.metadata ?? {};
  const invitationId = metadata.invitationId;
  const customerId = typeof session.customer === 'string' ? session.customer : null;
  if (!invitationId || !customerId) return null;

  const existingSubscriptions = await stripe.subscriptions.list({
    customer: customerId,
    status: 'all',
    limit: 10,
  });
  const activeForInvite = existingSubscriptions.data.find(
    (subscription) => subscription.metadata?.invitationId === invitationId
  );
  if (activeForInvite) {
    return {
      subscriptionId: activeForInvite.id,
      firstRecurringCouponId:
        activeForInvite.metadata?.firstRecurringCouponId &&
        activeForInvite.metadata.firstRecurringCouponId.length > 0
          ? activeForInvite.metadata.firstRecurringCouponId
          : null,
      paymentMethodId:
        typeof activeForInvite.default_payment_method === 'string'
          ? activeForInvite.default_payment_method
          : activeForInvite.default_payment_method?.id ?? null,
      upfrontInvoiceId:
        typeof session.invoice === 'string' ? session.invoice : session.invoice?.id ?? null,
      upfrontPaymentIntentId:
        typeof session.payment_intent === 'string'
          ? session.payment_intent
          : session.payment_intent?.id ?? null,
    };
  }

  const monthlyRetainerCents = parseMetadataInteger(metadata, 'monthlyRetainerCents');
  const firstRecurringAmountDueCents =
    parseMetadataInteger(metadata, 'firstRecurringInvoiceAmountCents') || monthlyRetainerCents;
  const firstRecurringSubtotalCents =
    parseMetadataInteger(metadata, 'firstRecurringSubtotalCents') ||
    Math.max(
      monthlyRetainerCents - parseMetadataInteger(metadata, 'firstRecurringDiscountCents'),
      0,
    );
  const paymentRoute =
    metadata.paymentRoute === 'card' || metadata.paymentRoute === 'ach'
      ? (metadata.paymentRoute as PlatformPaymentRoute)
      : 'card';
  const overlapCreditCents = parseMetadataInteger(
    metadata,
    'firstRecurringDiscountCents'
  );
  const recurringQuote = buildPlatformRecurringInvoiceQuote({
    monthlyRetainerCents,
    firstRecurringSubtotalCents,
    paymentRoute,
    routeConfig: getServerPlatformPaymentFeeConfig()[paymentRoute],
  });
  const firstRecurringCouponAmountCents = resolveInviteRecurringCouponAmountCents({
    metadataCouponAmountCents: parseMetadataInteger(metadata, 'firstRecurringCouponAmountCents'),
    ongoingMonthlyTotalCents: recurringQuote.ongoingMonthlyTotalCents,
    firstRecurringInvoiceTotalCents: recurringQuote.firstRecurringTotalCents,
  });
  const ongoingMonthlyTotalCents =
    parseMetadataInteger(metadata, 'ongoingMonthlyTotalCents') ||
    recurringQuote.ongoingMonthlyTotalCents;
  const anchorDateIso = metadata.anchorDateIso;
  const billingCycleAnchor = anchorDateIso
    ? Math.floor(new Date(anchorDateIso).getTime() / 1000)
    : undefined;
  if (!billingCycleAnchor) {
    throw new Error('Missing recurring anchor date');
  }
  const paymentIntent =
    session.payment_intent && typeof session.payment_intent !== 'string'
      ? session.payment_intent
      : null;
  const defaultPaymentMethodId = await resolveDefaultPaymentMethodId({
    stripe,
    customerId,
    paymentIntent,
  });
  if (!defaultPaymentMethodId) {
    throw new Error('Missing reusable payment method for recurring subscription');
  }

  const recurringProduct = await stripe.products.create({
    name: 'Furnace managed outreach',
  });
  const firstRecurringCoupon =
    firstRecurringCouponAmountCents > 0
      ? await stripe.coupons.create(
          buildInviteRecurringCouponParams({
            amountOff: firstRecurringCouponAmountCents,
            currency: metadata.currency ?? 'usd',
            invitationId,
            firstRecurringInvoiceAmountCents: firstRecurringAmountDueCents,
            overlapCreditCents,
            paymentRoute,
          }),
        )
      : null;

  const subscription = await stripe.subscriptions.create({
    customer: customerId,
    billing_cycle_anchor: billingCycleAnchor,
    proration_behavior: 'none',
    default_payment_method: defaultPaymentMethodId,
    metadata: {
      invitationId,
      checkoutSessionId: session.id,
      upfrontInvoiceId:
        typeof session.invoice === 'string' ? session.invoice : session.invoice?.id ?? '',
      firstRecurringCouponId: firstRecurringCoupon?.id ?? '',
    },
    items: [
      {
        price_data: {
          currency: metadata.currency ?? 'usd',
          recurring: { interval: 'month' },
          unit_amount: ongoingMonthlyTotalCents,
          product: recurringProduct.id,
        },
      },
    ],
    ...(firstRecurringCoupon
      ? {
          discounts: [{ coupon: firstRecurringCoupon.id }],
        }
      : {}),
  });

  return {
    subscriptionId: subscription.id,
    firstRecurringCouponId: firstRecurringCoupon?.id ?? null,
    paymentMethodId: defaultPaymentMethodId,
    upfrontInvoiceId:
      typeof session.invoice === 'string' ? session.invoice : session.invoice?.id ?? null,
    upfrontPaymentIntentId:
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id ?? null,
  };
}

async function ensureAccountUpgradeRecurringSubscription(session: ExpandedCheckoutSession) {
  const stripe = getStripeClient();
  const metadata = session.metadata ?? {};
  const accountId = metadata.accountId;
  const amendmentId = metadata.amendmentId;
  const customerId = typeof session.customer === 'string' ? session.customer : null;
  if (!accountId || !amendmentId || !customerId) return null;

  const supabase = getSupabaseAdminClient();
  const { data: billing, error: billingError } = await supabase
    .from('account_billing')
    .select('stripe_subscription_id')
    .eq('account_id', accountId)
    .maybeSingle();
  if (billingError) throw new Error(billingError.message);

  if (billing?.stripe_subscription_id) {
    return {
      subscriptionId: billing.stripe_subscription_id,
      upfrontInvoiceId:
        typeof session.invoice === 'string' ? session.invoice : session.invoice?.id ?? null,
      upfrontPaymentIntentId:
        typeof session.payment_intent === 'string'
          ? session.payment_intent
          : session.payment_intent?.id ?? null,
    };
  }

  const existingSubscriptions = await stripe.subscriptions.list({
    customer: customerId,
    status: 'all',
    limit: 10,
  });
  const existingForAccount = existingSubscriptions.data.find(
    (subscription) => subscription.metadata?.accountId === accountId,
  );
  if (existingForAccount) {
    return {
      subscriptionId: existingForAccount.id,
      upfrontInvoiceId:
        typeof session.invoice === 'string' ? session.invoice : session.invoice?.id ?? null,
      upfrontPaymentIntentId:
        typeof session.payment_intent === 'string'
          ? session.payment_intent
          : session.payment_intent?.id ?? null,
    };
  }

  const paymentRoute =
    metadata.paymentRoute === 'card' || metadata.paymentRoute === 'ach'
      ? (metadata.paymentRoute as PlatformPaymentRoute)
      : 'card';
  const ongoingMonthlyTotalCents = parseMetadataInteger(metadata, 'ongoingMonthlyTotalCents');
  const anchorDateIso = metadata.anchorDateIso;
  const billingCycleAnchor = anchorDateIso
    ? Math.floor(new Date(anchorDateIso).getTime() / 1000)
    : undefined;
  if (!billingCycleAnchor) {
    throw new Error('Missing recurring anchor date');
  }

  const paymentIntent =
    session.payment_intent && typeof session.payment_intent !== 'string'
      ? session.payment_intent
      : null;
  const defaultPaymentMethodId = await resolveDefaultPaymentMethodId({
    stripe,
    customerId,
    paymentIntent,
  });
  if (!defaultPaymentMethodId) {
    throw new Error('Missing reusable payment method for recurring subscription');
  }

  const recurringProduct = await stripe.products.create({
    name: 'Furnace managed outreach',
    metadata: { accountId },
  });
  const subscription = await stripe.subscriptions.create({
    customer: customerId,
    billing_cycle_anchor: billingCycleAnchor,
    proration_behavior: 'none',
    default_payment_method: defaultPaymentMethodId,
    metadata: {
      accountId,
      amendmentId,
      checkoutSessionId: session.id,
      paymentRoute,
    },
    items: [
      {
        price_data: {
          currency: metadata.currency ?? 'usd',
          recurring: { interval: 'month' },
          unit_amount: ongoingMonthlyTotalCents,
          product: recurringProduct.id,
        },
      },
    ],
  });

  return {
    subscriptionId: subscription.id,
    upfrontInvoiceId:
      typeof session.invoice === 'string' ? session.invoice : session.invoice?.id ?? null,
    upfrontPaymentIntentId:
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id ?? null,
  };
}

async function handleAccountUpgradeInitialCheckoutCompleted(session: ExpandedCheckoutSession) {
  const metadata = session.metadata ?? {};
  const accountId = metadata.accountId;
  const amendmentId = metadata.amendmentId;
  if (!accountId || !amendmentId) {
    throw new Error('Missing account upgrade checkout metadata');
  }

  const recurringResult = await ensureAccountUpgradeRecurringSubscription(session);
  if (!recurringResult?.subscriptionId) {
    throw new Error('Missing recurring subscription for initial upgrade checkout');
  }

  const supabase = getSupabaseAdminClient();
  const { data: existingBilling, error: existingBillingError } = await supabase
    .from('account_billing')
    .select('accepted_amendment_id, stripe_subscription_id')
    .eq('account_id', accountId)
    .maybeSingle();
  if (existingBillingError) throw new Error(existingBillingError.message);
  if (
    existingBilling?.accepted_amendment_id === amendmentId &&
    existingBilling?.stripe_subscription_id === recurringResult.subscriptionId
  ) {
    return;
  }

  const nextInvoiceCreditCents = parseMetadataInteger(metadata, 'nextInvoiceCreditCents');
  const { error: completeError } = await supabase.rpc('complete_account_amendment_upgrade', {
    p_amendment_id: amendmentId,
    p_new_monthly_retainer_cents: parseMetadataInteger(metadata, 'newMonthlyRetainerCents'),
    p_pending_first_delta_coupon_cents: nextInvoiceCreditCents > 0 ? nextInvoiceCreditCents : null,
    p_upgrade_delta_invoice_id: recurringResult.upfrontInvoiceId ?? null,
    p_accepted_by_user_id: metadata.userId ?? null,
  });
  if (completeError) throw new Error(completeError.message);

  const paymentRoute =
    metadata.paymentRoute === 'ach' || metadata.paymentRoute === 'card'
      ? metadata.paymentRoute
      : null;
  const { error: updateError } = await supabase
    .from('account_billing')
    .update({
      stripe_customer_id: typeof session.customer === 'string' ? session.customer : null,
      stripe_subscription_id: recurringResult.subscriptionId,
      preferred_payment_route: paymentRoute,
      updated_at: new Date().toISOString(),
    })
    .eq('account_id', accountId);
  if (updateError) throw new Error(updateError.message);

  const { error: activateError } = await supabase.rpc('set_account_billing_status', {
    p_account_id: accountId,
    p_billing_status: 'active',
  });
  if (activateError) throw new Error(activateError.message);
}

async function handleCheckoutCompleted(event: CheckoutSessionLike) {
  const session = await getExpandedCheckoutSession(event.id);
  if (await syncAccountPaymentMethodUpdate(session)) {
    return;
  }
  if (session.metadata?.flowKind === 'account_upgrade_initial') {
    await handleAccountUpgradeInitialCheckoutCompleted(session);
    return;
  }

  const invitationId = event.metadata?.invitationId;
  if (!invitationId) return;
  const recurringResult =
    typeof session.subscription === 'string'
      ? {
          subscriptionId: session.subscription,
          firstRecurringCouponId: null,
          paymentMethodId: null,
          upfrontInvoiceId:
            typeof session.invoice === 'string' ? session.invoice : session.invoice?.id ?? null,
          upfrontPaymentIntentId:
            typeof session.payment_intent === 'string'
              ? session.payment_intent
              : session.payment_intent?.id ?? null,
        }
      : (await ensureRecurringSubscription(session));
  const subscriptionId = recurringResult?.subscriptionId ?? null;

  const supabase = getSupabaseAdminClient();
  const { data: completeResult, error } = await supabase.rpc('complete_platform_invitation', {
    p_invitation_id: invitationId,
    p_stripe_customer_id: typeof session.customer === 'string' ? session.customer : '',
    p_stripe_subscription_id: subscriptionId ?? '',
    p_stripe_checkout_session_id: event.id,
    p_internal_admin_emails: INTERNAL_ADMIN_EMAILS,
  });
  if (error) throw new Error(error.message);

  const completedAccountId =
    completeResult && typeof completeResult === 'object' && 'account_id' in completeResult
      ? (completeResult.account_id as string | null)
      : null;
  const paymentRoute =
    session.metadata?.paymentRoute === 'ach' || session.metadata?.paymentRoute === 'card'
      ? session.metadata.paymentRoute
      : null;
  if (completedAccountId && paymentRoute) {
    const { error: billingUpdateError } = await supabase
      .from('account_billing')
      .update({
        preferred_payment_route: paymentRoute,
        updated_at: new Date().toISOString(),
      })
      .eq('account_id', completedAccountId);
    if (billingUpdateError) throw new Error(billingUpdateError.message);
  }

  const firstRecurringInvoiceTargetCents = parseMetadataInteger(
    session.metadata ?? {},
    'firstRecurringInvoiceAmountCents'
  );
  const recurringAnchorAt = session.metadata?.anchorDateIso ?? null;
  const { error: updateError } = await supabase
    .from('platform_invitations')
    .update({
      upfront_stripe_invoice_id: recurringResult?.upfrontInvoiceId ?? null,
      upfront_stripe_payment_intent_id: recurringResult?.upfrontPaymentIntentId ?? null,
      recurring_anchor_at: recurringAnchorAt,
      first_recurring_invoice_target_cents:
        firstRecurringInvoiceTargetCents > 0 ? firstRecurringInvoiceTargetCents : null,
      first_recurring_coupon_id: recurringResult?.firstRecurringCouponId ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', invitationId);
  if (updateError) throw new Error(updateError.message);
}

async function handleCheckoutAsyncPaymentFailed(event: CheckoutSessionLike) {
  if (
    event.metadata?.flowKind === 'account_upgrade_initial' &&
    typeof event.metadata?.accountId === 'string'
  ) {
    const supabase = getSupabaseAdminClient();
    const { error } = await supabase.rpc('set_account_billing_status', {
      p_account_id: event.metadata.accountId,
      p_billing_status: 'payment_required',
    });
    if (error) throw new Error(error.message);
    return;
  }

  const invitationId = event.metadata?.invitationId;
  if (!invitationId) return;

  const supabase = getSupabaseAdminClient();
  const { data: invitation, error: invitationError } = await supabase
    .from('platform_invitations')
    .select('created_account_id')
    .eq('id', invitationId)
    .maybeSingle();
  if (invitationError) throw new Error(invitationError.message);
  if (!invitation?.created_account_id) return;

  const { error } = await supabase.rpc('set_account_billing_status', {
    p_account_id: invitation.created_account_id,
    p_billing_status: 'payment_required',
  });
  if (error) throw new Error(error.message);
}

async function handleInvoicePaymentFailed(event: InvoiceLike) {
  const supabase = getSupabaseAdminClient();
  const stripe = getStripeClient();
  const invoice =
    typeof event.id === 'string'
      ? await stripe.invoices.retrieve(event.id)
      : null;
  const metadata = invoice?.metadata ?? {};
  const accountIdFromMetadata = metadata.accountId;

  if (metadata.invoiceKind === 'platform_upgrade_delta' && accountIdFromMetadata) {
    const { error } = await supabase.rpc('set_account_billing_status', {
      p_account_id: accountIdFromMetadata,
      p_billing_status: 'payment_required',
    });
    if (error) throw new Error(error.message);
    return;
  }

  const subscriptionId = typeof event.subscription === 'string' ? event.subscription : null;
  if (!subscriptionId) return;

  const { data: billing, error: billingError } = await supabase
    .from('account_billing')
    .select('account_id')
    .eq('stripe_subscription_id', subscriptionId)
    .maybeSingle();
  if (billingError) throw new Error(billingError.message);
  if (!billing) return;

  const { error } = await supabase.rpc('set_account_billing_status', {
    p_account_id: billing.account_id,
    p_billing_status: 'payment_required',
  });
  if (error) throw new Error(error.message);
}

async function handleInvoicePaid(event: InvoiceLike) {
  const stripe = getStripeClient();
  const invoice =
    typeof event.id === 'string'
      ? await stripe.invoices.retrieve(event.id)
      : null;
  const metadata = invoice?.metadata ?? {};
  const accountIdFromMetadata = metadata.accountId;

  if (metadata.invoiceKind === 'platform_upgrade_delta' && accountIdFromMetadata) {
    const supabase = getSupabaseAdminClient();
    const { error } = await supabase.rpc('set_account_billing_status', {
      p_account_id: accountIdFromMetadata,
      p_billing_status: 'active',
    });
    if (error) throw new Error(error.message);
    return;
  }

  const subscriptionId = typeof event.subscription === 'string' ? event.subscription : null;
  if (!subscriptionId) return;

  const supabase = getSupabaseAdminClient();
  const { data: billing, error: billingError } = await supabase
    .from('account_billing')
    .select('account_id')
    .eq('stripe_subscription_id', subscriptionId)
    .maybeSingle();
  if (billingError) throw new Error(billingError.message);
  if (!billing) return;

  const { error } = await supabase.rpc('set_account_billing_status', {
    p_account_id: billing.account_id,
    p_billing_status: 'active',
  });
  if (error) throw new Error(error.message);

  await maybeApplyScheduledRetainer(billing.account_id);
}

async function maybeApplyScheduledRetainer(accountId: string) {
  const supabase = getSupabaseAdminClient();
  const stripe = getStripeClient();
  const { data: billing, error: billingError } = await supabase
    .from('account_billing')
    .select(
      'account_id, stripe_subscription_id, monthly_retainer_cents, preferred_payment_route, scheduled_monthly_retainer_cents, scheduled_retainer_effective_at',
    )
    .eq('account_id', accountId)
    .maybeSingle();
  if (billingError) throw new Error(billingError.message);
  if (
    billing?.scheduled_monthly_retainer_cents == null ||
    !billing.scheduled_retainer_effective_at ||
    new Date(billing.scheduled_retainer_effective_at).getTime() > Date.now()
  ) {
    return;
  }
  if (!billing.stripe_subscription_id) {
    const { error } = await supabase.rpc('apply_scheduled_account_billing_retainer', {
      p_account_id: accountId,
    });
    if (error) throw new Error(error.message);
    return;
  }

  if (billing.scheduled_monthly_retainer_cents === 0) {
    await stripe.subscriptions.cancel(billing.stripe_subscription_id);
    const { error: applyError } = await supabase.rpc('apply_scheduled_account_billing_retainer', {
      p_account_id: accountId,
    });
    if (applyError) throw new Error(applyError.message);
    const { error: clearError } = await supabase
      .from('account_billing')
      .update({
        stripe_subscription_id: null,
        updated_at: new Date().toISOString(),
      })
      .eq('account_id', accountId);
    if (clearError) throw new Error(clearError.message);
    return;
  }

  const subscription = await stripe.subscriptions.retrieve(billing.stripe_subscription_id);
  const subscriptionItemId = subscription.items.data[0]?.id;
  if (!subscriptionItemId) return;

  const product = await stripe.products.create({
    name: 'Furnace managed outreach',
    metadata: { accountId },
  });
  const paymentRoute =
    billing.preferred_payment_route === 'ach' || billing.preferred_payment_route === 'card'
      ? (billing.preferred_payment_route as PlatformPaymentRoute)
      : 'card';
  const recurringQuote = buildPlatformRecurringInvoiceQuote({
    monthlyRetainerCents: billing.scheduled_monthly_retainer_cents,
    firstRecurringSubtotalCents: billing.scheduled_monthly_retainer_cents,
    paymentRoute,
    routeConfig: getServerPlatformPaymentFeeConfig()[paymentRoute],
  });

  await stripe.subscriptions.update(billing.stripe_subscription_id, {
    proration_behavior: 'none',
    items: [
      {
        id: subscriptionItemId,
        price_data: {
          currency: 'usd',
          recurring: { interval: 'month' },
          unit_amount: recurringQuote.ongoingMonthlyTotalCents,
          product: product.id,
        },
      },
    ],
  });

  const { error } = await supabase.rpc('apply_scheduled_account_billing_retainer', {
    p_account_id: accountId,
  });
  if (error) throw new Error(error.message);
}

async function handleSubscriptionDeleted(event: SubscriptionLike) {
  if (!event.id) return;

  const supabase = getSupabaseAdminClient();
  const { data: billing, error: billingError } = await supabase
    .from('account_billing')
    .select('account_id, scheduled_monthly_retainer_cents, scheduled_retainer_effective_at')
    .eq('stripe_subscription_id', event.id)
    .maybeSingle();
  if (billingError) throw new Error(billingError.message);
  if (!billing) return;
  if (
    billing.scheduled_monthly_retainer_cents !== 0 ||
    !billing.scheduled_retainer_effective_at ||
    new Date(billing.scheduled_retainer_effective_at).getTime() > Date.now()
  ) {
    return;
  }

  const { error: applyError } = await supabase.rpc('apply_scheduled_account_billing_retainer', {
    p_account_id: billing.account_id,
  });
  if (applyError) throw new Error(applyError.message);

  const { error: updateError } = await supabase
    .from('account_billing')
    .update({
      stripe_subscription_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq('account_id', billing.account_id);
  if (updateError) throw new Error(updateError.message);
}

async function handleInvoiceCreated(event: InvoiceLike) {
  const subscriptionId = typeof event.subscription === 'string' ? event.subscription : null;
  if (!subscriptionId) return;

  const supabase = getSupabaseAdminClient();
  const stripe = getStripeClient();
  const { data: billing, error: billingError } = await supabase
    .from('account_billing')
    .select('account_id, pending_first_delta_coupon_cents, stripe_customer_id')
    .eq('stripe_subscription_id', subscriptionId)
    .maybeSingle();
  if (billingError) throw new Error(billingError.message);
  if (!billing) return;

  if (billing.pending_first_delta_coupon_cents && billing.pending_first_delta_coupon_cents > 0) {
    const coupon = await stripe.coupons.create(
      buildUpgradeDeltaCouponParams({
        amountOff: billing.pending_first_delta_coupon_cents,
        currency: event.currency || 'usd',
        accountId: billing.account_id,
        invoiceId: event.id,
      }),
    );
    await stripe.invoices.update(event.id, {
      discounts: [{ coupon: coupon.id }],
    });
    const { error: clearCouponError } = await supabase
      .from('account_billing')
      .update({
        pending_first_delta_coupon_cents: null,
        updated_at: new Date().toISOString(),
      })
      .eq('account_id', billing.account_id);
    if (clearCouponError) throw new Error(clearCouponError.message);
  }

  const invoiceDate = new Date((event.created ?? Math.floor(Date.now() / 1000)) * 1000);
  const billingYear = invoiceDate.getUTCFullYear();
  const billingMonth = invoiceDate.getUTCMonth() + 1;

  const { data: adjustment, error: adjustmentError } = await supabase
    .from('billing_adjustments')
    .select('*')
    .eq('account_id', billing.account_id)
    .eq('billing_year', billingYear)
    .eq('billing_month', billingMonth)
    .is('applied_at', null)
    .maybeSingle();
  if (adjustmentError) throw new Error(adjustmentError.message);
  if (!adjustment || adjustment.discount_cents <= 0) return;

  const invoiceItem = await stripe.invoiceItems.create({
    customer: typeof event.customer === 'string' ? event.customer : undefined,
    invoice: event.id,
    currency: event.currency || 'usd',
    amount: -adjustment.discount_cents,
    description: `Furnace billing adjustment (${billingYear}-${String(billingMonth).padStart(2, '0')}): ${adjustment.reason}`,
  });

  const { error } = await supabase
    .from('billing_adjustments')
    .update({
      stripe_invoice_item_id: invoiceItem.id,
      applied_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', adjustment.id);
  if (error) throw new Error(error.message);
}

export const handler = async (event: { headers?: Record<string, string>; body?: string | null; isBase64Encoded?: boolean }) => {
  try {
    const stripe = getStripeClient();
    const signature = event.headers?.['stripe-signature'] || event.headers?.['Stripe-Signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!signature || !webhookSecret) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing Stripe webhook configuration' }) };
    }

    const rawBody = event.body
      ? (event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : event.body)
      : '';
    const stripeEvent = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);

    switch (stripeEvent.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(stripeEvent.data.object as CheckoutSessionLike);
        break;
      case 'checkout.session.async_payment_succeeded':
        await handleCheckoutCompleted(stripeEvent.data.object as CheckoutSessionLike);
        break;
      case 'checkout.session.async_payment_failed':
        await handleCheckoutAsyncPaymentFailed(stripeEvent.data.object as CheckoutSessionLike);
        break;
      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(stripeEvent.data.object as InvoiceLike);
        break;
      case 'invoice.paid':
        await handleInvoicePaid(stripeEvent.data.object as InvoiceLike);
        break;
      case 'invoice.created':
        await handleInvoiceCreated(stripeEvent.data.object as InvoiceLike);
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(stripeEvent.data.object as SubscriptionLike);
        break;
      default:
        break;
    }

    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[stripeWebhook]', message);
    return { statusCode: 400, body: JSON.stringify({ error: message }) };
  }
};
