import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildPlatformRecurringInvoiceQuote,
  getServerPlatformPaymentFeeConfig,
  type PlatformPaymentRoute,
} from './paymentRoutes';
import {
  mergeInviteCheckoutPhase,
  normalizeInviteCheckoutPhase,
  resolveInviteCheckoutAction,
  type InviteCheckoutPhase,
} from './inviteCheckoutPhase';
import {
  buildInviteRecurringCouponParams,
  resolveInviteRecurringCouponAmountCents,
} from './stripeCoupons';

export const PLATFORM_INVITE_INTERNAL_ADMIN_EMAILS = [
  'porter@getfurnace.io',
  'kyle@getfurnace.io',
] as const;

export type InviteCheckoutAttemptRow = {
  id: string;
  invitation_id: string;
  stripe_checkout_session_id: string;
  stripe_payment_intent_id: string | null;
  stripe_customer_id: string | null;
  payment_route: PlatformPaymentRoute | null;
  phase: InviteCheckoutPhase;
  hosted_verification_url: string | null;
  failure_summary: string | null;
  last_stripe_event_id: string | null;
  last_stripe_event_type: string | null;
  last_reconciled_at: string | null;
  provisioned_at: string | null;
};

export type InviteCheckoutStatusResult = {
  invitationId: string;
  invitationStatus: string;
  phase: InviteCheckoutPhase;
  accountId: string | null;
  checkoutSessionId: string | null;
  paymentRoute: PlatformPaymentRoute | null;
  hostedVerificationUrl: string | null;
  failureSummary: string | null;
  canReplaceCheckout: boolean;
  alreadyProvisioned: boolean;
  provisionedNow: boolean;
};

// Amplify functions install Stripe independently from the app root. Keep this
// shared boundary structural so different compatible stripe-node versions do
// not become nominally incompatible during backend synthesis.
type StripeClient = {
  checkout: { sessions: { retrieve: (...args: any[]) => Promise<any> } };
  customers: {
    retrieve: (...args: any[]) => Promise<any>;
    update: (...args: any[]) => Promise<any>;
  };
  paymentMethods: {
    retrieve: (...args: any[]) => Promise<any>;
    attach: (...args: any[]) => Promise<any>;
  };
  subscriptions: {
    list: (...args: any[]) => Promise<any>;
    create: (...args: any[]) => Promise<any>;
  };
  products: { create: (...args: any[]) => Promise<any> };
  coupons: { create: (...args: any[]) => Promise<any> };
};

type PaymentIntent = {
  id: string;
  status: string;
  payment_method?: string | { id: string } | null;
  next_action?: {
    type: string;
    verify_with_microdeposits?: {
      hosted_verification_url?: string | null;
    } | null;
  } | null;
};

type CheckoutSession = {
  id: string;
  status: string | null;
  payment_status: string;
  customer?: string | { id: string } | null;
  invoice?: string | { id: string } | null;
  payment_intent?: string | PaymentIntent | null;
  subscription?: string | { id: string } | null;
  metadata?: Record<string, string> | null;
};

