/** Tooltip copy for remove membership review steps. */
export const REMOVE_FROM_CAMPAIGN_REVIEW_HELP = {
  peopleInScope:
    'Unique people included in your selection. Remove applies per person in the chosen campaign only.',
  inCampaign:
    'People with an active lead row in the target campaign. These memberships will be removed.',
  notInCampaign: 'Selected people who are not in the target campaign.',
  alreadyRemoved: 'People already removed from the target campaign.',
  smartleadCampaign: 'Smartlead campaigns cannot be modified from Furnace.',
} as const;

export const REMOVE_FROM_ALL_CAMPAIGNS_REVIEW_HELP = {
  peopleInScope: 'Unique people included in your selection.',
  nativeMembershipsToRemove:
    'Total native Furnace campaign memberships that will be removed across all campaigns.',
  smartleadMembershipsSkipped:
    'Smartlead campaign memberships are skipped and cannot be removed from Furnace.',
  peopleWithReplies:
    'People with at least one reply in any campaign. Removal is still allowed but may affect inbox history.',
} as const;
