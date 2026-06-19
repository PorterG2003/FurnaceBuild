import type { EmailMessage } from '@/lib/supabase/types';
import type { SmartHandlingMetadata } from './smartHandling';
import type { ThreadActionId } from './threadActionDefinitions';
import { getThreadActionDefinition } from './threadActionDefinitions';
import { computeOooQuickResumeAtIso } from './outOfOfficeSchedule';

export interface ThreadActionEffectsContext {
  threadId: string;
  accountId: string | null;
  metadata: SmartHandlingMetadata | null;
  prospectEmails: string[];
  latestReceivedInbound: EmailMessage | null;
  setCategory: (category: string | null) => Promise<void>;
  markOoo: (params: { resumeAt: string; returnDateYmd?: string | null }) => Promise<void>;
  blockSender: () => Promise<void>;
  openComposer: (message: EmailMessage, suggestedReplyHtml?: string) => void;
}

export function resolveOooResumeAt(
  actionId: ThreadActionId,
  metadata: SmartHandlingMetadata | null,
): { resumeAt: string; returnDateYmd: string | null } | null {
  const effects = getThreadActionDefinition(actionId).effects;
  if (!effects?.oooResume) {
    return null;
  }

  const returnDateYmd = effects.oooResume === 'dated' ? metadata?.return_date ?? null : null;
  const resumeAt = computeOooQuickResumeAtIso({
    preset: effects.oooResume,
    returnDateYmd,
  });

  if (!resumeAt) {
    return null;
  }

  return { resumeAt, returnDateYmd };
}

export async function applyImmediateEffects(
  actionId: ThreadActionId,
  ctx: ThreadActionEffectsContext,
): Promise<void> {
  const effects = getThreadActionDefinition(actionId).effects;
  if (!effects) return;

  if (effects.setCategory) {
    await ctx.setCategory(effects.setCategory);
  }

  if (effects.oooResume) {
    const schedule = resolveOooResumeAt(actionId, ctx.metadata);
    if (!schedule) {
      throw new Error('Could not compute OOO resume time.');
    }
    await ctx.markOoo({
      resumeAt: schedule.resumeAt,
      returnDateYmd: schedule.returnDateYmd,
    });
  }

  if (effects.blockSender && ctx.accountId) {
    await ctx.blockSender();
  }

  if (effects.openComposer && ctx.latestReceivedInbound) {
    ctx.openComposer(ctx.latestReceivedInbound);
  }
}