function parseMetadataInteger(metadata: Record<string, string>, key: string) {
  const value = Number(metadata[key] ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function asPaymentRoute(value: string | null | undefined): PlatformPaymentRoute | null {
  return value === 'card' || value === 'ach' ? value : null;
}

function extractPaymentMethodId(
  paymentIntent: PaymentIntent | null | undefined,
): string | null {
  if (!paymentIntent?.payment_method) return null;
  return typeof paymentIntent.payment_method === 'string'
    ? paymentIntent.payment_method
    : paymentIntent.payment_method.id;
}

function extractHostedVerificationUrl(
  paymentIntent: PaymentIntent | null | undefined,
): string | null {
  const nextAction = paymentIntent?.next_action;
  if (!nextAction || nextAction.type !== 'verify_with_microdeposits') return null;
  const url = nextAction.verify_with_microdeposits?.hosted_verification_url;
  return typeof url === 'string' && url.length > 0 ? url : null;
}

export async function claimInviteStripeEvent(args: {
  supabase: SupabaseClient;
  stripeEventId: string;
  eventType: string;
  invitationId?: string | null;
  checkoutAttemptId?: string | null;
  handlerResult: string;
}): Promise<'claimed' | 'duplicate'> {
  const { error } = await args.supabase.from('platform_invite_stripe_events').insert({
    stripe_event_id: args.stripeEventId,
    event_type: args.eventType,
    invitation_id: args.invitationId ?? null,
    checkout_attempt_id: args.checkoutAttemptId ?? null,
    handler_result: args.handlerResult,
  });
  if (!error) return 'claimed';
  if (error.code === '23505') return 'duplicate';
  throw new Error(error.message);
}

export async function ensureReusablePaymentMethodForCustomer(args: {
  stripe: StripeClient;
  customerId: string;
  paymentIntent: PaymentIntent | null;
}): Promise<string | null> {
  const paymentMethodId = extractPaymentMethodId(args.paymentIntent);
  if (!paymentMethodId) {
    const customer = await args.stripe.customers.retrieve(args.customerId);
    if (customer.deleted) return null;
    const defaultPaymentMethod = customer.invoice_settings.default_payment_method;
    if (!defaultPaymentMethod) return null;
    return typeof defaultPaymentMethod === 'string'
      ? defaultPaymentMethod
      : defaultPaymentMethod.id;
  }

  const paymentMethod = await args.stripe.paymentMethods.retrieve(paymentMethodId);
  if (!paymentMethod.customer) {
    await args.stripe.paymentMethods.attach(paymentMethodId, {
      customer: args.customerId,
    });
  } else if (paymentMethod.customer !== args.customerId) {
    throw new Error('Payment method belongs to a different Stripe customer');
  }

  await args.stripe.customers.update(args.customerId, {
    invoice_settings: {
      default_payment_method: paymentMethodId,
    },
  });
  return paymentMethodId;
}

export async function ensureInviteRecurringSubscription(args: {
  stripe: StripeClient;
  session: CheckoutSession;
  paymentIntent: PaymentIntent | null;
}): Promise<{
  subscriptionId: string;
  firstRecurringCouponId: string | null;
  paymentMethodId: string | null;
  upfrontInvoiceId: string | null;
  upfrontPaymentIntentId: string | null;
} | null> {
  const metadata = (args.session.metadata ?? {}) as Record<string, string>;
  const invitationId = metadata.invitationId;
  const customerId =
    typeof args.session.customer === 'string' ? args.session.customer : null;
  if (!invitationId || !customerId) return null;

  const existingSubscriptions = await args.stripe.subscriptions.list({
    customer: customerId,
    status: 'all',
    limit: 10,
  });
  const activeForInvite = existingSubscriptions.data.find(
    (subscription: {
      id: string;
      metadata?: Record<string, string> | null;
      default_payment_method?: string | { id: string } | null;
    }) => subscription.metadata?.invitationId === invitationId,
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
        typeof args.session.invoice === 'string'
          ? args.session.invoice
          : args.session.invoice?.id ?? null,
      upfrontPaymentIntentId: args.paymentIntent?.id ?? null,
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
  const overlapCreditCents = parseMetadataInteger(metadata, 'firstRecurringDiscountCents');
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

  const defaultPaymentMethodId = await ensureReusablePaymentMethodForCustomer({
    stripe: args.stripe,
    customerId,
    paymentIntent: args.paymentIntent,
  });
  if (!defaultPaymentMethodId) {
    throw new Error('Missing reusable payment method for recurring subscription');
  }

  const recurringProduct = await args.stripe.products.create(
    { name: 'Furnace managed outreach' },
    { idempotencyKey: `invite-product-${invitationId}` },
  );
  const firstRecurringCoupon =
    firstRecurringCouponAmountCents > 0
      ? await args.stripe.coupons.create(
          buildInviteRecurringCouponParams({
            amountOff: firstRecurringCouponAmountCents,
            currency: metadata.currency ?? 'usd',
            invitationId,
            firstRecurringInvoiceAmountCents: firstRecurringAmountDueCents,
            overlapCreditCents,
            paymentRoute,
          }),
          { idempotencyKey: `invite-coupon-${invitationId}` },
        )
      : null;

  const subscription = await args.stripe.subscriptions.create(
    {
      customer: customerId,
      billing_cycle_anchor: billingCycleAnchor,
      proration_behavior: 'none',
      default_payment_method: defaultPaymentMethodId,
      metadata: {
        invitationId,
        checkoutSessionId: args.session.id,
        upfrontInvoiceId:
          typeof args.session.invoice === 'string'
            ? args.session.invoice
            : args.session.invoice?.id ?? '',
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
    },
    { idempotencyKey: `invite-sub-${invitationId}` },
  );

  return {
    subscriptionId: subscription.id,
    firstRecurringCouponId: firstRecurringCoupon?.id ?? null,
    paymentMethodId: defaultPaymentMethodId,
    upfrontInvoiceId:
      typeof args.session.invoice === 'string'
        ? args.session.invoice
        : args.session.invoice?.id ?? null,
    upfrontPaymentIntentId: args.paymentIntent?.id ?? null,
  };
}

async function loadInvitationForCheckout(
  supabase: SupabaseClient,
  invitationId: string,
) {
  const { data, error } = await supabase
    .from('platform_invitations')
    .select(
      'id, email, status, created_account_id, current_checkout_attempt_id, selected_payment_route, stripe_checkout_session_id, stripe_customer_id, accepted_by_user_id, terms_accepted_at, prepared_full_name, prepared_account_name',
    )
    .eq('id', invitationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function loadAttemptBySession(
  supabase: SupabaseClient,
  sessionId: string,
): Promise<InviteCheckoutAttemptRow | null> {
  const { data, error } = await supabase
    .from('platform_invite_checkout_attempts')
    .select('*')
    .eq('stripe_checkout_session_id', sessionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as InviteCheckoutAttemptRow | null) ?? null;
}

async function loadAttemptByPaymentIntent(
  supabase: SupabaseClient,
  paymentIntentId: string,
): Promise<InviteCheckoutAttemptRow | null> {
  const { data, error } = await supabase
    .from('platform_invite_checkout_attempts')
    .select('*')
    .eq('stripe_payment_intent_id', paymentIntentId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as InviteCheckoutAttemptRow | null) ?? null;
}

export async function upsertInviteCheckoutAttempt(args: {
  supabase: SupabaseClient;
  invitationId: string;
  stripeCheckoutSessionId: string;
  stripePaymentIntentId?: string | null;
  stripeCustomerId?: string | null;
  paymentRoute?: PlatformPaymentRoute | null;
  phase: InviteCheckoutPhase;
  hostedVerificationUrl?: string | null;
  failureSummary?: string | null;
  makeCurrent?: boolean;
  stripeEventId?: string | null;
  stripeEventType?: string | null;
  markProvisioned?: boolean;
}): Promise<InviteCheckoutAttemptRow> {
  const existing = await loadAttemptBySession(args.supabase, args.stripeCheckoutSessionId);
  const nextPhase = mergeInviteCheckoutPhase(existing?.phase, args.phase);
  const payload = {
    invitation_id: args.invitationId,
    stripe_checkout_session_id: args.stripeCheckoutSessionId,
    stripe_payment_intent_id:
      args.stripePaymentIntentId ?? existing?.stripe_payment_intent_id ?? null,
    stripe_customer_id: args.stripeCustomerId ?? existing?.stripe_customer_id ?? null,
    payment_route: args.paymentRoute ?? existing?.payment_route ?? null,
    phase: nextPhase,
    hosted_verification_url:
      args.hostedVerificationUrl !== undefined
        ? args.hostedVerificationUrl
        : existing?.hosted_verification_url ?? null,
    failure_summary:
      args.failureSummary !== undefined
        ? args.failureSummary
        : nextPhase === 'failed' || nextPhase === 'expired'
          ? existing?.failure_summary ?? null
          : null,
    last_stripe_event_id: args.stripeEventId ?? existing?.last_stripe_event_id ?? null,
    last_stripe_event_type: args.stripeEventType ?? existing?.last_stripe_event_type ?? null,
    last_reconciled_at: new Date().toISOString(),
    provisioned_at: args.markProvisioned
      ? existing?.provisioned_at ?? new Date().toISOString()
      : existing?.provisioned_at ?? null,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await args.supabase
    .from('platform_invite_checkout_attempts')
    .upsert(payload, { onConflict: 'stripe_checkout_session_id' })
    .select('*')
    .single();
  if (error) throw new Error(error.message);

  if (args.makeCurrent !== false) {
    const { error: invitationError } = await args.supabase
      .from('platform_invitations')
      .update({
        current_checkout_attempt_id: data.id,
        stripe_checkout_session_id: args.stripeCheckoutSessionId,
        stripe_customer_id: payload.stripe_customer_id,
        selected_payment_route: payload.payment_route,
        updated_at: new Date().toISOString(),
      })
      .eq('id', args.invitationId);
    if (invitationError) throw new Error(invitationError.message);
  }

  return data as InviteCheckoutAttemptRow;
}

async function expandCheckoutSession(
  stripe: StripeClient,
  sessionId: string,
): Promise<{
  session: CheckoutSession;
  paymentIntent: PaymentIntent | null;
}> {
  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ['invoice', 'payment_intent.payment_method'],
  });
  const paymentIntent =
    session.payment_intent && typeof session.payment_intent !== 'string'
      ? session.payment_intent
      : null;
  return { session, paymentIntent };
}

export function buildInviteCheckoutReconciliationPlan(input: {
  invitationStatus: string;
  invitationAccountId: string | null;
  currentAttemptId: string | null;
  invitationCheckoutSessionId: string | null;
  attempt: Pick<InviteCheckoutAttemptRow, 'id' | 'phase' | 'stripe_checkout_session_id'> | null;
  checkoutSessionId: string;
  sessionStatus: string | null | undefined;
  paymentStatus: string | null | undefined;
  paymentIntentStatus: string | null | undefined;
  nextActionType: string | null | undefined;
  hostedVerificationUrl: string | null | undefined;
  paymentRoute: PlatformPaymentRoute | null;
  forceReplaceCurrent?: boolean;
}) {
  const normalized = normalizeInviteCheckoutPhase({
    sessionStatus: input.sessionStatus,
    paymentStatus: input.paymentStatus,
    paymentIntentStatus: input.paymentIntentStatus,
    nextActionType: input.nextActionType,
    hostedVerificationUrl: input.hostedVerificationUrl,
    paymentRoute: input.paymentRoute,
  });
  const isCurrentAttempt =
    !input.currentAttemptId ||
    input.currentAttemptId === input.attempt?.id ||
    input.invitationCheckoutSessionId === input.checkoutSessionId ||
    input.forceReplaceCurrent === true;
  const action = resolveInviteCheckoutAction({
    phase: normalized.phase,
    invitationAlreadyProvisioned: Boolean(input.invitationAccountId),
    isCurrentAttempt,
    hostedVerificationUrl: normalized.hostedVerificationUrl,
    failureSummary: normalized.failureSummary,
  });

  return {
    stripePhase: normalized.phase,
    hostedVerificationUrl: normalized.hostedVerificationUrl,
    failureSummary: normalized.failureSummary,
    isCurrentAttempt,
    alreadyProvisioned: Boolean(input.invitationAccountId),
    proposedAction: action,
    needsReplacementCheckout: action.canReplaceCheckout,
  };
}

export async function previewInviteCheckoutReconciliation(args: {
  supabase: SupabaseClient;
  stripe: StripeClient;
  invitationId: string;
  checkoutSessionId?: string | null;
}): Promise<{
  invitationId: string;
  invitationStatus: string;
  checkoutSessionId: string | null;
  paymentIntentId: string | null;
  paymentRoute: PlatformPaymentRoute | null;
  stripePhase: InviteCheckoutPhase;
  proposedActionKind: string;
  proposedActionReason: string;
  alreadyProvisioned: boolean;
  needsReplacementCheckout: boolean;
  hostedVerificationUrl: string | null;
  failureSummary: string | null;
  isCurrentAttempt: boolean;
}> {
  const invitation = await loadInvitationForCheckout(args.supabase, args.invitationId);
  if (!invitation) throw new Error('Invitation not found');

  let attempt: InviteCheckoutAttemptRow | null = null;
  let checkoutSessionId =
    args.checkoutSessionId ?? invitation.stripe_checkout_session_id ?? null;

  if (invitation.current_checkout_attempt_id) {
    const { data, error } = await args.supabase
      .from('platform_invite_checkout_attempts')
      .select('*')
      .eq('id', invitation.current_checkout_attempt_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    attempt = (data as InviteCheckoutAttemptRow | null) ?? null;
    checkoutSessionId =
      checkoutSessionId ??
      attempt?.stripe_checkout_session_id ??
      invitation.stripe_checkout_session_id;
  }

  if (!checkoutSessionId) {
    return {
      invitationId: args.invitationId,
      invitationStatus: invitation.status,
      checkoutSessionId: null,
      paymentIntentId: null,
      paymentRoute: asPaymentRoute(invitation.selected_payment_route),
      stripePhase: 'awaiting_checkout',
      proposedActionKind: 'noop',
      proposedActionReason: 'No checkout session exists yet.',
      alreadyProvisioned: Boolean(invitation.created_account_id),
      needsReplacementCheckout: true,
      hostedVerificationUrl: null,
      failureSummary: null,
      isCurrentAttempt: true,
    };
  }

  const { session, paymentIntent } = await expandCheckoutSession(args.stripe, checkoutSessionId);
  const paymentRoute =
    asPaymentRoute(session.metadata?.paymentRoute) ??
    asPaymentRoute(invitation.selected_payment_route) ??
    attempt?.payment_route ??
    null;
  const plan = buildInviteCheckoutReconciliationPlan({
    invitationStatus: invitation.status,
    invitationAccountId: invitation.created_account_id,
    currentAttemptId: invitation.current_checkout_attempt_id,
    invitationCheckoutSessionId: invitation.stripe_checkout_session_id,
    attempt,
    checkoutSessionId,
    sessionStatus: session.status,
    paymentStatus: session.payment_status,
    paymentIntentStatus: paymentIntent?.status ?? null,
    nextActionType: paymentIntent?.next_action?.type ?? null,
    hostedVerificationUrl: extractHostedVerificationUrl(paymentIntent),
    paymentRoute,
  });

  return {
    invitationId: args.invitationId,
    invitationStatus: invitation.status,
    checkoutSessionId,
    paymentIntentId: paymentIntent?.id ?? null,
    paymentRoute,
    stripePhase: plan.stripePhase,
    proposedActionKind: plan.proposedAction.kind,
    proposedActionReason: plan.proposedAction.reason,
    alreadyProvisioned: plan.alreadyProvisioned,
    needsReplacementCheckout: plan.needsReplacementCheckout,
    hostedVerificationUrl: plan.hostedVerificationUrl,
    failureSummary: plan.failureSummary,
    isCurrentAttempt: plan.isCurrentAttempt,
  };
}

export async function reconcileInviteCheckoutSession(args: {
  supabase: SupabaseClient;
  stripe: StripeClient;
  invitationId?: string | null;
  checkoutSessionId?: string | null;
  paymentIntentId?: string | null;
  stripeEventId?: string | null;
  stripeEventType?: string | null;
  forceReplaceCurrent?: boolean;
}): Promise<InviteCheckoutStatusResult> {
  let attempt: InviteCheckoutAttemptRow | null = null;
  let invitationId = args.invitationId ?? null;
  let checkoutSessionId = args.checkoutSessionId ?? null;

  if (!checkoutSessionId && args.paymentIntentId) {
    attempt = await loadAttemptByPaymentIntent(args.supabase, args.paymentIntentId);
    checkoutSessionId = attempt?.stripe_checkout_session_id ?? null;
    invitationId = invitationId ?? attempt?.invitation_id ?? null;
  }

  if (!checkoutSessionId && invitationId) {
    const invitation = await loadInvitationForCheckout(args.supabase, invitationId);
    if (!invitation) {
      throw new Error('Invitation not found');
    }
    if (invitation.current_checkout_attempt_id) {
      const { data, error } = await args.supabase
        .from('platform_invite_checkout_attempts')
        .select('*')
        .eq('id', invitation.current_checkout_attempt_id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      attempt = (data as InviteCheckoutAttemptRow | null) ?? null;
      checkoutSessionId = attempt?.stripe_checkout_session_id ?? invitation.stripe_checkout_session_id;
    } else {
      checkoutSessionId = invitation.stripe_checkout_session_id;
    }
  }

  if (!checkoutSessionId) {
    if (!invitationId) throw new Error('Missing checkout session for reconciliation');
    const invitation = await loadInvitationForCheckout(args.supabase, invitationId);
    return {
      invitationId,
      invitationStatus: invitation?.status ?? 'not_found',
      phase: 'awaiting_checkout',
      accountId: invitation?.created_account_id ?? null,
      checkoutSessionId: null,
      paymentRoute: asPaymentRoute(invitation?.selected_payment_route),
      hostedVerificationUrl: null,
      failureSummary: null,
      canReplaceCheckout: true,
      alreadyProvisioned: Boolean(invitation?.created_account_id),
      provisionedNow: false,
    };
  }

  const { session, paymentIntent } = await expandCheckoutSession(args.stripe, checkoutSessionId);
  invitationId =
    invitationId ??
    session.metadata?.invitationId ??
    attempt?.invitation_id ??
    null;
  if (!invitationId) {
    throw new Error('Checkout session is missing invitation metadata');
  }

  const invitation = await loadInvitationForCheckout(args.supabase, invitationId);
  if (!invitation) throw new Error('Invitation not found');

  const paymentRoute =
    asPaymentRoute(session.metadata?.paymentRoute) ??
    asPaymentRoute(invitation.selected_payment_route) ??
    attempt?.payment_route ??
    null;

  const existingAttempt =
    attempt ?? (await loadAttemptBySession(args.supabase, checkoutSessionId));
  const plan = buildInviteCheckoutReconciliationPlan({
    invitationStatus: invitation.status,
    invitationAccountId: invitation.created_account_id,
    currentAttemptId: invitation.current_checkout_attempt_id,
    invitationCheckoutSessionId: invitation.stripe_checkout_session_id,
    attempt: existingAttempt,
    checkoutSessionId,
    sessionStatus: session.status,
    paymentStatus: session.payment_status,
    paymentIntentStatus: paymentIntent?.status ?? null,
    nextActionType: paymentIntent?.next_action?.type ?? null,
    hostedVerificationUrl: extractHostedVerificationUrl(paymentIntent),
    paymentRoute,
    forceReplaceCurrent: args.forceReplaceCurrent,
  });
  const normalized = {
    phase: plan.stripePhase,
    hostedVerificationUrl: plan.hostedVerificationUrl,
    failureSummary: plan.failureSummary,
  };
  const isCurrentAttempt = plan.isCurrentAttempt;
  const action = plan.proposedAction;

  if (args.stripeEventId) {
    const claim = await claimInviteStripeEvent({
      supabase: args.supabase,
      stripeEventId: args.stripeEventId,
      eventType: args.stripeEventType ?? 'manual_reconcile',
      invitationId,
      checkoutAttemptId: existingAttempt?.id ?? null,
      handlerResult: action.kind,
    });
    if (claim === 'duplicate' && action.kind !== 'provision') {
      const latestAttempt =
        existingAttempt ?? (await loadAttemptBySession(args.supabase, checkoutSessionId));
      return {
        invitationId,
        invitationStatus: invitation.status,
        phase: latestAttempt?.phase ?? normalized.phase,
        accountId: invitation.created_account_id,
        checkoutSessionId,
        paymentRoute,
        hostedVerificationUrl: latestAttempt?.hosted_verification_url ?? null,
        failureSummary: latestAttempt?.failure_summary ?? null,
        canReplaceCheckout: action.canReplaceCheckout,
        alreadyProvisioned: Boolean(invitation.created_account_id),
        provisionedNow: false,
      };
    }
  }

  let provisionedNow = false;
  let accountId = invitation.created_account_id;
  let invitationStatus = invitation.status;

  if (action.kind === 'provision') {
    const recurringResult =
      typeof session.subscription === 'string'
        ? {
            subscriptionId: session.subscription,
            firstRecurringCouponId: null,
            paymentMethodId: null,
            upfrontInvoiceId:
              typeof session.invoice === 'string' ? session.invoice : session.invoice?.id ?? null,
            upfrontPaymentIntentId: paymentIntent?.id ?? null,
          }
        : await ensureInviteRecurringSubscription({
            stripe: args.stripe,
            session,
            paymentIntent,
          });

    const { data: completeResult, error: completeError } = await args.supabase.rpc(
      'complete_platform_invitation',
      {
        p_invitation_id: invitationId,
        p_stripe_customer_id:
          typeof session.customer === 'string' ? session.customer : invitation.stripe_customer_id ?? '',
        p_stripe_subscription_id: recurringResult?.subscriptionId ?? '',
        p_stripe_checkout_session_id: checkoutSessionId,
        p_internal_admin_emails: [...PLATFORM_INVITE_INTERNAL_ADMIN_EMAILS],
      },
    );
    if (completeError) throw new Error(completeError.message);

    accountId =
      completeResult && typeof completeResult === 'object' && 'account_id' in completeResult
        ? ((completeResult.account_id as string | null) ?? null)
        : accountId;
    provisionedNow =
      Boolean(accountId) &&
      !(
        completeResult &&
        typeof completeResult === 'object' &&
        'status' in completeResult &&
        completeResult.status === 'already_completed'
      );
    invitationStatus = 'active';

    if (accountId && paymentRoute) {
      const { error: billingUpdateError } = await args.supabase
        .from('account_billing')
        .update({
          preferred_payment_route: paymentRoute,
          updated_at: new Date().toISOString(),
        })
        .eq('account_id', accountId);
      if (billingUpdateError) throw new Error(billingUpdateError.message);
    }

    const { error: inviteUpdateError } = await args.supabase
      .from('platform_invitations')
      .update({
        upfront_stripe_invoice_id: recurringResult?.upfrontInvoiceId ?? null,
        upfront_stripe_payment_intent_id: recurringResult?.upfrontPaymentIntentId ?? null,
        recurring_anchor_at: session.metadata?.anchorDateIso ?? null,
        first_recurring_invoice_target_cents:
          parseMetadataInteger(
            (session.metadata ?? {}) as Record<string, string>,
            'firstRecurringInvoiceAmountCents',
          ) || null,
        first_recurring_coupon_id: recurringResult?.firstRecurringCouponId ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', invitationId);
    if (inviteUpdateError) throw new Error(inviteUpdateError.message);
  }

  if (action.kind === 'mark_payment_required' && accountId) {
    const { error } = await args.supabase.rpc('set_account_billing_status', {
      p_account_id: accountId,
      p_billing_status: 'payment_required',
    });
    if (error) throw new Error(error.message);
  }

  const savedAttempt = await upsertInviteCheckoutAttempt({
    supabase: args.supabase,
    invitationId,
    stripeCheckoutSessionId: checkoutSessionId,
    stripePaymentIntentId: paymentIntent?.id ?? null,
    stripeCustomerId: typeof session.customer === 'string' ? session.customer : null,
    paymentRoute,
    phase: action.phase,
    hostedVerificationUrl: normalized.hostedVerificationUrl,
    failureSummary: action.failureSummary ?? normalized.failureSummary,
    makeCurrent: isCurrentAttempt,
    stripeEventId: args.stripeEventId,
    stripeEventType: args.stripeEventType,
    markProvisioned: action.kind === 'provision' || Boolean(accountId),
  });

  return {
    invitationId,
    invitationStatus,
    phase: savedAttempt.phase,
    accountId,
    checkoutSessionId,
    paymentRoute,
    hostedVerificationUrl: savedAttempt.hosted_verification_url,
    failureSummary: savedAttempt.failure_summary,
    canReplaceCheckout: action.canReplaceCheckout,
    alreadyProvisioned: Boolean(accountId),
    provisionedNow,
  };
}
