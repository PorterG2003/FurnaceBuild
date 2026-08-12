import { buildAdminInvitePreviewUrl } from '@/lib/platform/invite/preview';
import {
  getProposalPlanPreset,
  type ProposalPlanTier,
} from '@/lib/platform/contract/proposalPlans';
import type { InviteCheckoutPhase } from '@/lib/billing/inviteCheckoutPhase';
import type { SeedModule } from '../types';

type PreviewVariant = {
  id: string;
  revisionId: string;
  label: string;
  email: string;
  companyName: string;
  tier: ProposalPlanTier;
  websiteTrafficSourcingEnabled?: boolean;
  replyHandlingEnabled?: boolean;
};

type RecoveryQaVariant = {
  id: string;
  revisionId: string;
  attemptId: string;
  label: string;
  email: string;
  companyName: string;
  phase: InviteCheckoutPhase;
  sessionId: string;
  paymentIntentId: string;
  hostedVerificationUrl?: string | null;
  failureSummary?: string | null;
};

const previewVariants: PreviewVariant[] = [
  {
    id: 'c1000000-0000-4000-8000-000000000001',
    revisionId: 'c2000000-0000-4000-8000-000000000001',
    label: 'Bronze',
    email: 'preview-bronze@furnace.test',
    companyName: 'Bronze Preview Co',
    tier: 'bronze',
  },
  {
    id: 'c1000000-0000-4000-8000-000000000002',
    revisionId: 'c2000000-0000-4000-8000-000000000002',
    label: 'Bronze + website traffic sourcing',
    email: 'preview-bronze-traffic@furnace.test',
    companyName: 'Bronze Traffic Preview Co',
    tier: 'bronze',
    websiteTrafficSourcingEnabled: true,
  },
  {
    id: 'c1000000-0000-4000-8000-000000000003',
    revisionId: 'c2000000-0000-4000-8000-000000000003',
    label: 'Bronze + reply handling',
    email: 'preview-bronze-replies@furnace.test',
    companyName: 'Bronze Replies Preview Co',
    tier: 'bronze',
    replyHandlingEnabled: true,
  },
  {
    id: 'c1000000-0000-4000-8000-000000000004',
    revisionId: 'c2000000-0000-4000-8000-000000000004',
    label: 'Bronze + website traffic sourcing + reply handling',
    email: 'preview-bronze-combo@furnace.test',
    companyName: 'Bronze Combo Preview Co',
    tier: 'bronze',
    websiteTrafficSourcingEnabled: true,
    replyHandlingEnabled: true,
  },
  {
    id: 'c1000000-0000-4000-8000-000000000005',
    revisionId: 'c2000000-0000-4000-8000-000000000005',
    label: 'Silver',
    email: 'preview-silver@furnace.test',
    companyName: 'Silver Preview Co',
    tier: 'silver',
  },
  {
    id: 'c1000000-0000-4000-8000-000000000006',
    revisionId: 'c2000000-0000-4000-8000-000000000006',
    label: 'Silver + website traffic sourcing',
    email: 'preview-silver-traffic@furnace.test',
    companyName: 'Silver Traffic Preview Co',
    tier: 'silver',
    websiteTrafficSourcingEnabled: true,
  },
  {
    id: 'c1000000-0000-4000-8000-000000000007',
    revisionId: 'c2000000-0000-4000-8000-000000000007',
    label: 'Silver + reply handling',
    email: 'preview-silver-replies@furnace.test',
    companyName: 'Silver Replies Preview Co',
    tier: 'silver',
    replyHandlingEnabled: true,
  },
  {
    id: 'c1000000-0000-4000-8000-000000000008',
    revisionId: 'c2000000-0000-4000-8000-000000000008',
    label: 'Silver + website traffic sourcing + reply handling',
    email: 'preview-silver-combo@furnace.test',
    companyName: 'Silver Combo Preview Co',
    tier: 'silver',
    websiteTrafficSourcingEnabled: true,
    replyHandlingEnabled: true,
  },
  {
    id: 'c1000000-0000-4000-8000-000000000009',
    revisionId: 'c2000000-0000-4000-8000-000000000009',
    label: 'Gold',
    email: 'preview-gold@furnace.test',
    companyName: 'Gold Preview Co',
    tier: 'gold',
  },
  {
    id: 'c1000000-0000-4000-8000-00000000000a',
    revisionId: 'c2000000-0000-4000-8000-00000000000a',
    label: 'Gold + website traffic sourcing',
    email: 'preview-gold-traffic@furnace.test',
    companyName: 'Gold Traffic Preview Co',
    tier: 'gold',
    websiteTrafficSourcingEnabled: true,
  },
  {
    id: 'c1000000-0000-4000-8000-00000000000b',
    revisionId: 'c2000000-0000-4000-8000-00000000000b',
    label: 'Gold + reply handling',
    email: 'preview-gold-replies@furnace.test',
    companyName: 'Gold Replies Preview Co',
    tier: 'gold',
    replyHandlingEnabled: true,
  },
  {
    id: 'c1000000-0000-4000-8000-00000000000c',
    revisionId: 'c2000000-0000-4000-8000-00000000000c',
    label: 'Gold + website traffic sourcing + reply handling',
    email: 'preview-gold-combo@furnace.test',
    companyName: 'Gold Combo Preview Co',
    tier: 'gold',
    websiteTrafficSourcingEnabled: true,
    replyHandlingEnabled: true,
  },
];

