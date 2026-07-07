import {
  CAMPAIGN_FLOW_EXAMPLE_CATEGORIZER,
  CAMPAIGN_FLOW_EXAMPLE_DATASENDER,
  CAMPAIGN_FLOW_EXAMPLE_LINEAR,
} from './examples.js';
import type { CampaignFlowData } from './types';

export type FlowTemplate = {
  id: string;
  name: string;
  description: string;
  flow: CampaignFlowData;
};

export const FLOW_TEMPLATES: FlowTemplate[] = [
  {
    id: 'linear-email-wait-email',
    name: 'Linear email sequence',
    description: 'Lead source → intro email → wait → follow-up email.',
    flow: CAMPAIGN_FLOW_EXAMPLE_LINEAR,
  },
  {
    id: 'categorizer-branches',
    name: 'Categorizer branches',
    description: 'Email → categorizer with interested / not-interested branches.',
    flow: CAMPAIGN_FLOW_EXAMPLE_CATEGORIZER,
  },
  {
    id: 'datasender-webhook',
    name: 'Data sender webhook',
    description: 'Lead source → data sender webhook step.',
    flow: CAMPAIGN_FLOW_EXAMPLE_DATASENDER,
  },
];

export function getFlowTemplate(id: string): FlowTemplate | undefined {
  return FLOW_TEMPLATES.find((template) => template.id === id);
}
