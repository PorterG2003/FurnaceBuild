/**
 * Mutable state shared across campaign-smoke modules in one process run.
 */
export const campaignSmokeStore = {
  accountId: '',
  ownerUserId: '',
  campaignId: '',
  bucketId: '',
  mailboxIds: [] as string[],
  emailNodeDbId: '',
  leadIds: [] as string[],
  enrollmentIds: [] as string[],
};

export function resetCampaignSmokeStore() {
  campaignSmokeStore.accountId = '';
  campaignSmokeStore.ownerUserId = '';
  campaignSmokeStore.campaignId = '';
  campaignSmokeStore.bucketId = '';
  campaignSmokeStore.mailboxIds = [];
  campaignSmokeStore.emailNodeDbId = '';
  campaignSmokeStore.leadIds = [];
  campaignSmokeStore.enrollmentIds = [];
}
