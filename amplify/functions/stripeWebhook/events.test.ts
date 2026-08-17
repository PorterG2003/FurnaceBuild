import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  STRIPE_WEBHOOK_EVENTS,
  resolveInvitePaymentIntentInvitationId,
  resolveStripeWebhookDispatch,
} from './events';

test('stripe webhook event contract is unique and includes ACH processing', () => {
  assert.equal(new Set(STRIPE_WEBHOOK_EVENTS).size, STRIPE_WEBHOOK_EVENTS.length);
  assert.ok(STRIPE_WEBHOOK_EVENTS.includes('payment_intent.processing'));
  assert.ok(STRIPE_WEBHOOK_EVENTS.includes('checkout.session.async_payment_succeeded'));
  assert.ok(STRIPE_WEBHOOK_EVENTS.includes('customer.subscription.deleted'));
});

test('payment_intent.processing routes to invite payment intent dispatch', () => {
  assert.equal(resolveStripeWebhookDispatch('payment_intent.processing'), 'invite_payment_intent');
  assert.equal(resolveStripeWebhookDispatch('payment_intent.requires_action'), 'invite_payment_intent');
  assert.equal(resolveStripeWebhookDispatch('payment_intent.succeeded'), 'invite_payment_intent');
  assert.equal(resolveStripeWebhookDispatch('payment_intent.payment_failed'), 'invite_payment_intent');
});

test('unsupported Stripe events are ignored', () => {
  assert.equal(resolveStripeWebhookDispatch('charge.succeeded'), 'ignored');
  assert.equal(resolveStripeWebhookDispatch('customer.subscription.updated'), 'ignored');
});

test('checkout and invoice events keep their existing dispatch kinds', () => {
  assert.equal(resolveStripeWebhookDispatch('checkout.session.completed'), 'checkout_completed');
  assert.equal(
    resolveStripeWebhookDispatch('checkout.session.async_payment_succeeded'),
    'checkout_completed',
  );
  assert.equal(
    resolveStripeWebhookDispatch('checkout.session.async_payment_failed'),
    'checkout_async_failed',
  );
  assert.equal(resolveStripeWebhookDispatch('invoice.paid'), 'invoice_paid');
  assert.equal(resolveStripeWebhookDispatch('invoice.created'), 'invoice_created');
  assert.equal(resolveStripeWebhookDispatch('invoice.payment_failed'), 'invoice_payment_failed');
  assert.equal(
    resolveStripeWebhookDispatch('customer.subscription.deleted'),
    'subscription_deleted',
  );
});

test('payment intent invitation id prefers metadata then attempt lookup', async () => {
  const lookups: string[] = [];
  const fromMetadata = await resolveInvitePaymentIntentInvitationId({
    metadataInvitationId: 'inv-from-metadata',
    paymentIntentId: 'pi_test',
    lookupByPaymentIntentId: async (paymentIntentId) => {
      lookups.push(paymentIntentId);
      return 'inv-from-lookup';
    },
  });
  assert.equal(fromMetadata, 'inv-from-metadata');
  assert.equal(lookups.length, 0);

  const fromLookup = await resolveInvitePaymentIntentInvitationId({
    metadataInvitationId: null,
    paymentIntentId: 'pi_test',
    lookupByPaymentIntentId: async (paymentIntentId) => {
      lookups.push(paymentIntentId);
      return 'inv-from-lookup';
    },
  });
  assert.equal(fromLookup, 'inv-from-lookup');
  assert.deepEqual(lookups, ['pi_test']);

  const missing = await resolveInvitePaymentIntentInvitationId({
    metadataInvitationId: '  ',
    paymentIntentId: 'pi_missing',
    lookupByPaymentIntentId: async () => null,
  });
  assert.equal(missing, null);
});
