import { createElement, lazy } from 'react';
import { TARGETS, type FlowId, type OnboardingFlow } from './types';

/**
 * Flow registry. Flows are authored here as short, declarative objects.
 * Demo/illustration components are lazy-imported so they never weigh down the
 * main bundle (the AnnouncementModal wraps `render()` output in Suspense).
 */

const ScaffoldDemoAnimation = lazy(
  () => import('@/components/onboarding/demo/ScaffoldDemoAnimation'),
);

/**
 * scaffold-demo — exercises every capability of the system:
 * an announcement with an animated demo, a passive spotlight, an
 * onTargetPress spotlight, and a cross-route spotlight. Replace/remove this
 * once the first real flow lands.
 */
const scaffoldDemo: OnboardingFlow = {
  id: 'scaffold-demo',
  version: 1,
  autoStart: true,
  steps: [
    {
      kind: 'announcement',
      title: 'Welcome to Furnace',
      description: 'A quick tour of where things live. You can skip anytime.',
      maxWidth: '5xl',
      render: () => createElement(ScaffoldDemoAnimation),
    },
    {
      kind: 'spotlight',
      targetId: TARGETS.demoNav,
      title: 'Your navigation',
      body: 'Jump between campaigns, metrics, your inbox, and leads from here.',
      placement: 'right',
      advance: 'manual',
    },
    {
      kind: 'spotlight',
      targetId: TARGETS.demoSettings,
      title: 'Open your settings',
      body: 'Go ahead and click Settings to continue.',
      placement: 'right',
      advance: 'onTargetPress',
    },
    {
      kind: 'spotlight',
      targetId: TARGETS.demoAccount,
      route: '/account',
      title: 'Manage your workspace',
      body: 'This is where you manage your account and workspace settings.',
      placement: 'bottom',
      advance: 'manual',
    },
  ],
};

export const FLOWS: Record<FlowId, OnboardingFlow> = {
  'scaffold-demo': scaffoldDemo,
};

export function getFlow(id: FlowId): OnboardingFlow {
  return FLOWS[id];
}

export const ALL_FLOWS: OnboardingFlow[] = Object.values(FLOWS);
