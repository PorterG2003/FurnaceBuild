import React from 'react';
import { View } from 'react-native';
import { ProposalAddOnCard } from '@/components/platform-invite/ProposalAddOnCard';
import { ProposalPlanCard } from '@/components/platform-invite/ProposalPlanCard';
import { getSelectedProposalAddOns } from '@/lib/platform-invite/proposalAddOns';
import { getProposalPlanPreset, PROPOSAL_CONSULTING_TIME } from '@/lib/platform-invite/proposalPlans';
import { normalizeProposalSnapshot } from './shared';

function formatWholeNumber(value: number) {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
  }).format(value);
}

export function PlatformProposalPreview({
  proposalSnapshot,
  footer,
}: {
  proposalSnapshot: unknown;
  footer?: React.ReactNode;
}) {
  const proposal = normalizeProposalSnapshot(proposalSnapshot);
  const planPreset = getProposalPlanPreset(proposal.plan_tier);
  const selectedAddOns = getSelectedProposalAddOns(proposal);
  const primaryMetric = planPreset.metrics[0] ?? null;
  const standbyMetric = planPreset.metrics[1] ?? null;
  const shouldInlineStandby =
    !!standbyMetric &&
    /standby|backup/i.test(`${standbyMetric.label} ${standbyMetric.value}`);
  const secondaryMetrics = planPreset.metrics.slice(shouldInlineStandby ? 2 : 1);
  const volumeMetric =
    secondaryMetrics.find((item) => /volume|email|month/i.test(item.label)) ??
    secondaryMetrics[secondaryMetrics.length - 1] ??
    null;
  const hasManagedServiceNumbers =
    proposal.managed_inbox_count != null || proposal.managed_outreach_volume != null;
  const topRowMetrics = hasManagedServiceNumbers
    ? [
        proposal.managed_inbox_count != null
          ? {
              key: `sending-inbox-count-${proposal.managed_inbox_count}`,
              title: 'Sending inbox count',
              value: `${formatWholeNumber(proposal.managed_inbox_count)} inboxes`,
            }
          : null,
        proposal.managed_outreach_volume != null
          ? {
              key: `outreach-volume-${proposal.managed_outreach_volume}`,
              title: 'Outreach volume',
              value: `${formatWholeNumber(proposal.managed_outreach_volume)} emails / month`,
            }
          : null,
      ].filter((item): item is NonNullable<typeof item> => Boolean(item))
    : [
        primaryMetric
          ? {
              key: `${primaryMetric.label}-${primaryMetric.value}`,
              title: primaryMetric.label,
              value: primaryMetric.value,
              subtitle: shouldInlineStandby
                ? `Includes ${standbyMetric?.value} for standby backup.`
                : undefined,
            }
          : null,
        volumeMetric
          ? {
              key: `${volumeMetric.label}-${volumeMetric.value}`,
              title: volumeMetric.label,
              value: volumeMetric.value,
            }
          : null,
      ].filter((item): item is NonNullable<typeof item> => Boolean(item));
  const leadSourcingMetric = {
    key: `lead-sourcing-${planPreset.leadSourcing.value}`,
    title: planPreset.leadSourcing.label,
    value: planPreset.leadSourcing.value,
    subtitle: planPreset.leadSourcing.subtitle ?? '',
  };
  const consultingTimeMetric = {
    key: 'strategy-development-time-unlimited',
    title: PROPOSAL_CONSULTING_TIME.label,
    value: PROPOSAL_CONSULTING_TIME.value,
    subtitle: PROPOSAL_CONSULTING_TIME.subtitle ?? '',
  };

  return (
    <View className="gap-4">
      <ProposalPlanCard
        tier={proposal.plan_tier}
        metrics={topRowMetrics}
        leadSourcing={leadSourcingMetric}
        consultingTime={consultingTimeMetric}
      />

      {selectedAddOns.map((addOn) => (
        <ProposalAddOnCard key={addOn.id} addOn={addOn} />
      ))}

      {footer ?? null}
    </View>
  );
}
