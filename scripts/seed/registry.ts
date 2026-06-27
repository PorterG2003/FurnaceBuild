import type { SeedModule } from './types';
import { minimalModule } from './scenarios/minimal';
import { campaignSmokeEnvModule } from './scenarios/campaign-smoke/env';
import { campaignSmokeCampaignModule } from './scenarios/campaign-smoke/campaign';
import { campaignSmokeMailboxesModule } from './scenarios/campaign-smoke/mailboxes';
import { campaignSmokeWaitNodesModule } from './scenarios/campaign-smoke/waitNodes';
import { campaignSmokeLeadsModule } from './scenarios/campaign-smoke/leads';
import { campaignSmokeIntervalModule } from './scenarios/campaign-smoke/interval';
import { campaignSmokeBatchAssignModule } from './scenarios/campaign-smoke/batchAssign';
import {
  oooInboxEnvModule,
  oooInboxBaseGraphModule,
  oooInboxThreadsModule,
  oooInboxMessagesModule,
  oooInboxOooStatesModule,
} from './scenarios/ooo-mixed-inbox/index';
import {
  categorizerFlowEnvModule,
  categorizerFlowBaseGraphModule,
  categorizerFlowRepliesModule,
} from './scenarios/categorizer-flow/index';
import {
  smartHandlingFlowEnvModule,
  smartHandlingFlowBaseGraphModule,
  smartHandlingFlowThreadsModule,
  smartHandlingFlowLiveRepliesModule,
} from './scenarios/smart-handling-flow/index';
import { devDefaultScenarioModule } from './scenarios/dev-default';
import { demoHubScenarioModule } from './scenarios/demo-hub';
import { platformInvitePreviewSeedModule } from './scenarios/platform-invite-preview';
import { campaignHtmlDemoSeedModule } from './scenarios/campaign-html-demo';
import { bucketInsightsSmokeModule } from './scenarios/bucket-insights-smoke';

export const allModules: Record<string, SeedModule> = {
  minimal: minimalModule,
  campaignSmoke_env: campaignSmokeEnvModule,
  campaignSmoke_campaign: campaignSmokeCampaignModule,
  campaignSmoke_mailboxes: campaignSmokeMailboxesModule,
  campaignSmoke_waitNodes: campaignSmokeWaitNodesModule,
  campaignSmoke_leadsEnrollments: campaignSmokeLeadsModule,
  campaignSmoke_interval: campaignSmokeIntervalModule,
  campaignSmoke_batchAssign: campaignSmokeBatchAssignModule,
  oooInbox_env: oooInboxEnvModule,
  oooInbox_baseGraph: oooInboxBaseGraphModule,
  oooInbox_threads: oooInboxThreadsModule,
  oooInbox_messages: oooInboxMessagesModule,
  oooInbox_oooStates: oooInboxOooStatesModule,
  categorizerFlow_env: categorizerFlowEnvModule,
  categorizerFlow_baseGraph: categorizerFlowBaseGraphModule,
  categorizerFlow_replies: categorizerFlowRepliesModule,
  smartHandlingFlow_env: smartHandlingFlowEnvModule,
  smartHandlingFlow_baseGraph: smartHandlingFlowBaseGraphModule,
  smartHandlingFlow_threads: smartHandlingFlowThreadsModule,
  smartHandlingFlow_liveReplies: smartHandlingFlowLiveRepliesModule,
  devDefault_seed: devDefaultScenarioModule,
  demoHub_seed: demoHubScenarioModule,
  platformInvitePreview_seed: platformInvitePreviewSeedModule,
  campaignHtmlDemo_seed: campaignHtmlDemoSeedModule,
  bucketInsightsSmoke_seed: bucketInsightsSmokeModule,
};

/**
 * Scenario id → entry module ids (dependencies are pulled in automatically).
 * campaign-smoke: single leaf pulls the full chain ending in batch_assign_jobs_to_interval.
 */
export const scenarioModuleIds: Record<string, string[]> = {
  minimal: ['minimal'],
  'dev-default': ['devDefault_seed'],
  'demo-hub': ['demoHub_seed'],
  'campaign-smoke': ['campaignSmoke_batchAssign'],
  'campaign-html-demo': ['campaignHtmlDemo_seed'],
  'ooo-mixed-inbox': ['oooInbox_oooStates'],
  'categorizer-flow': ['categorizerFlow_replies'],
  'smart-handling-flow': ['smartHandlingFlow_liveReplies'],
  'platform-invite-preview': ['platformInvitePreview_seed'],
  'bucket-insights-smoke': ['bucketInsightsSmoke_seed'],
};

function collectModuleIdsWithDeps(seedIds: string[]): Set<string> {
  const collected = new Set<string>();

  function collect(id: string) {
    if (collected.has(id)) return;
    const mod = allModules[id];
    if (!mod) {
      throw new Error(`Unknown module "${id}"`);
    }
    for (const d of mod.deps ?? []) {
      collect(d);
    }
    collected.add(id);
  }

  for (const id of seedIds) {
    collect(id);
  }
  return collected;
}

/** Topological order: dependencies before dependents. */
function topologicalSort(modules: SeedModule[]): SeedModule[] {
  const ids = new Set(modules.map((m) => m.id));
  const byId = new Map(modules.map((m) => [m.id, m] as const));
  const done = new Set<string>();
  const out: SeedModule[] = [];
  const visiting = new Set<string>();

  function visit(id: string) {
    if (done.has(id)) return;
    if (visiting.has(id)) {
      throw new Error(`Circular dependency involving module "${id}"`);
    }
    const m = byId.get(id);
    if (!m) {
      throw new Error(`Internal error: missing module "${id}"`);
    }
    visiting.add(id);
    for (const d of m.deps ?? []) {
      if (!ids.has(d)) {
        throw new Error(`Module "${id}" depends on "${d}" which is not in the scenario closure`);
      }
      visit(d);
    }
    visiting.delete(id);
    done.add(id);
    out.push(m);
  }

  for (const m of modules) {
    visit(m.id);
  }
  return out;
}

export function getScenarioModuleOrder(scenarioId: string): SeedModule[] {
  const seedIds = scenarioModuleIds[scenarioId];
  if (!seedIds?.length) {
    const known = Object.keys(scenarioModuleIds).join(', ');
    throw new Error(`Unknown scenario "${scenarioId}". Known: ${known}`);
  }
  const idSet = collectModuleIdsWithDeps(seedIds);
  const modules = [...idSet].map((id) => allModules[id]!);
  return topologicalSort(modules);
}
