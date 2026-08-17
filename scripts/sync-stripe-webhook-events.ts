/**
 * Compare live Stripe webhook subscriptions to the handler event contract.
 *
 * Dry-run by default. Explicit apply required.
 *
 *   WEBHOOK_ENDPOINT_ID=we_... npx tsx scripts/sync-stripe-webhook-events.ts
 *   WEBHOOK_ENDPOINT_ID=we_... APPLY=true npx tsx scripts/sync-stripe-webhook-events.ts
 */
import Stripe from 'stripe';
import { STRIPE_WEBHOOK_EVENTS } from '../amplify/functions/stripeWebhook/events';
import { diffStripeWebhookSubscriptions } from '../amplify/functions/stripeWebhook/subscriptionDiff';
import {
  fetchSecretFromParameterStore,
  loadSelfRecoveryEnv,
  resolveAmplifySecretParamPathForTarget,
  resolveSelfRecoveryTargetEnv,
} from './self-recovery-env';

async function main() {
  loadSelfRecoveryEnv();
  const webhookEndpointId = process.env.WEBHOOK_ENDPOINT_ID?.trim();
  if (!webhookEndpointId) {
    throw new Error('Set WEBHOOK_ENDPOINT_ID to the Stripe webhook endpoint id (we_...).');
  }

  const apply = process.env.APPLY === 'true';
  const targetEnv = resolveSelfRecoveryTargetEnv();
  const awsRegion =
    process.env.AWS_REGION?.trim() ||
    process.env.CDK_DEFAULT_REGION?.trim() ||
    'us-west-2';
  const stripeSecretPath = resolveAmplifySecretParamPathForTarget(targetEnv, 'STRIPE_SECRET_KEY');
  if (!stripeSecretPath) {
    throw new Error('Missing Stripe secret configuration for target env.');
  }

  const stripeKey = await fetchSecretFromParameterStore(stripeSecretPath, awsRegion);
  const stripe = new Stripe(stripeKey);
  const endpoint = await stripe.webhookEndpoints.retrieve(webhookEndpointId);
  const diff = diffStripeWebhookSubscriptions({
    required: STRIPE_WEBHOOK_EVENTS,
    current: endpoint.enabled_events,
  });

  console.log(
    JSON.stringify(
      {
        mode: apply ? 'APPLY' : 'DRY_RUN',
        targetEnv,
        webhookEndpointId: endpoint.id,
        url: endpoint.url,
        status: endpoint.status,
        required: [...STRIPE_WEBHOOK_EVENTS],
        current: diff.current,
        missing: diff.missing,
        extra: diff.extra,
        merged: diff.merged,
        hasWildcard: diff.hasWildcard,
        signingSecretRotated: false,
      },
      null,
      2,
    ),
  );

  if (!apply) {
    console.log(
      'Dry-run only. Re-run with APPLY=true to add missing required events. Existing extra events and the signing secret are left unchanged.',
    );
    return;
  }

  if (diff.hasWildcard) {
    console.log('Endpoint already uses wildcard subscriptions; no update applied.');
    return;
  }

  if (diff.missing.length === 0) {
    console.log('No missing required events; no update applied.');
    return;
  }

  const updated = await stripe.webhookEndpoints.update(webhookEndpointId, {
    enabled_events: diff.merged as Stripe.WebhookEndpointUpdateParams.EnabledEvent[],
  });
  const after = diffStripeWebhookSubscriptions({
    required: STRIPE_WEBHOOK_EVENTS,
    current: updated.enabled_events,
  });

  console.log(
    JSON.stringify(
      {
        result: 'updated',
        webhookEndpointId: updated.id,
        current: after.current,
        missing: after.missing,
        extra: after.extra,
        signingSecretRotated: false,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
