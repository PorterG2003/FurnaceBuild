import type { OnboardingFlow, OnboardingStep } from './types';

/**
 * Pure step engine for onboarding flows. No React, no DOM, no router — all
 * side effects (navigation, measurement, persistence) live in the provider.
 * This keeps the advance logic trivially unit-testable.
 */

export type EngineStatus = 'idle' | 'active';

export type FlowOutcome = 'completed' | 'dismissed' | 'aborted';

export interface EndedFlow {
  flow: OnboardingFlow;
  stepIndex: number;
  outcome: FlowOutcome;
}

export interface EngineState {
  flow: OnboardingFlow | null;
  stepIndex: number;
  status: EngineStatus;
  /** Transient metadata for persistence; cleared via CLEAR_ENDED after the provider handles it. */
  ended: EndedFlow | null;
}

export type EngineAction =
  | { type: 'START'; flow: OnboardingFlow }
  | { type: 'NEXT' }
  | { type: 'BACK' }
  | { type: 'TARGET_PRESS' }
  | { type: 'REQUIREMENT_MET' }
  | { type: 'SKIP_STEP' }
  | { type: 'DISMISS' }
  | { type: 'ABORT' }
  | { type: 'FINISH' }
  | { type: 'CLEAR_ENDED' };

export const INITIAL_STATE: EngineState = {
  flow: null,
  stepIndex: 0,
  status: 'idle',
  ended: null,
};

export function getCurrentStep(state: EngineState): OnboardingStep | null {
  if (!state.flow || state.status !== 'active') return null;
  return state.flow.steps[state.stepIndex] ?? null;
}

export interface Progress {
  index: number;
  total: number;
}

export function getProgress(state: EngineState): Progress | null {
  if (!state.flow || state.status !== 'active') return null;
  return { index: state.stepIndex, total: state.flow.steps.length };
}

function endFlow(state: EngineState, outcome: FlowOutcome): EngineState {
  if (!state.flow || state.status !== 'active') return state;
  return {
    flow: null,
    stepIndex: 0,
    status: 'idle',
    ended: { flow: state.flow, stepIndex: state.stepIndex, outcome },
  };
}

function advance(state: EngineState): EngineState {
  if (!state.flow) return state;
  const next = state.stepIndex + 1;
  if (next >= state.flow.steps.length) {
    return endFlow(state, 'completed');
  }
  return { ...state, stepIndex: next };
}

export function reduce(state: EngineState, action: EngineAction): EngineState {
  switch (action.type) {
    case 'START': {
      if (action.flow.steps.length === 0) {
        return {
          flow: null,
          stepIndex: 0,
          status: 'idle',
          ended: { flow: action.flow, stepIndex: 0, outcome: 'completed' },
        };
      }
      return { flow: action.flow, stepIndex: 0, status: 'active', ended: null };
    }
    case 'NEXT':
    case 'SKIP_STEP': {
      if (state.status !== 'active') return state;
      return advance(state);
    }
    case 'TARGET_PRESS': {
      if (state.status !== 'active') return state;
      const step = getCurrentStep(state);
      if (step && step.kind === 'spotlight' && step.advance === 'onTargetPress') {
        return advance(state);
      }
      return state;
    }
    case 'REQUIREMENT_MET': {
      if (state.status !== 'active') return state;
      const step = getCurrentStep(state);
      if (step && step.kind === 'spotlight' && step.advance === 'onRequirementMet') {
        return advance(state);
      }
      return state;
    }
    case 'BACK': {
      if (state.status !== 'active') return state;
      return { ...state, stepIndex: Math.max(0, state.stepIndex - 1) };
    }
    case 'DISMISS': {
      return endFlow(state, 'dismissed');
    }
    case 'ABORT': {
      // Ended because a step's target never appeared. Distinct from a user
      // dismissal so the provider can persist it as its own status.
      return endFlow(state, 'aborted');
    }
    case 'FINISH': {
      return endFlow(state, 'completed');
    }
    case 'CLEAR_ENDED': {
      if (!state.ended) return state;
      return { ...state, ended: null };
    }
    default: {
      // Exhaustiveness guard.
      const _never: never = action;
      return _never ?? state;
    }
  }
}
