import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STRIPE_WEBHOOK_EVENTS } from './events';
import { diffStripeWebhookSubscriptions } from './subscriptionDiff';

test('subscription diff adds missing required events without removing extras', () => {
  const diff = diffStripeWebhookSubscriptions({
    required: STRIPE_WEBHOOK_EVENTS,
    current: [
      'checkout.session.completed',
      'checkout.session.async_payment_succeeded',
      'checkout.session.async_payment_failed',
      'invoice.created',
      'invoice.paid',
      'invoice.payment_failed',
    ],
  });

  assert.deepEqual(diff.missing, [
    'payment_intent.processing',
    'payment_intent.succeeded',
    'payment_intent.payment_failed',
    'payment_intent.requires_action',
    'customer.subscription.deleted',
  ]);
  assert.deepEqual(diff.extra, []);
  assert.equal(diff.hasWildcard, false);
  assert.deepEqual(diff.merged, [
    'checkout.session.completed',
    'checkout.session.async_payment_succeeded',
    'checkout.session.async_payment_failed',
    'invoice.created',
    'invoice.paid',
    'invoice.payment_failed',
    'payment_intent.processing',
    'payment_intent.succeeded',
    'payment_intent.payment_failed',
    'payment_intent.requires_action',
    'customer.subscription.deleted',
  ]);
});

test('subscription diff preserves unrelated extra events', () => {
  const diff = diffStripeWebhookSubscriptions({
    required: ['payment_intent.processing'],
    current: ['charge.succeeded', 'payment_intent.processing'],
  });

  assert.deepEqual(diff.missing, []);
  assert.deepEqual(diff.extra, ['charge.succeeded']);
  assert.deepEqual(diff.merged, ['charge.succeeded', 'payment_intent.processing']);
});

test('subscription diff does not mutate a wildcard endpoint', () => {
  const diff = diffStripeWebhookSubscriptions({
    required: STRIPE_WEBHOOK_EVENTS,
    current: ['*'],
  });

  assert.equal(diff.hasWildcard, true);
  assert.deepEqual(diff.missing, []);
  assert.deepEqual(diff.merged, ['*']);
});

test('subscription diff dedupes current events before merge', () => {
  const diff = diffStripeWebhookSubscriptions({
    required: ['invoice.paid', 'payment_intent.processing'],
    current: ['invoice.paid', 'invoice.paid'],
  });

  assert.deepEqual(diff.current, ['invoice.paid']);
  assert.deepEqual(diff.missing, ['payment_intent.processing']);
  assert.deepEqual(diff.merged, ['invoice.paid', 'payment_intent.processing']);
});