const recoveryQaVariants: RecoveryQaVariant[] = [
  {
    id: 'c1000000-0000-4000-8000-000000000101',
    revisionId: 'c2000000-0000-4000-8000-000000000101',
    attemptId: 'c3000000-0000-4000-8000-000000000101',
    label: 'ACH verification required',
    email: 'preview-ach-verify@furnace.test',
    companyName: 'ACH Verify Preview Co',
    phase: 'verification_required',
    sessionId: 'cs_test_seed_ach_verify',
    paymentIntentId: 'pi_test_seed_ach_verify',
    hostedVerificationUrl: 'https://payments.stripe.com/microdeposit/test_seed_verify',
  },
  {
    id: 'c1000000-0000-4000-8000-000000000102',
    revisionId: 'c2000000-0000-4000-8000-000000000102',
    attemptId: 'c3000000-0000-4000-8000-000000000102',
    label: 'ACH processing / activating',
    email: 'preview-ach-processing@furnace.test',
    companyName: 'ACH Processing Preview Co',
    phase: 'processing',
    sessionId: 'cs_test_seed_ach_processing',
    paymentIntentId: 'pi_test_seed_ach_processing',
  },
  {
    id: 'c1000000-0000-4000-8000-000000000103',
    revisionId: 'c2000000-0000-4000-8000-000000000103',
    attemptId: 'c3000000-0000-4000-8000-000000000103',
    label: 'Failed ACH before activation',
    email: 'preview-ach-failed@furnace.test',
    companyName: 'ACH Failed Preview Co',
    phase: 'failed',
    sessionId: 'cs_test_seed_ach_failed',
    paymentIntentId: 'pi_test_seed_ach_failed',
    failureSummary: 'Bank payment failed or was canceled.',
  },
  {
    id: 'c1000000-0000-4000-8000-000000000104',
    revisionId: 'c2000000-0000-4000-8000-000000000104',
    attemptId: 'c3000000-0000-4000-8000-000000000104',
    label: 'Expired checkout before activation',
    email: 'preview-ach-expired@furnace.test',
    companyName: 'ACH Expired Preview Co',
    phase: 'expired',
    sessionId: 'cs_test_seed_ach_expired',
    paymentIntentId: 'pi_test_seed_ach_expired',
    failureSummary: 'Checkout session expired before payment completed.',
  },
];

function getPreviewOrigin() {
  const candidates = [
    process.env.SEED_PREVIEW_ORIGIN,
    process.env.EXPO_PUBLIC_APP_URL,
    process.env.NEXT_PUBLIC_APP_URL,
  ];
  const origin = candidates.find((value) => typeof value === 'string' && value.trim());
  return origin ? origin.replace(/\/$/, '') : null;
}

function buildProposalSnapshot(variant: PreviewVariant) {
  const preset = getProposalPlanPreset(variant.tier);
  return {
    proposal_title: preset.proposalTitle,
    client_logo_url: '',
    plan_tier: variant.tier,
    website_traffic_sourcing_enabled: Boolean(variant.websiteTrafficSourcingEnabled),
    reply_handling_enabled: Boolean(variant.replyHandlingEnabled),
  };
}

