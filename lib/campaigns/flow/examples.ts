import type { CampaignFlowData } from './types';

const EXAMPLE_VARIANT_IDS = {
  firstA: '11111111-1111-4111-8111-111111111111',
  firstB: '11111111-1111-4111-8111-111111111112',
  secondA: '22222222-2222-4222-8222-222222222221',
  secondB: '22222222-2222-4222-8222-222222222222',
  replyA: '33333333-3333-4333-8333-333333333333',
  breakupA: '44444444-4444-4444-8444-444444444444',
} as const;

export const CAMPAIGN_FLOW_EXAMPLE_LINEAR: CampaignFlowData = {
  nodes: [
    {
      id: 'leadSource-1',
      type: 'leadSource',
      position: { x: 0, y: 0 },
      data: {
        label: 'Lead Bucket',
        customFieldKeys: ['company'],
        mappedStandardFieldKeys: ['email', 'first_name', 'last_name'],
        isRequired: true,
      },
      deletable: false,
    },
    {
      id: 'email-1',
      type: 'email',
      position: { x: 220, y: 0 },
      data: {
        label: 'Intro Email',
        priority: false,
        variants: [
          {
            id: EXAMPLE_VARIANT_IDS.firstA,
            label: 'A',
            subject: 'Quick question for {{first_name}}',
            template: 'Hi {{first_name}} - reaching out about {{custom.company}}.',
            isActive: true,
            order: 0,
          },
          {
            id: EXAMPLE_VARIANT_IDS.firstB,
            label: 'B',
            subject: 'Following up for {{first_name}}',
            template: 'Hi {{first_name}} - wanted to share a quick idea for {{custom.company}}.',
            isActive: true,
            order: 1,
          },
        ],
      },
    },
    {
      id: 'waitTime-1',
      type: 'waitTime',
      position: { x: 460, y: 0 },
      data: {
        label: 'Wait 1 day',
        duration: '1',
        unit: 'days',
        wait_duration_seconds: 86400,
      },
    },
    {
      id: 'email-2',
      type: 'email',
      position: { x: 700, y: 0 },
      data: {
        label: 'Follow-up',
        priority: false,
        variants: [
          {
            id: EXAMPLE_VARIANT_IDS.secondA,
            label: 'A',
            subject: 'Bumping this for {{first_name}}',
            template: 'Hi {{first_name}} - circling back in case this is relevant for {{custom.company}}.',
            isActive: true,
            order: 0,
          },
          {
            id: EXAMPLE_VARIANT_IDS.secondB,
            label: 'B',
            subject: 'Any thoughts, {{first_name}}?',
            template: 'Hi {{first_name}} - should I close the loop or send more detail?',
            isActive: true,
            order: 1,
          },
        ],
      },
    },
  ],
  edges: [
    { id: 'e1', source: 'leadSource-1', target: 'email-1' },
    { id: 'e2', source: 'email-1', target: 'waitTime-1' },
    { id: 'e3', source: 'waitTime-1', target: 'email-2' },
  ],
};

/** Minimal flow with a dataSender webhook node after the first email. */
export const CAMPAIGN_FLOW_EXAMPLE_DATASENDER: CampaignFlowData = {
  nodes: [
    CAMPAIGN_FLOW_EXAMPLE_LINEAR.nodes[0]!,
    CAMPAIGN_FLOW_EXAMPLE_LINEAR.nodes[1]!,
    {
      id: 'dataSender-1',
      type: 'dataSender',
      position: { x: 460, y: 0 },
      data: {
        label: 'Notify CRM',
        endpoint_url: 'https://hooks.example.com/lead-contacted',
        payload: JSON.stringify(
          {
            email: '{{email}}',
            company: '{{custom.company}}',
            campaign_node: 'email-1',
          },
          null,
          2,
        ),
        on_failure: 'continue',
      },
    },
  ],
  edges: [
    { id: 'e1', source: 'leadSource-1', target: 'email-1' },
    { id: 'e2', source: 'email-1', target: 'dataSender-1' },
  ],
};

export const CAMPAIGN_FLOW_EXAMPLE_CATEGORIZER: CampaignFlowData = {
  nodes: [
    ...CAMPAIGN_FLOW_EXAMPLE_LINEAR.nodes.slice(0, 3),
    {
      id: 'email-2',
      type: 'email',
      position: { x: 700, y: 0 },
      data: {
        label: 'Reply Trigger',
        priority: false,
        variants: [
          {
            id: EXAMPLE_VARIANT_IDS.secondA,
            label: 'A',
            subject: 'Checking back in, {{first_name}}',
            template: 'Hi {{first_name}} - just checking whether this is relevant for {{custom.company}}.',
            isActive: true,
            order: 0,
          },
        ],
      },
    },
    {
      id: 'aiCategorizer-1',
      type: 'aiCategorizer',
      position: { x: 940, y: 0 },
      data: {
        label: 'Categorizer',
        use_ai: true,
      },
    },
    {
      id: 'email-3',
      type: 'email',
      position: { x: 1180, y: -120 },
      data: {
        label: 'Interested Reply',
        priority: true,
        variants: [
          {
            id: EXAMPLE_VARIANT_IDS.replyA,
            label: 'A',
            subject: '',
            template: 'Thanks {{first_name}} - here are the details you asked for.',
            isActive: true,
            order: 0,
          },
        ],
      },
    },
    {
      id: 'email-4',
      type: 'email',
      position: { x: 1180, y: 120 },
      data: {
        label: 'Breakup',
        priority: true,
        variants: [
          {
            id: EXAMPLE_VARIANT_IDS.breakupA,
            label: 'A',
            subject: 'Closing the loop, {{first_name}}',
            template: 'No worries {{first_name}} - I’ll close the loop on my side.',
            isActive: true,
            order: 0,
          },
        ],
      },
    },
  ],
  edges: [
    { id: 'e1', source: 'leadSource-1', target: 'email-1' },
    { id: 'e2', source: 'email-1', target: 'waitTime-1' },
    { id: 'e3', source: 'waitTime-1', target: 'email-2' },
    { id: 'e4', source: 'email-2', target: 'aiCategorizer-1' },
    { id: 'e5', source: 'aiCategorizer-1', sourceHandle: 'interested', target: 'email-3' },
    { id: 'e6', source: 'aiCategorizer-1', sourceHandle: 'not-interested', target: 'email-4' },
  ],
};
