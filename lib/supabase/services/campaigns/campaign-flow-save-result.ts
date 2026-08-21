import type { Campaign } from '../../types';

export type CampaignFlowSaveResult = {
  campaign: Campaign;
  reactivated_count: number;
};
