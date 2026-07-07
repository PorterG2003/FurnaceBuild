import { buildChangelogMarkdown } from './changelog.js';
import { buildBuildingCampaignsMarkdown } from './buildingCampaigns.js';
import {
  buildWebhookEventGroupMarkdown,
  buildWebhooksOverviewMarkdown,
  WEBHOOK_GUIDE_GROUP_PATH_SEGMENTS,
} from './webhooks.js';
import { WEBHOOK_EVENT_GROUPS } from '../webhooks/eventGroups.js';

const DOC_ONLY_PREFIX = '> Documentation only — this path is not callable.\n\n';

const WEBHOOK_GROUP_OPERATION_IDS: Record<string, string> = {
  lead_added_updated: 'getDocumentationWebhooksLeadAddedUpdated',
  lead_removed: 'getDocumentationWebhooksLeadRemoved',
  enrollment_pause_resume: 'getDocumentationWebhooksEnrollmentPauseResume',
  campaign_status: 'getDocumentationWebhooksCampaignStatus',
  email_activity: 'getDocumentationWebhooksEmailActivity',
};

function guideGetOperation(params: {
  tags: string[];
  summary: string;
  operationId: string;
  description: string;
}) {
  return {
    get: {
      operationId: params.operationId,
      tags: params.tags,
      summary: params.summary,
      description: `${DOC_ONLY_PREFIX}${params.description}`,
      security: [],
      responses: {
        200: {
          description: 'Documentation page.',
        },
      },
    },
  };
}

export function buildGuidePaths() {
  const webhookGroupPaths = Object.fromEntries(
    WEBHOOK_EVENT_GROUPS.map((group) => {
      const segment = WEBHOOK_GUIDE_GROUP_PATH_SEGMENTS[group.id];
      const operationId = WEBHOOK_GROUP_OPERATION_IDS[group.id];
      if (!segment || !operationId) {
        throw new Error(`Missing guide path config for webhook group: ${group.id}`);
      }
      return [
        `/documentation/webhooks/${segment}`,
        guideGetOperation({
          tags: ['Webhooks'],
          summary: group.label,
          operationId,
          description: buildWebhookEventGroupMarkdown(group.id),
        }),
      ];
    }),
  );

  return {
    '/documentation/building-campaigns': guideGetOperation({
      tags: ['Building campaigns'],
      summary: 'Building campaigns',
      operationId: 'getDocumentationBuildingCampaigns',
      description: buildBuildingCampaignsMarkdown(),
    }),
    '/documentation/changelog': guideGetOperation({
      tags: ['Changelog'],
      summary: 'Changelog',
      operationId: 'getDocumentationChangelog',
      description: buildChangelogMarkdown(),
    }),
    '/documentation/webhooks': guideGetOperation({
      tags: ['Webhooks'],
      summary: 'Webhook guide',
      operationId: 'getDocumentationWebhooksOverview',
      description: buildWebhooksOverviewMarkdown(),
    }),
    ...webhookGroupPaths,
  };
}
