export const STRIPE_WEBHOOK_EVENTS = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'payment_intent.processing',
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'payment_intent.requires_action',
  'invoice.payment_failed',
  'invoice.paid',
  'invoice.created',
  'customer.subscription.deleted',
] as const;

export type StripeWebhookEventType = (typeof STRIPE_WEBHOOK_EVENTS)[number];

export type StripeWebhookDispatchKind =
  | 'checkout_completed'
  | 'checkout_async_failed'
  | 'invite_payment_intent'
  | 'invoice_payment_failed'
  | 'invoice_paid'
  | 'invoice_created'
  | 'subscription_deleted'
  | 'ignored';

const STRIPE_WEBHOOK_EVENT_SET = new Set<string>(STRIPE_WEBHOOK_EVENTS);

export function isStripeWebhookEvent(type: string): type is StripeWebhookEventType {
  return STRIPE_WEBHOOK_EVENT_SET.has(type);
}

export function resolveStripeWebhookDispatch(type: string): StripeWebhookDispatchKind {
  if (!isStripeWebhookEvent(type)) return 'ignored';

  switch (type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      return 'checkout_completed';
    case 'checkout.session.async_payment_failed':
      return 'checkout_async_failed';
    case 'payment_intent.processing':
    case 'payment_intent.succeeded':
    case 'payment_intent.payment_failed':
    case 'payment_intent.requires_action':
      return 'invite_payment_intent';
    case 'invoice.payment_failed':
      return 'invoice_payment_failed';
    case 'invoice.paid':
      return 'invoice_paid';
    case 'invoice.created':
      return 'invoice_created';
    case 'customer.subscription.deleted':
      return 'subscription_deleted';
    default: {
      const exhaustive: never = type;
      return exhaustive;
    }
  }
}

export async function resolveInvitePaymentIntentInvitationId(args: {
  metadataInvitationId?: string | null;
  paymentIntentId: string;
  lookupByPaymentIntentId: (paymentIntentId: string) => Promise<string | null>;
}): Promise<string | null> {
  const fromMetadata = args.metadataInvitationId?.trim() || null;
  if (fromMetadata) return fromMetadata;
  return args.lookupByPaymentIntentId(args.paymentIntentId);
}
