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
import { Platform, View } from 'react-native';
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
import { getAllFlows, getFlow } from '@/lib/onboarding/flows';
import { resolveFlow } from '@/lib/onboarding/resolveFlow';
import { canStartFlow, pickNextFlow } from '@/lib/onboarding/scheduler';
import { TARGETS, type FlowId, type Role, type Segment, type TargetId } from '@/lib/onboarding/types';
import {
  fetchOnboardingState,
  markFlowAborted,
  markFlowComplete,
  markFlowDismissed,
  resetAllFlowState,
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

const SETTLE_DELAY_MS = 900;

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
  const [registrationEpoch, setRegistrationEpoch] = useState(0);
  const [advanceGateBlocked, setAdvanceGateBlocked] = useState(false);

  // --- Segment + role ------------------------------------------------------
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
  const advanceGateBlockedRef = useRef(advanceGateBlocked);
  advanceGateBlockedRef.current = advanceGateBlocked;

  const targetsRef = useRef(new Map<TargetId, RefObject<View | null>>());
  const seenRef = useRef<Set<string>>(new Set());
  const registrationsRef = useRef(new Set<FlowId>());
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduledCandidateRef = useRef<FlowId | null>(null);

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
        const def = getFlow(row.flow_id as FlowId, segmentRef.current);
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

  const bumpRegistrationEpoch = useCallback(() => {
    setRegistrationEpoch((epoch) => epoch + 1);
  }, []);

  // --- Actions -------------------------------------------------------------

  const startFlow = useCallback(
    (id: FlowId) => {
      const def = getFlow(id, segmentRef.current);
      if (!def) return;
      const resolved = resolveFlow(def, { segment: segmentRef.current, role: roleRef.current });
      emit(id, 0, 'start');
      dispatch({ type: 'START', flow: resolved });
    },
    [emit],
  );

  const registerFlowIntent = useCallback(
    (id: FlowId, ready: boolean) => {
      const had = registrationsRef.current.has(id);
      if (ready) {
        registrationsRef.current.add(id);
      } else {
        registrationsRef.current.delete(id);
      }
      if (had !== registrationsRef.current.has(id)) {
        bumpRegistrationEpoch();
      }
    },
    [bumpRegistrationEpoch],
  );

  const next = useCallback(() => {
    // Defense in depth: the Pressable is already disabled while gated, but
    // guard the dispatch itself so no path (keyboard, race) can advance early.
    if (advanceGateBlockedRef.current) return;
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

  const notifyStepRequirementMet = useCallback(() => {
    const step = getCurrentStep(stateRef.current);
    if (step?.kind === 'spotlight' && step.advance === 'onRequirementMet') {
      dispatch({ type: 'REQUIREMENT_MET' });
    }
  }, []);

  const resetFlow = useCallback(
    async (id: FlowId) => {
      seenRef.current.delete(id);
      if (userRef.current) await resetFlowState(userRef.current.id, id);
      bumpRegistrationEpoch();
    },
    [bumpRegistrationEpoch],
  );

  const resetAllFlows = useCallback(async () => {
    seenRef.current = new Set();
    const currentUser = userRef.current;
    if (currentUser) {
      await resetAllFlowState(currentUser.id);
    }
    bumpRegistrationEpoch();
  }, [bumpRegistrationEpoch]);

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

    if (Platform.OS === 'web') {
      const el = node as unknown as HTMLElement;
      const rect = el.getBoundingClientRect?.();
      if (rect && rect.width > 0 && rect.height > 0) {
        return Promise.resolve({
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
        });
      }
      return Promise.resolve(null);
    }

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

  // --- Persistence on terminal outcomes ------------------------------------

  useEffect(() => {
    if (!state.ended) return;

    const { flow, stepIndex, outcome } = state.ended;
    seenRef.current.add(flow.id);
    emit(flow.id, stepIndex, outcome);

    if (user) {
      if (outcome === 'completed') {
        void markFlowComplete(user.id, flow.id, flow.version);
      } else if (outcome === 'dismissed') {
        void markFlowDismissed(user.id, flow.id, flow.version);
      } else {
        void markFlowAborted(user.id, flow.id, flow.version);
      }
    }

    // Fail-safe: a mandatory tour ends 'aborted' when an anchor can't be
    // resolved (see SpotlightOverlay). It's already marked seen above, so it
    // won't re-trap on the next visit; suppress the "start it from Help" hint
    // since there's no Help entry for a mandatory flow.
    const endedEffectiveMandatory =
      !!flow.mandatory &&
      !(flow.mandatoryUnlessSeen && seenRef.current.has(flow.mandatoryUnlessSeen));
    if (outcome === 'aborted' && !endedEffectiveMandatory) {
      toastRef.current.info('You can start the product tour anytime from Help.');
    }

    dispatch({ type: 'CLEAR_ENDED' });
  }, [state.ended, user, emit]);

  // --- Scheduler: single settle timer picks the next eligible flow -----------

  useEffect(() => {
    const cancelSettleTimer = () => {
      if (settleTimerRef.current) {
        clearTimeout(settleTimerRef.current);
        settleTimerRef.current = null;
      }
      scheduledCandidateRef.current = null;
    };

    const runScheduler = () => {
      cancelSettleTimer();

      const current = stateRef.current;
      if (current.status !== 'idle' || current.ended) return;

      const candidate = pickNextFlow({
        flows: getAllFlows(segmentRef.current),
        seen: seenRef.current,
        readyRegistrations: registrationsRef.current,
      });
      if (!candidate) return;

      const eligible = canStartFlow({
        enabled: enabledRef.current,
        stateLoaded: stateLoadedRef.current,
        hasUser: userRef.current != null,
        flowExists: getFlow(candidate, segmentRef.current) != null,
        alreadySeen: seenRef.current.has(candidate),
        engineIdle: stateRef.current.status === 'idle' && !stateRef.current.ended,
        blockingOverlayPresent: blockingOverlayRef.current,
      });
      if (!eligible) return;

      scheduledCandidateRef.current = candidate;
      settleTimerRef.current = setTimeout(() => {
        settleTimerRef.current = null;
        const id = scheduledCandidateRef.current;
        scheduledCandidateRef.current = null;
        if (!id) return;

        const latest = stateRef.current;
        if (latest.status !== 'idle' || latest.ended) {
          runScheduler();
          return;
        }
        if (seenRef.current.has(id)) {
          runScheduler();
          return;
        }
        if (blockingOverlayRef.current || !enabledRef.current || !stateLoadedRef.current) {
          runScheduler();
          return;
        }
        if (!getFlow(id, segmentRef.current)) return;

        const repick = pickNextFlow({
          flows: getAllFlows(segmentRef.current),
          seen: seenRef.current,
          readyRegistrations: registrationsRef.current,
        });
        if (repick !== id) {
          runScheduler();
          return;
        }

        startFlow(id);
      }, SETTLE_DELAY_MS);
    };

    runScheduler();
    return cancelSettleTimer;
  }, [
    state.status,
    state.ended,
    registrationEpoch,
    enabled,
    stateLoaded,
    blockingOverlayPresent,
    user,
    segment,
    startFlow,
  ]);

  // Steps that require an external condition before Next may be pressed
  // default to blocked on entry, closing the one-frame window where Next
  // would otherwise be clickable before the owning screen re-asserts the gate.
  useEffect(() => {
    const step = getCurrentStep(state);
    const requiresGate = step?.kind === 'spotlight' && step.targetId === TARGETS.accountNotifications;
    setAdvanceGateBlocked(requiresGate);
  }, [state.flow?.id, state.stepIndex, state.status]);

  // --- Cross-route navigation ---------------------------------------------

  useEffect(() => {
    const step = getCurrentStep(state);
    if (!step?.route) return;
    if (pathname === step.route) return;
    router.push(step.route as Href);
  }, [state, pathname, router]);

  // Effective-mandatory for the active flow: `mandatory` unless its named
  // sibling has already been seen (so the first inbox tour a user completes is
  // locked, and the other platform's replay stays optional).
  const currentFlowMandatory =
    !!state.flow?.mandatory &&
    !(state.flow.mandatoryUnlessSeen && seenRef.current.has(state.flow.mandatoryUnlessSeen));

  const value = useMemo<OnboardingContextValue>(
    () => ({
      startFlow,
      registerFlowIntent,
      dismissFlow,
      resetFlow,
      resetAllFlows,
      next,
      back,
      notifyTargetPress,
      notifyStepRequirementMet,
      advanceGateBlocked,
      setAdvanceGateBlocked,
      registerTarget,
      currentStep: getCurrentStep(state),
      progress: getProgress(state),
      reducedMotion,
      blockingOverlayPresent,
      currentFlowMandatory,
      segment,
      skipStep,
      abortFlow,
      measureTarget,
      getTargetNode,
    }),
    [
      startFlow,
      registerFlowIntent,
      dismissFlow,
      resetFlow,
      resetAllFlows,
      next,
      back,
      notifyTargetPress,
      notifyStepRequirementMet,
      advanceGateBlocked,
      setAdvanceGateBlocked,
      registerTarget,
      state,
      reducedMotion,
      blockingOverlayPresent,
      currentFlowMandatory,
      segment,
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
