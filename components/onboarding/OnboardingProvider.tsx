import React, {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { View } from 'react-native';
import { usePathname, useRouter, type Href } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import {
  INITIAL_STATE,
  getCurrentStep,
  getProgress,
  reduce,
  type EngineState,
} from '@/lib/onboarding/engine';
import { ALL_FLOWS, getFlow } from '@/lib/onboarding/flows';
import type { FlowId, TargetId } from '@/lib/onboarding/types';
import {
  fetchOnboardingState,
  markFlowComplete,
  markFlowDismissed,
  resetFlowState,
} from '@/lib/supabase/services/onboarding/onboardingState';
import { useReducedMotion } from './useReducedMotion';
import { useBlockingOverlayPresent } from './overlayPresence';
import { OnboardingOverlay } from './OnboardingOverlay';
import {
  OnboardingContext,
  type OnboardingContextValue,
  type TargetRect,
} from './context';

const AUTO_START_DELAY_MS = 900;

interface OnboardingProviderProps {
  /** True only when the main shell is interactive (not booting/blocked). */
  enabled: boolean;
  children: ReactNode;
}

export function OnboardingProvider({ enabled, children }: OnboardingProviderProps) {
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const reducedMotion = useReducedMotion();
  const blockingOverlayPresent = useBlockingOverlayPresent();

  const [state, dispatch] = useReducer(reduce, INITIAL_STATE);
  const stateRef = useRef<EngineState>(state);
  stateRef.current = state;

  const targetsRef = useRef(new Map<TargetId, RefObject<View | null>>());
  const seenRef = useRef<Set<string>>(new Set());
  const autoStartedRef = useRef<Set<string>>(new Set());
  const [stateLoaded, setStateLoaded] = useState(false);

  const emit = useCallback((flowId: string, stepIndex: number, action: string) => {
    if (__DEV__) {
      // No-op analytics seam; replace with real telemetry later.
      console.log('[onboarding]', { flowId, stepIndex, action });
    }
  }, []);

  // Load per-user completion state once.
  useEffect(() => {
    if (!user) {
      seenRef.current = new Set();
      setStateLoaded(false);
      return;
    }
    let cancelled = false;
    void fetchOnboardingState(user.id).then((rows) => {
      if (cancelled) return;
      seenRef.current = new Set(rows.map((r) => r.flow_id));
      setStateLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  // --- Actions -------------------------------------------------------------

  const startFlow = useCallback(
    (id: FlowId) => {
      const flow = getFlow(id);
      if (!flow) return;
      emit(id, 0, 'start');
      dispatch({ type: 'START', flow });
    },
    [emit],
  );

  const next = useCallback(() => {
    const flow = stateRef.current.flow;
    if (flow) emit(flow.id, stateRef.current.stepIndex, 'next');
    dispatch({ type: 'NEXT' });
  }, [emit]);

  const back = useCallback(() => {
    dispatch({ type: 'BACK' });
  }, []);

  const skipStep = useCallback(() => {
    const flow = stateRef.current.flow;
    if (flow) emit(flow.id, stateRef.current.stepIndex, 'skip-step');
    dispatch({ type: 'SKIP_STEP' });
  }, [emit]);

  const dismissFlow = useCallback(() => {
    dispatch({ type: 'DISMISS' });
  }, []);

  const notifyTargetPress = useCallback((id: TargetId) => {
    const step = getCurrentStep(stateRef.current);
    if (step?.kind === 'spotlight' && step.targetId === id) {
      dispatch({ type: 'TARGET_PRESS' });
    }
  }, []);

  const resetFlow = useCallback(
    async (id: FlowId) => {
      seenRef.current.delete(id);
      autoStartedRef.current.delete(id);
      if (user) await resetFlowState(user.id, id);
    },
    [user],
  );

  // --- Target registry -----------------------------------------------------

  const registerTarget = useCallback(
    (id: TargetId, ref: RefObject<View | null>) => {
      targetsRef.current.set(id, ref);
      return () => {
        if (targetsRef.current.get(id) === ref) {
          targetsRef.current.delete(id);
        }
      };
    },
    [],
  );

  const measureTarget = useCallback((id: TargetId): Promise<TargetRect | null> => {
    const ref = targetsRef.current.get(id);
    const node = ref?.current;
    if (!node) return Promise.resolve(null);
    return new Promise((resolve) => {
      try {
        node.measureInWindow((x, y, width, height) => {
          if (width === 0 && height === 0) {
            resolve(null);
          } else {
            resolve({ x, y, width, height });
          }
        });
      } catch {
        resolve(null);
      }
    });
  }, []);

  const getTargetNode = useCallback((id: TargetId): unknown | null => {
    const ref = targetsRef.current.get(id);
    return ref?.current ?? null;
  }, []);

  // --- Persistence + reset on finish/dismiss -------------------------------

  useEffect(() => {
    if (!state.flow) return;
    if (state.status !== 'completed' && state.status !== 'dismissed') return;

    const { id: flowId, version } = state.flow;
    seenRef.current.add(flowId);
    emit(flowId, state.stepIndex, state.status);

    if (user) {
      if (state.status === 'completed') {
        void markFlowComplete(user.id, flowId, version);
      } else {
        void markFlowDismissed(user.id, flowId, version);
      }
    }

    // Return the engine to idle so a future flow can start.
    dispatch({ type: 'RESET' });
  }, [state.status, state.flow, state.stepIndex, user, emit]);

  // --- Cross-route navigation ---------------------------------------------

  useEffect(() => {
    const step = getCurrentStep(state);
    if (!step?.route) return;
    if (pathname === step.route) return;
    router.push(step.route as Href);
  }, [state, pathname, router]);

  // --- Auto-start from DB state -------------------------------------------

  useEffect(() => {
    if (!enabled || !stateLoaded || !user) return;
    if (state.status === 'active') return;
    if (blockingOverlayPresent) return;

    const candidate = ALL_FLOWS.find(
      (f) =>
        f.autoStart &&
        !seenRef.current.has(f.id) &&
        !autoStartedRef.current.has(f.id),
    );
    if (!candidate) return;

    const timer = setTimeout(() => {
      if (stateRef.current.status === 'active') return;
      if (seenRef.current.has(candidate.id)) return;
      autoStartedRef.current.add(candidate.id);
      startFlow(candidate.id);
    }, AUTO_START_DELAY_MS);

    return () => clearTimeout(timer);
  }, [enabled, stateLoaded, user, state.status, blockingOverlayPresent, startFlow]);

  const value = useMemo<OnboardingContextValue>(
    () => ({
      startFlow,
      dismissFlow,
      resetFlow,
      next,
      back,
      notifyTargetPress,
      registerTarget,
      currentStep: getCurrentStep(state),
      progress: getProgress(state),
      reducedMotion,
      blockingOverlayPresent,
      skipStep,
      measureTarget,
      getTargetNode,
    }),
    [
      startFlow,
      dismissFlow,
      resetFlow,
      next,
      back,
      notifyTargetPress,
      registerTarget,
      state,
      reducedMotion,
      blockingOverlayPresent,
      skipStep,
      measureTarget,
      getTargetNode,
    ],
  );

  return (
    <OnboardingContext.Provider value={value}>
      {children}
      <OnboardingOverlay />
    </OnboardingContext.Provider>
  );
}
