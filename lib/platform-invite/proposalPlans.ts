export type ProposalPlanTier = 'bronze' | 'silver' | 'gold';

export interface ProposalPlanMetric {
  value: string;
  label: string;
}

export interface ProposalPlanCardStyle {
  titleColor: string;
  metricAccentColor: string;
  borderColor: string;
  backgroundColor: string;
  glowColor?: string;
  isFeatured?: boolean;
}

export interface ProposalPlanLeadSourcing {
  label: string;
  value: string;
  subtitle?: string;
}

export interface ProposalPlanConsultingTime {
  label: string;
  value: string;
  subtitle?: string;
}

export const PROPOSAL_CONSULTING_TIME: ProposalPlanConsultingTime = {
  label: '1:1 Strategy Development Time',
  value: 'Unlimited',
};

export interface ProposalPlanPreset {
  tier: ProposalPlanTier;
  label: string;
  proposalTitle: string;
  paymentDefaultCents: number;
  metrics: ProposalPlanMetric[];
  leadSourcing: ProposalPlanLeadSourcing;
}

export const PROPOSAL_PLAN_PRESETS: Record<ProposalPlanTier, ProposalPlanPreset> = {
  bronze: {
    tier: 'bronze',
    label: 'Bronze Plan',
    proposalTitle: 'Furnace Bronze Plan',
    paymentDefaultCents: 100_000,
    metrics: [
      { value: '20 inboxes', label: 'Sending capacity' },
      { value: '10 inboxes', label: 'Standby backup' },
      { value: '8,400 emails / month', label: 'Estimated sending volume' },
    ],
    leadSourcing: {
      label: 'Lead sourcing',
      value: 'Bring Your Own Leads',
    },
  },
  silver: {
    tier: 'silver',
    label: 'Silver Plan',
    proposalTitle: 'Furnace Silver Plan',
    paymentDefaultCents: 200_000,
    metrics: [
      { value: '40 inboxes', label: 'Sending capacity' },
      { value: '20 inboxes', label: 'Standby backup' },
      { value: '16,800 emails / month', label: 'Estimated sending volume' },
    ],
    leadSourcing: {
      label: 'Lead sourcing',
      value: 'Sourced',
      subtitle: 'Source and basic enrichment included',
    },
  },
  gold: {
    tier: 'gold',
    label: 'Gold Plan',
    proposalTitle: 'Furnace Gold Plan',
    paymentDefaultCents: 400_000,
    metrics: [
      { value: '40+ inboxes', label: 'Sending capacity' },
      { value: '20+ inboxes', label: 'Standby backup' },
      { value: '16,800+ emails / month', label: 'Estimated sending volume' },
    ],
    leadSourcing: {
      label: 'Lead sourcing',
      value: 'Deep',
      subtitle: 'Deep enrichment included',
    },
  },
};

export const PROPOSAL_PLAN_CARD_STYLES: Record<ProposalPlanTier, ProposalPlanCardStyle> = {
  bronze: {
    titleColor: '#E07A52',
    metricAccentColor: '#E07A52',
    borderColor: 'rgba(224, 122, 82, 0.45)',
    backgroundColor: '#1A1A1A',
  },
  silver: {
    titleColor: '#FFFFFF',
    metricAccentColor: '#C4CBD4',
    borderColor: 'rgba(255, 255, 255, 0.35)',
    backgroundColor: '#1A1A1A',
    glowColor: 'rgba(196, 203, 212, 0.24)',
    isFeatured: true,
  },
  gold: {
    titleColor: '#EAB308',
    metricAccentColor: '#D4B84A',
    borderColor: 'rgba(234, 179, 8, 0.45)',
    backgroundColor: '#1A1A1A',
  },
};

export const PROPOSAL_PLAN_TIER_OPTIONS = (
  Object.keys(PROPOSAL_PLAN_PRESETS) as ProposalPlanTier[]
).map((tier) => ({
  id: tier,
  label: PROPOSAL_PLAN_PRESETS[tier].label,
}));

export function isProposalPlanTier(value: unknown): value is ProposalPlanTier {
  return value === 'bronze' || value === 'silver' || value === 'gold';
}

export function getProposalPlanPreset(tier: ProposalPlanTier): ProposalPlanPreset {
  return PROPOSAL_PLAN_PRESETS[tier];
}

export function getProposalPlanCardStyle(tier: ProposalPlanTier): ProposalPlanCardStyle {
  return PROPOSAL_PLAN_CARD_STYLES[tier];
}

export function inferProposalPlanTier(monthlyRetainerCents?: number | null): ProposalPlanTier {
  if (typeof monthlyRetainerCents !== 'number' || !Number.isFinite(monthlyRetainerCents)) {
    return 'silver';
  }
  if (monthlyRetainerCents <= 100_000) return 'bronze';
  if (monthlyRetainerCents <= 200_000) return 'silver';
  return 'gold';
}
