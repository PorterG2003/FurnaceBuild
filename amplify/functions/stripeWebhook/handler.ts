import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

const INTERNAL_ADMIN_EMAILS = ['porter@getfurnace.io', 'kyle@getfurnace.io'];

type CheckoutSessionLike = {
  id: string;
  customer: string | null;
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

async function ensureRecurringSubscription(event: CheckoutSessionLike) {
  const stripe = getStripeClient();
  const metadata = event.metadata ?? {};
  const invitationId = metadata.invitationId;
  if (!invitationId || !event.customer) return;

  const existingSubscriptions = await stripe.subscriptions.list({
    customer: String(event.customer),
    status: 'all',
    limit: 10,
  });
  const activeForInvite = existingSubscriptions.data.find(
    (subscription) => subscription.metadata?.invitationId === invitationId
  );
  if (activeForInvite) {
    return activeForInvite.id;
  }

  const monthlyRetainerCents = Number(metadata.monthlyRetainerCents ?? 0);
  const firstRecurringInvoiceAmountCents = Number(metadata.firstRecurringInvoiceAmountCents ?? monthlyRetainerCents);
  const firstRecurringCreditCents = Number(metadata.firstRecurringCreditCents ?? 0);
  const anchorDateIso = metadata.anchorDateIso;
  const trialEndUnix = anchorDateIso ? Math.floor(new Date(anchorDateIso).getTime() / 1000) : undefined;
  const recurringProduct = await stripe.products.create({
    name: 'Furnace managed outreach',
  });

  const subscription = await stripe.subscriptions.create({
    customer: String(event.customer),
    trial_end: trialEndUnix,
    metadata: {
      invitationId,
      checkoutSessionId: event.id,
    },
    items: [
      {
        price_data: {
          currency: metadata.currency ?? 'usd',
          recurring: { interval: 'month' },
          unit_amount: monthlyRetainerCents,
          product: recurringProduct.id,
        },
      },
    ],
    ...(firstRecurringCreditCents > 0
      ? {
          add_invoice_items: [
            {
              price_data: {
                currency: metadata.currency ?? 'usd',
                unit_amount: -firstRecurringCreditCents,
                product: recurringProduct.id,
              },
            },
          ],
        }
      : {}),
  });

  return subscription.id;
}

async function handleCheckoutCompleted(event: CheckoutSessionLike) {
  const invitationId = event.metadata?.invitationId;
  if (!invitationId) return;

  const subscriptionId =
    typeof event.subscription === 'string'
      ? event.subscription
      : (await ensureRecurringSubscription(event));

  const supabase = getSupabaseAdminClient();
  const { error } = await supabase.rpc('complete_platform_invitation', {
    p_invitation_id: invitationId,
    p_stripe_customer_id: typeof event.customer === 'string' ? event.customer : '',
    p_stripe_subscription_id: subscriptionId ?? '',
    p_stripe_checkout_session_id: event.id,
    p_internal_admin_emails: INTERNAL_ADMIN_EMAILS,
  });
  if (error) throw new Error(error.message);
}

async function handleCheckoutAsyncPaymentFailed(event: CheckoutSessionLike) {
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
    p_billing_status: 'payment_required',
  });
  if (error) throw new Error(error.message);
}

async function handleInvoicePaid(event: InvoiceLike) {
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
}

async function handleInvoiceCreated(event: InvoiceLike) {
  const subscriptionId = typeof event.subscription === 'string' ? event.subscription : null;
  if (!subscriptionId) return;

  const supabase = getSupabaseAdminClient();
  const stripe = getStripeClient();
  const { data: billing, error: billingError } = await supabase
    .from('account_billing')
    .select('account_id')
    .eq('stripe_subscription_id', subscriptionId)
    .maybeSingle();
  if (billingError) throw new Error(billingError.message);
  if (!billing) return;

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
