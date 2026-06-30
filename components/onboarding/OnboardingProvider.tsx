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
import { useAccount } from '@/contexts/AccountContext';
import { getAccountMembershipRole } from '@/lib/account/teamManagementPermissions';
import { useToast } from '@/components/ui/feedback';
import {
  INITIAL_STATE,
  getCurrentStep,
  getProgress,
  reduce,
  type EngineState,
} from '@/lib/onboarding/engine';
import { ALL_FLOWS, getFlow } from '@/lib/onboarding/flows';
import { resolveFlow } from '@/lib/onboarding/resolveFlow';
import { canRequestFlow } from '@/lib/onboarding/triggerGuards';
import type { FlowId, Role, Segment, TargetId } from '@/lib/onboarding/types';
import {
  fetchOnboardingState,
  markFlowAborted,
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

export interface OnboardingAnalyticsEvent {
  flowId: string;
  step: number;
  segment: Segment;
  role: Role;
  action: string;
}

export interface OnboardingAnalytics {
  onEvent: (event: OnboardingAnalyticsEvent) => void;
}

interface OnboardingProviderProps {
  /** True only when the main shell is interactive (not booting/blocked). */
  enabled: boolean;
  /** Optional analytics sink. Defaults to a no-op (dev logs in __DEV__). */
  analytics?: OnboardingAnalytics;
  children: ReactNode;
}

export function OnboardingProvider({ enabled, analytics, children }: OnboardingProviderProps) {
  const { user } = useAuth();
  const { account, billing, memberships } = useAccount();
  const router = useRouter();
  const pathname = usePathname();
  const reducedMotion = useReducedMotion();
  const blockingOverlayPresent = useBlockingOverlayPresent();
  const { toast } = useToast();

  const [state, dispatch] = useReducer(reduce, INITIAL_STATE);
  const [stateLoaded, setStateLoaded] = useState(false);

  // --- Segment + role ------------------------------------------------------
  // Segment is owned by us: an explicit account override wins, otherwise it is
  // derived from the billing agreement type. Role drives step-level gating.
  const segment = useMemo<Segment>(() => {
    if (account?.onboarding_segment === 'dfy' || account?.onboarding_segment === 'self_serve') {
      return account.onboarding_segment;
    }
    return billing?.agreement_type === 'managed_services_agreement' ? 'dfy' : 'self_serve';
  }, [account?.onboarding_segment, billing?.agreement_type]);

  const role = useMemo<Role>(() => {
    const membership = memberships.find((m) => m.account.id === account?.id)?.membership ?? null;
    return getAccountMembershipRole(membership);
  }, [memberships, account?.id]);

  // --- Latest-value refs (read inside callbacks/timers) --------------------
  const stateRef = useRef<EngineState>(state);
  stateRef.current = state;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const blockingOverlayRef = useRef(blockingOverlayPresent);
  blockingOverlayRef.current = blockingOverlayPresent;
  const stateLoadedRef = useRef(stateLoaded);
  stateLoadedRef.current = stateLoaded;
  const userRef = useRef(user);
  userRef.current = user;
  const segmentRef = useRef(segment);
  segmentRef.current = segment;
  const roleRef = useRef(role);
  roleRef.current = role;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const targetsRef = useRef(new Map<TargetId, RefObject<View | null>>());
  const seenRef = useRef<Set<string>>(new Set());
  const autoStartedRef = useRef<Set<string>>(new Set());
  // Single-flight: at most one flow may be active OR pending-to-start.
  const pendingFlowRef = useRef<FlowId | null>(null);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const emit = useCallback(
    (flowId: string, stepIndex: number, action: string) => {
      analytics?.onEvent({
        flowId,
        step: stepIndex,
        segment: segmentRef.current,
        role: roleRef.current,
        action,
      });
      if (__DEV__) {
        console.log('[onboarding]', { flowId, stepIndex, action });
      }
    },
    [analytics],
  );

  // Load per-user completion state once. Version-aware: a previously-seen flow
  // becomes eligible again if it opts into reshowOnVersionBump and its stored
  // version is behind the registry.
  useEffect(() => {
    if (!user) {
      seenRef.current = new Set();
      setStateLoaded(false);
      return;
    }
    let cancelled = false;
    void fetchOnboardingState(user.id).then((rows) => {
      if (cancelled) return;
      const seen = new Set<string>();
      for (const row of rows) {
        const def = getFlow(row.flow_id as FlowId);
        if (def?.reshowOnVersionBump && row.flow_version < def.version) continue;
        seen.add(row.flow_id);
      }
      seenRef.current = seen;
      setStateLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  // --- Actions -------------------------------------------------------------

  const startFlow = useCallback(
    (id: FlowId) => {
      const def = getFlow(id);
      if (!def) return;
      const resolved = resolveFlow(def, { segment: segmentRef.current, role: roleRef.current });
      emit(id, 0, 'start');
      dispatch({ type: 'START', flow: resolved });
    },
    [emit],
  );

  const clearPending = useCallback(() => {
    if (pendingTimerRef.current) {
      clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = null;
    }
    pendingFlowRef.current = null;
  }, []);

  const requestFlow = useCallback(
    (id: FlowId) => {
      const eligible = canRequestFlow({
        enabled: enabledRef.current,
        stateLoaded: stateLoadedRef.current,
        hasUser: userRef.current != null,
        flowExists: getFlow(id) != null,
        alreadySeen: seenRef.current.has(id),
        flowActive: stateRef.current.status === 'active',
        flowPending: pendingFlowRef.current != null,
        blockingOverlayPresent: blockingOverlayRef.current,
      });
      if (!eligible) return;

      pendingFlowRef.current = id;
      pendingTimerRef.current = setTimeout(() => {
        pendingTimerRef.current = null;
        pendingFlowRef.current = null;
        if (stateRef.current.status === 'active') return;
        if (seenRef.current.has(id)) return;
        if (blockingOverlayRef.current) return;
        if (!enabledRef.current) return;
        startFlow(id);
      }, AUTO_START_DELAY_MS);
    },
    [startFlow],
  );

  // Clear any pending start timer on unmount.
  useEffect(() => clearPending, [clearPending]);

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

  const abortFlow = useCallback(() => {
    dispatch({ type: 'ABORT' });
  }, []);

  const notifyTargetPress = useCallback((id: TargetId) => {
    const step = getCurrentStep(stateRef.current);
    if (step?.kind === 'spotlight' && step.targetId === id) {
      dispatch({ type: 'TARGET_PRESS' });
    }
  }, []);

  const resetFlow = useCallback(async (id: FlowId) => {
    seenRef.current.delete(id);
    autoStartedRef.current.delete(id);
    if (userRef.current) await resetFlowState(userRef.current.id, id);
  }, []);

  const resetAllFlows = useCallback(async () => {
    const ids = Array.from(seenRef.current);
    seenRef.current = new Set();
    autoStartedRef.current = new Set();
    const currentUser = userRef.current;
    if (currentUser) {
      await Promise.all(ids.map((id) => resetFlowState(currentUser.id, id)));
    }
  }, []);

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

  // --- Persistence + reset on finish/dismiss/abort -------------------------

  useEffect(() => {
    if (!state.flow) return;
    const { status } = state;
    if (status !== 'completed' && status !== 'dismissed' && status !== 'aborted') return;

    const { id: flowId, version } = state.flow;
    seenRef.current.add(flowId);
    emit(flowId, state.stepIndex, status);

    if (user) {
      if (status === 'completed') {
        void markFlowComplete(user.id, flowId, version);
      } else if (status === 'dismissed') {
        void markFlowDismissed(user.id, flowId, version);
      } else {
        void markFlowAborted(user.id, flowId, version);
      }
    }

    // A failed spotlight should never be a confusing dead end: point the user
    // at the replay affordance rather than just vanishing.
    if (status === 'aborted') {
      toastRef.current.info('You can start the product tour anytime from Help.');
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

  // --- Auto-start (the welcome flow opts in via autoStart) -----------------

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

    autoStartedRef.current.add(candidate.id);
    requestFlow(candidate.id);
  }, [enabled, stateLoaded, user, state.status, blockingOverlayPresent, requestFlow]);

  const value = useMemo<OnboardingContextValue>(
    () => ({
      startFlow,
      requestFlow,
      dismissFlow,
      resetFlow,
      resetAllFlows,
      next,
      back,
      notifyTargetPress,
      registerTarget,
      currentStep: getCurrentStep(state),
      progress: getProgress(state),
      reducedMotion,
      blockingOverlayPresent,
      skipStep,
      abortFlow,
      measureTarget,
      getTargetNode,
    }),
    [
      startFlow,
      requestFlow,
      dismissFlow,
      resetFlow,
      resetAllFlows,
      next,
      back,
      notifyTargetPress,
      registerTarget,
      state,
      reducedMotion,
      blockingOverlayPresent,
      skipStep,
      abortFlow,
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
