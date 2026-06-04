import { buildAdminInvitePreviewUrl } from '@/lib/platform/invite/preview';
import {
  getProposalPlanPreset,
  type ProposalPlanTier,
} from '@/lib/platform/contract/proposalPlans';
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
  description: 'Create deterministic platform invite preview variants',
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
    };
    if (ctx.dryRun) {
      ctx.log(
        `scenario=${ctx.scenarioId} module=platformInvitePreview_seed [dry-run] — would seed ${previewVariants.length} preview invitations`,
      );
      printPreviewLinks();
      return;
    }

    const invitedByUserId = await getSeedAdminUserId(ctx);
    const terms = await getSeedTerms(ctx);
    const emails = previewVariants.map((variant) => variant.email.toLowerCase());
    const ids = previewVariants.map((variant) => variant.id);

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

    printPreviewLinks();
  },
};
