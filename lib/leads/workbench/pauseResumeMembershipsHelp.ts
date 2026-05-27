/** Tooltip copy for pause/resume membership review steps. */
export const PAUSE_ENROLLMENTS_REVIEW_HELP = {
  peopleInScope:
    'Unique people included in your selection. Pause applies per person in the chosen campaign only.',
  activeInCampaign:
    'People with an active enrollment in the target campaign. These will be paused.',
  alreadyPaused:
    'People already manually paused in this campaign. No change for these rows.',
  notInCampaign: 'Selected people who are not in the target campaign.',
  terminalInCampaign:
    'People whose enrollment is stopped or completed in this campaign. Pause does not apply.',
  smartleadCampaign: 'Smartlead campaigns cannot be paused from Furnace.',
} as const;

export const RESUME_ENROLLMENTS_REVIEW_HELP = {
  peopleInScope:
    'Unique people included in your selection. Resume applies per person in the chosen campaign only.',
  pausedInCampaign:
    'People manually paused in the target campaign. These will be resumed when the campaign is running.',
  alreadyActive:
    'People already active in this campaign. No change for these rows.',
  notInCampaign: 'Selected people who are not in the target campaign.',
  campaignNotRunning:
    'Resume requires the campaign to be running. Pause the campaign first or wait until it is running again.',
  smartleadCampaign: 'Smartlead campaigns cannot be resumed from Furnace.',
} as const;
