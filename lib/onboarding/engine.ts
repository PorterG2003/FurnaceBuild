import type { OnboardingFlow, OnboardingStep } from './types';

/**
 * Pure step engine for onboarding flows. No React, no DOM, no router — all
 * side effects (navigation, measurement, persistence) live in the provider.
 * This keeps the advance logic trivially unit-testable.
 */

export type EngineStatus = 'idle' | 'active' | 'completed' | 'dismissed';

export interface EngineState {
  flow: OnboardingFlow | null;
  stepIndex: number;
  status: EngineStatus;
}

export type EngineAction =
  | { type: 'START'; flow: OnboardingFlow }
  | { type: 'NEXT' }
  | { type: 'BACK' }
  | { type: 'TARGET_PRESS' }
  | { type: 'SKIP_STEP' }
  | { type: 'DISMISS' }
  | { type: 'FINISH' }
  | { type: 'RESET' };

export const INITIAL_STATE: EngineState = {
  flow: null,
  stepIndex: 0,
  status: 'idle',
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

function advance(state: EngineState): EngineState {
  if (!state.flow) return state;
  const next = state.stepIndex + 1;
  if (next >= state.flow.steps.length) {
    return { ...state, status: 'completed' };
  }
  return { ...state, stepIndex: next };
}

export function reduce(state: EngineState, action: EngineAction): EngineState {
  switch (action.type) {
    case 'START': {
      if (action.flow.steps.length === 0) {
        return { flow: action.flow, stepIndex: 0, status: 'completed' };
      }
      return { flow: action.flow, stepIndex: 0, status: 'active' };
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
    case 'BACK': {
      if (state.status !== 'active') return state;
      return { ...state, stepIndex: Math.max(0, state.stepIndex - 1) };
    }
    case 'DISMISS': {
      if (state.status !== 'active') return state;
      return { ...state, status: 'dismissed' };
    }
    case 'FINISH': {
      if (state.status !== 'active') return state;
      return { ...state, status: 'completed' };
    }
    case 'RESET': {
      return INITIAL_STATE;
    }
    default: {
      // Exhaustiveness guard.
      const _never: never = action;
      return _never ?? state;
    }
  }
}
