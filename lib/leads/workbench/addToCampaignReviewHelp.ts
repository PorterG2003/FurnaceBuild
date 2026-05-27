/** Tooltip copy for the Add to campaign review step. */
export const ADD_TO_CAMPAIGN_REVIEW_HELP = {
  peopleInScope:
    'Unique people included in your selection. Each person is one global contact record, even if they appear in multiple campaigns.',
  alreadyInCampaign:
    'People who already have a lead row in the target campaign. Furnace updates their fields and re-enrolls them instead of creating duplicates.',
  membershipsInScope:
    'Total campaign lead rows for these people across every campaign. One person can have several memberships if they were added to multiple campaigns.',
  nativeMemberships:
    'Memberships in Furnace-native campaigns (built and run in Furnace). This add action targets a native campaign.',
  smartleadMemberships:
    'Memberships in Smartlead-imported campaigns. Adding people to a native campaign does not remove or change Smartlead memberships.',
  peopleWithReplies:
    'People with at least one received reply on any membership in scope. They may already be in active conversations elsewhere.',
  companyConflicts:
    'People whose memberships use more than one company name. Review before adding if you rely on company for personalization or routing.',
} as const;
