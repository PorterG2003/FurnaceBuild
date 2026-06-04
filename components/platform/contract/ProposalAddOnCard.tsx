import React from 'react';
import { Text, View } from 'react-native';
import { getProposalPlanCardStyle } from '@/lib/platform/contract/proposalPlans';
import type { ProposalAddOnDefinition } from '@/lib/platform/contract/proposalAddOns';

export function ProposalAddOnCard({ addOn }: { addOn: ProposalAddOnDefinition }) {
  const style = getProposalPlanCardStyle('silver');

  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: style.borderColor,
        borderRadius: 16,
        backgroundColor: style.backgroundColor,
        paddingHorizontal: 28,
        paddingVertical: 24,
      }}
    >
        <Text
          selectable={false}
          className="font-instrument-semibold text-white"
          style={{ fontSize: 22, marginBottom: 8 }}
        >
          {addOn.label}
        </Text>
        <Text selectable={false} className="text-gray-300 font-instrument text-sm leading-relaxed">
          {addOn.description}
        </Text>
    </View>
  );
}
