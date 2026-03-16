import type { CampaignMigrationResult, SmartleadCampaign } from '@/lib/smartlead/migration';

export type CampaignRow = {
  campaign: SmartleadCampaign;
  depth: number;
};

export type WizardStep = 0 | 1 | 2 | 3;

export type ReviewTabKey = 'summary' | 'leads' | 'conversations' | 'activity';

export type MigrationResultState = {
  succeeded: string[];
  failed: { name: string; error: string }[];
  statsImported?: boolean;
  totalLeadsImported?: number;
  campaignResults?: CampaignMigrationResult[];
};

export type ReviewCampaignOption = {
  id: string;
  campaignRowId: string;
  name: string;
  leadsImported: number;
  conversationsImported: number;
  totalsStatsImported: boolean;
  dayByDayStatsImported: boolean;
  conversationZeroReason: string | null;
};
