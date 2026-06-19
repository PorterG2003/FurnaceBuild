import { closeConversation, updateThreadCategory } from '@/lib/supabase/services';
import type { ThreadActionId, ThreadActionSource } from './threadActionDefinitions';
import { resolveFinalizeSteps } from './threadActionDefinitions';

export interface FinalizeThreadActionOnServerParams {
  threadId: string;
  actionId: ThreadActionId;
  source: ThreadActionSource;
  phase?: 'immediate' | 'complete';
}

export async function finalizeThreadActionOnServer(
  params: FinalizeThreadActionOnServerParams,
): Promise<ReturnType<typeof resolveFinalizeSteps>> {
  const steps = resolveFinalizeSteps(params.actionId, params.source, params.phase ?? 'immediate');

  if (steps.setCategoryOnComplete) {
    await updateThreadCategory(params.threadId, steps.setCategoryOnComplete);
  }

  if (steps.closeConversation) {
    await closeConversation(params.threadId, 'system');
  }

  return steps;
}
