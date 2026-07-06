import type { InboxThreadToolbarActionKey } from '@/lib/inbox';
import { TARGETS, type FlowId, type OnboardingFlowDef, type OnboardingStepDef } from '../types';

/**
 * Desktop inbox toolbar tours whose steps depend on the responsive toolbar
 * overflow split. Mobile variants are excluded: their actions always live in a
 * single bottom sheet, so they need no layout-aware resolution.
 */
const INBOX_TOOLBAR_FLOW_IDS: ReadonlySet<FlowId> = new Set<FlowId>([
  'inbox-followup',
]);

export function isInboxToolbarFlowId(id: FlowId): boolean {
  return INBOX_TOOLBAR_FLOW_IDS.has(id);
}

/**
 * Expands an authored desktop inbox toolbar flow into the concrete ordered steps
 * for the current layout, using the toolbar's already-computed overflow split.
 *
 * Authoring model (see `inbox-followup.ts`):
 * - Each real action step is tagged `toolbarActionKey`.
 * - No authored step is merely overflow scaffolding; if the current layout
 *   needs the "More actions" menu, this builder injects one generic opener
 *   ahead of the first overflowed action.
 *
 * Resolution rules:
 * - Actions that are inline for this layout are demonstrated in place.
 * - If any action in the flow is collapsed into the overflow menu, exactly one
 *   synthetic opener step is inserted ahead of the first collapsed action and
 *   the collapsed actions are walked inside the (pinned-open) menu. Their
 *   `targetId` already resolves to the menu item because the toolbar assigns
 *   the same onboarding ref to the overflow menu entry.
 * - When every action is inline, no opener is inserted.
 *
 * The builder preserves the authored lesson order. If some actions are
 * overflowed and others stay inline, the synthetic opener appears immediately
 * before the first authored overflowed action.
 */
export function buildInboxToolbarFlow(
  def: OnboardingFlowDef,
  overflowKeys: readonly InboxThreadToolbarActionKey[] | null,
): OnboardingFlowDef {
  const overflow = new Set<InboxThreadToolbarActionKey>(overflowKeys ?? []);
  const steps: OnboardingStepDef[] = [];
  let openerEmitted = false;

  for (const step of def.steps) {
    if (
      step.kind === 'spotlight' &&
      step.toolbarActionKey != null &&
      overflow.has(step.toolbarActionKey) &&
      !openerEmitted
    ) {
      // Insert one generic "More actions" opener immediately before the first
      // collapsed action so every authored lesson still appears in the flow.
      steps.push(buildOverflowOpenerStep(step.toolbarActionKey));
      openerEmitted = true;
    }
    steps.push(step);
  }

  return { ...def, steps };
}

function buildOverflowOpenerStep(actionKey: InboxThreadToolbarActionKey): OnboardingStepDef {
  return {
    kind: 'spotlight',
    targetId: getOverflowTriggerTargetId(actionKey),
    title: 'More actions live here',
    body: 'When the toolbar is tight, your remaining actions tuck into this menu. Here they are.',
    placement: 'bottom',
    advance: 'manual',
    nextGate: { dwellMs: 2200 },
  };
}

function getOverflowTriggerTargetId(actionKey: InboxThreadToolbarActionKey) {
  switch (actionKey) {
    case 'close':
      return TARGETS.inboxActionCloseOverflowTrigger;
    case 'block':
      return TARGETS.inboxActionBlockOverflowTrigger;
    case 'ooo':
      return TARGETS.inboxActionOutOfOfficeOverflowTrigger;
    case 'replace':
      return TARGETS.inboxActionReplaceOverflowTrigger;
    case 'tags':
      return TARGETS.inboxActionTagsOverflowTrigger;
    case 'open':
      return TARGETS.inboxActionCloseOverflowTrigger;
  }
}
