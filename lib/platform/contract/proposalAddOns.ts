export type ProposalAddOnId = 'website_traffic_sourcing' | 'reply_handling';

export interface ProposalAddOnDefinition {
  id: ProposalAddOnId;
  label: string;
  description: string;
}

export const PROPOSAL_ADD_ONS: Record<ProposalAddOnId, ProposalAddOnDefinition> = {
  website_traffic_sourcing: {
    id: 'website_traffic_sourcing',
    label: 'Website traffic sourcing',
    description:
      'We identify your website visitors, use the resulting contacts in our campaigns, and pass the data on to you.',
  },
  reply_handling: {
    id: 'reply_handling',
    label: 'Reply handling',
    description:
      'We handle the replies for you, you only take action when we think you should step in.',
  },
};

export function getSelectedProposalAddOns(input: {
  website_traffic_sourcing_enabled?: boolean;
  reply_handling_enabled?: boolean;
}): ProposalAddOnDefinition[] {
  return [
    input.website_traffic_sourcing_enabled ? PROPOSAL_ADD_ONS.website_traffic_sourcing : null,
    input.reply_handling_enabled ? PROPOSAL_ADD_ONS.reply_handling : null,
  ].filter((addOn): addOn is ProposalAddOnDefinition => Boolean(addOn));
}
