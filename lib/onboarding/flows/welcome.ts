import { createElement } from 'react';
import { TARGETS, type OnboardingFlowDef } from '../types';
import { WelcomeHero } from '@/components/onboarding/art/WelcomeHero';

export const welcomeFlow: OnboardingFlowDef = {
  id: 'welcome',
  version: 7,
  autoStart: true,
  reshowOnVersionBump: true,
  steps: [
    {
      kind: 'announcement',
      render: () => createElement(WelcomeHero),
    },
    {
      kind: 'spotlight',
      targetId: TARGETS.navCampaigns,
      title: 'Campaigns',
      body: {
        default: 'Build and manage your outbound sequences here.',
        dfy: 'Furnace builds and runs your campaigns — track status and results here.',
      },
      placement: 'right',
      advance: 'manual',
    },
    {
      kind: 'spotlight',
      targetId: TARGETS.navMetrics,
      title: 'Metrics',
      body: {
        default: 'Sends, replies, and positive rates for every campaign, account-wide.',
        dfy: 'Your results dashboard — reply and positive rates, always current.',
      },
      placement: 'right',
      advance: 'manual',
    },
    {
      kind: 'spotlight',
      targetId: TARGETS.navInbox,
      title: 'Master Inbox',
      body: {
        default: 'Every reply to your campaigns lands here.',
        dfy: 'Replies from Furnace campaigns land here — this is where you respond.',
      },
      placement: 'right',
      advance: 'manual',
    },
    {
      kind: 'spotlight',
      targetId: TARGETS.navLeads,
      title: 'Leads',
      body: {
        default: 'All prospect data for your workspace — browse, import, export, and filter down to just about any list you need.',
        dfy: 'All lead data Furnace works with lives here. Filter and search controls can pull just about any list you need.',
      },
      placement: 'right',
      advance: 'manual',
    },
    {
      kind: 'spotlight',
      targetId: TARGETS.navSenders,
      title: 'Senders',
      body: {
        default: 'The mailboxes your campaigns send from.',
        dfy: 'Furnace manages these mailboxes for you — warmup, rotation, and deliverability included.',
      },
      placement: 'right',
      advance: 'manual',
    },
    {
      kind: 'spotlight',
      targetId: TARGETS.navSettings,
      route: '/account',
      title: 'Settings',
      body: {
        default: 'Profile, notifications, team, and integrations. Next: a quick pass through your account setup.',
        dfy: 'Profile and notification preferences live here. Next: make sure alerts are set.',
      },
      placement: 'right',
      advance: 'manual',
    },
  ],
};
