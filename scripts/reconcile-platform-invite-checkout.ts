/**
 * Support reconciler for platform invite checkout attempts.
 *
 * Dry-run by default. Explicit apply required.
 *
 *   INVITATION_ID=<uuid> npx tsx scripts/reconcile-platform-invite-checkout.ts
 *   INVITATION_ID=<uuid> APPLY=true npx tsx scripts/reconcile-platform-invite-checkout.ts
 *   INVITATION_ID=<uuid> CHECKOUT_SESSION_ID=cs_live_... APPLY=true npx tsx scripts/reconcile-platform-invite-checkout.ts
 */
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import {
  previewInviteCheckoutReconciliation,
  reconcileInviteCheckoutSession,
} from '../lib/billing/reconcileInviteCheckout';
import {
  fetchSecretFromParameterStore,
  loadSelfRecoveryEnv,
  resolveAmplifySecretParamPathForTarget,
  resolveSelfRecoveryTargetEnv,
  resolveSupabaseUrlForTarget,
} from './self-recovery-env';

async function main() {
  loadSelfRecoveryEnv();
  const invitationId = process.env.INVITATION_ID?.trim();
  if (!invitationId) {
    throw new Error('Set INVITATION_ID to the platform invitation UUID.');
  }
  const checkoutSessionId = process.env.CHECKOUT_SESSION_ID?.trim() || null;
  const apply = process.env.APPLY === 'true';
  const targetEnv = resolveSelfRecoveryTargetEnv();
  const awsRegion =
    process.env.AWS_REGION?.trim() ||
    process.env.CDK_DEFAULT_REGION?.trim() ||
    'us-west-2';

  const { url } = resolveSupabaseUrlForTarget(targetEnv);
  const supabaseSecretPath = resolveAmplifySecretParamPathForTarget(
    targetEnv,
    'SUPABASE_SECRET_KEY',
  );
  const stripeSecretPath = resolveAmplifySecretParamPathForTarget(targetEnv, 'STRIPE_SECRET_KEY');
  if (!url || !supabaseSecretPath || !stripeSecretPath) {
    throw new Error('Missing Supabase/Stripe secret configuration for target env.');
  }

  const [supabaseKey, stripeKey] = await Promise.all([
    fetchSecretFromParameterStore(supabaseSecretPath, awsRegion),
    fetchSecretFromParameterStore(stripeSecretPath, awsRegion),
  ]);

  const supabase = createClient(url, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const stripe = new Stripe(stripeKey);

  const { data: invitation, error: invitationError } = await supabase
    .from('platform_invitations')
    .select(
      'id, email, status, created_account_id, selected_payment_route, stripe_checkout_session_id, stripe_customer_id, stripe_subscription_id, current_checkout_attempt_id',
    )
    .eq('id', invitationId)
    .maybeSingle();
  if (invitationError) throw new Error(invitationError.message);
  if (!invitation) throw new Error('Invitation not found');

  let attempt = null as Record<string, unknown> | null;
  if (invitation.current_checkout_attempt_id) {
    const { data, error } = await supabase
      .from('platform_invite_checkout_attempts')
      .select('*')
      .eq('id', invitation.current_checkout_attempt_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    attempt = data;
  }

  const preview = await previewInviteCheckoutReconciliation({
    supabase,
    stripe,
    invitationId,
    checkoutSessionId,
  });

  console.log(
    JSON.stringify(
      {
        mode: apply ? 'APPLY' : 'DRY_RUN',
        targetEnv,
        invitation,
        currentAttempt: attempt,
        stripePhase: preview.stripePhase,
        proposedFurnaceTransition: {
          kind: preview.proposedActionKind,
          reason: preview.proposedActionReason,
        },
        alreadyProvisioned: preview.alreadyProvisioned,
        needsReplacementCheckout: preview.needsReplacementCheckout,
        isCurrentAttempt: preview.isCurrentAttempt,
        hostedVerificationUrl: preview.hostedVerificationUrl,
        failureSummary: preview.failureSummary,
        checkoutSessionId: preview.checkoutSessionId,
        paymentIntentId: preview.paymentIntentId,
        paymentRoute: preview.paymentRoute,
      },
      null,
      2,
    ),
  );

  if (!apply) {
    console.log(
      'Dry-run only. Re-run with APPLY=true to reconcile against live Stripe and update Furnace.',
    );
    return;
  }

  const result = await reconcileInviteCheckoutSession({
    supabase,
    stripe,
    invitationId,
    checkoutSessionId: checkoutSessionId ?? invitation.stripe_checkout_session_id,
  });

  console.log(JSON.stringify({ result }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