async function getSeedAdminUserId(ctx: Parameters<SeedModule['run']>[0]) {
  const adminResult = await ctx.supabase
    .from('user_access_flags')
    .select('user_id')
    .eq('flag_key', 'platform_admin')
    .limit(1)
    .maybeSingle();
  if (adminResult.data?.user_id) return adminResult.data.user_id as string;

  const fallbackUser = await ctx.supabase.from('users').select('id').limit(1).maybeSingle();
  if (fallbackUser.data?.id) return fallbackUser.data.id as string;

  throw new Error('No admin or fallback user exists to own preview invitations.');
}

async function getSeedTerms(ctx: Parameters<SeedModule['run']>[0]) {
  const { data, error } = await ctx.supabase
    .from('platform_terms_versions')
    .select('version, agreement_type, body_markdown, is_default')
    .eq('agreement_type', 'platform_agreement')
    .order('is_default', { ascending: false })
    .order('effective_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new Error('No platform terms versions exist; create one before seeding previews.');
  }
  return data as { version: string; agreement_type: 'platform_agreement'; body_markdown: string };
}

export const platformInvitePreviewSeedModule: SeedModule = {
  id: 'platformInvitePreview_seed',
  description: 'Create deterministic platform invite preview and ACH recovery QA variants',
  async run(ctx) {
    const previewOrigin = getPreviewOrigin();
    const printPreviewLinks = () => {
      ctx.log('preview links');
      for (const variant of previewVariants) {
        const relativeUrl = buildAdminInvitePreviewUrl({
          invitationId: variant.id,
          revisionNumber: 1,
          embedded: true,
        });
        ctx.log(`${variant.label}: ${previewOrigin ? `${previewOrigin}${relativeUrl}` : relativeUrl}`);
      }
      ctx.log('recovery QA invite links');
      for (const variant of recoveryQaVariants) {
        const relativeUrl = `/accept-platform-invite/${variant.id}?checkout=return&session_id=${variant.sessionId}`;
        ctx.log(
          `${variant.label} (${variant.phase}): ${
            previewOrigin ? `${previewOrigin}${relativeUrl}` : relativeUrl
          }`,
        );
      }
    };
    if (ctx.dryRun) {
      ctx.log(
        `scenario=${ctx.scenarioId} module=platformInvitePreview_seed [dry-run] — would seed ${previewVariants.length} preview invitations and ${recoveryQaVariants.length} recovery QA invites`,
      );
      printPreviewLinks();
      return;
    }

    const invitedByUserId = await getSeedAdminUserId(ctx);
    const terms = await getSeedTerms(ctx);
    const emails = [
      ...previewVariants.map((variant) => variant.email.toLowerCase()),
      ...recoveryQaVariants.map((variant) => variant.email.toLowerCase()),
    ];
    const ids = [
      ...previewVariants.map((variant) => variant.id),
      ...recoveryQaVariants.map((variant) => variant.id),
    ];
    const attemptIds = recoveryQaVariants.map((variant) => variant.attemptId);

    const { error: attemptDeleteError } = await ctx.supabase
      .from('platform_invite_checkout_attempts')
      .delete()
      .in('id', attemptIds);
    if (attemptDeleteError && !/does not exist|schema cache/i.test(attemptDeleteError.message)) {
      throw attemptDeleteError;
    }

    const { error: deleteError } = await ctx.supabase
      .from('platform_invitations')
      .delete()
      .in('id', ids)
      .in('email', emails);
    if (deleteError) {
      throw deleteError;
    }

    for (const variant of previewVariants) {
      const preset = getProposalPlanPreset(variant.tier);
      const invitationRow = {
        id: variant.id,
        email: variant.email.toLowerCase(),
        invited_by_user_id: invitedByUserId,
        status: 'draft',
        proposed_account_name: variant.companyName,
        monthly_retainer_cents: preset.paymentDefaultCents,
        currency: 'usd',
        proposal_snapshot_json: buildProposalSnapshot(variant),
        agreement_type: terms.agreement_type,
        terms_version: terms.version,
        terms_source_markdown: terms.body_markdown,
        terms_snapshot_markdown: terms.body_markdown,
        auto_add_internal_admins: true,
        current_revision_number: 1,
      };
      const { error: invitationError } = await ctx.supabase
        .from('platform_invitations')
        .insert(invitationRow);
      if (invitationError) {
        throw invitationError;
      }

      const revisionRow = {
        id: variant.revisionId,
        invitation_id: variant.id,
        revision_number: 1,
        email: variant.email.toLowerCase(),
        proposed_account_name: variant.companyName,
        monthly_retainer_cents: preset.paymentDefaultCents,
        currency: 'usd',
        proposal_snapshot_json: buildProposalSnapshot(variant),
        agreement_type: terms.agreement_type,
        terms_version: terms.version,
        terms_source_markdown: terms.body_markdown,
        terms_snapshot_markdown: terms.body_markdown,
        created_by_user_id: invitedByUserId,
      };
      const { error: revisionError } = await ctx.supabase
        .from('platform_invitation_revisions')
        .insert(revisionRow);
      if (revisionError) {
        throw revisionError;
      }
    }

    const bronzePreset = getProposalPlanPreset('bronze');
    for (const variant of recoveryQaVariants) {
      const proposalSnapshot = {
        proposal_title: bronzePreset.proposalTitle,
        client_logo_url: '',
        plan_tier: 'bronze' as const,
        website_traffic_sourcing_enabled: false,
        reply_handling_enabled: false,
      };
      const invitationRow = {
        id: variant.id,
        email: variant.email.toLowerCase(),
        invited_by_user_id: invitedByUserId,
        status: 'pending_payment',
        proposed_account_name: variant.companyName,
        monthly_retainer_cents: bronzePreset.paymentDefaultCents,
        currency: 'usd',
        proposal_snapshot_json: proposalSnapshot,
        agreement_type: terms.agreement_type,
        terms_version: terms.version,
        terms_source_markdown: terms.body_markdown,
        terms_snapshot_markdown: terms.body_markdown,
        auto_add_internal_admins: true,
        current_revision_number: 1,
        published_revision_number: 1,
        checkout_revision_number: 1,
        selected_payment_route: 'ach',
        stripe_checkout_session_id: variant.sessionId,
        terms_accepted_at: new Date().toISOString(),
        prepared_full_name: 'QA Preview',
        prepared_account_name: variant.companyName,
      };
      const { error: invitationError } = await ctx.supabase
        .from('platform_invitations')
        .insert(invitationRow);
      if (invitationError) {
        throw invitationError;
      }

      const revisionRow = {
        id: variant.revisionId,
        invitation_id: variant.id,
        revision_number: 1,
        email: variant.email.toLowerCase(),
        proposed_account_name: variant.companyName,
        monthly_retainer_cents: bronzePreset.paymentDefaultCents,
        currency: 'usd',
        proposal_snapshot_json: proposalSnapshot,
        agreement_type: terms.agreement_type,
        terms_version: terms.version,
        terms_source_markdown: terms.body_markdown,
        terms_snapshot_markdown: terms.body_markdown,
        created_by_user_id: invitedByUserId,
      };
      const { error: revisionError } = await ctx.supabase
        .from('platform_invitation_revisions')
        .insert(revisionRow);
      if (revisionError) {
        throw revisionError;
      }

      const attemptRow = {
        id: variant.attemptId,
        invitation_id: variant.id,
        stripe_checkout_session_id: variant.sessionId,
        stripe_payment_intent_id: variant.paymentIntentId,
        payment_route: 'ach',
        phase: variant.phase,
        hosted_verification_url: variant.hostedVerificationUrl ?? null,
        failure_summary: variant.failureSummary ?? null,
        last_reconciled_at: new Date().toISOString(),
      };
      const { error: attemptError } = await ctx.supabase
        .from('platform_invite_checkout_attempts')
        .insert(attemptRow);
      if (attemptError) {
        if (/does not exist|schema cache/i.test(attemptError.message)) {
          ctx.log(
            'platform_invite_checkout_attempts missing; skipped recovery attempt rows (apply migration first)',
          );
          continue;
        }
        throw attemptError;
      }

      const { error: linkError } = await ctx.supabase
        .from('platform_invitations')
        .update({ current_checkout_attempt_id: variant.attemptId })
        .eq('id', variant.id);
      if (linkError) throw linkError;
    }

    printPreviewLinks();
  },
};
