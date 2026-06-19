import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, View, type LayoutChangeEvent } from 'react-native';
import { InboxSmartHandlingBar } from './InboxSmartHandlingBar';
import type { SmartHandlingActionOption, SmartHandlingMode } from '@/lib/inbox/smartHandling';
import type { ThreadStatusCalloutView } from '@/lib/inbox/threadStatusCallout';

type ThreadStatusCalloutProps = ThreadStatusCalloutView & {
  mode: SmartHandlingMode;
  onAction?: (action: SmartHandlingActionOption) => void;
  onDismiss?: () => void;
};

const EXIT_DURATION_MS = 220;
const EXIT_EASING = Easing.out(Easing.cubic);
const CALLOUT_MARGIN = 16;
const EXIT_TRANSLATE_Y = 10;

function isSmartHandlingCallout(callout: ThreadStatusCalloutProps | null): boolean {
  return callout != null && callout.kind !== 'pipeline_only';
}

function shouldAnimateSmartHandlingExit(
  previous: ThreadStatusCalloutProps | null,
  next: ThreadStatusCalloutProps | null,
): boolean {
  if (!isSmartHandlingCallout(previous)) return false;
  if (!next) return true;
  return next.kind === 'pipeline_only';
}

interface SmartHandlingCalloutSlotProps {
  callout: ThreadStatusCalloutProps | null;
  selectedThreadId: string | null;
  messageColumnNarrow: boolean;
}

function CalloutBar({
  callout,
  isExiting,
}: {
  callout: ThreadStatusCalloutProps;
  isExiting: boolean;
}) {
  return (
    <InboxSmartHandlingBar
      loading={callout.loading}
      mode={callout.mode}
      tone={callout.tone}
      title={callout.title}
      message={callout.message}
      secondaryMessage={callout.secondaryMessage}
      primary={callout.primary}
      alternatives={callout.alternatives}
      onAction={isExiting ? undefined : callout.onAction}
      onDismiss={isExiting ? undefined : callout.onDismiss}
      dismissible={callout.dismissible && !isExiting}
    />
  );
}

export function SmartHandlingCalloutSlot({
  callout,
  selectedThreadId,
  messageColumnNarrow,
}: SmartHandlingCalloutSlotProps) {
  const [renderSnapshot, setRenderSnapshot] = useState<ThreadStatusCalloutProps | null>(callout);
  const [isExiting, setIsExiting] = useState(false);

  const prevThreadIdRef = useRef(selectedThreadId);
  const snapshotRef = useRef<ThreadStatusCalloutProps | null>(callout);
  const isExitingRef = useRef(false);
  const measuredHeightRef = useRef(0);
  const exitAnimationRef = useRef<Animated.CompositeAnimation | null>(null);
  const pendingAfterExitRef = useRef<ThreadStatusCalloutProps | null>(null);

  const contentHeight = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const marginTop = useRef(new Animated.Value(CALLOUT_MARGIN)).current;
  const marginBottom = useRef(new Animated.Value(CALLOUT_MARGIN)).current;

  const resetAnimValues = useCallback(() => {
    opacity.setValue(1);
    translateY.setValue(0);
    marginTop.setValue(CALLOUT_MARGIN);
    marginBottom.setValue(CALLOUT_MARGIN);
    if (measuredHeightRef.current > 0) {
      contentHeight.setValue(measuredHeightRef.current);
    }
  }, [contentHeight, marginBottom, marginTop, opacity, translateY]);

  const cancelExitAnimation = useCallback(() => {
    exitAnimationRef.current?.stop();
    exitAnimationRef.current = null;
    pendingAfterExitRef.current = null;
    isExitingRef.current = false;
    setIsExiting(false);
  }, []);

  const clearSnapshot = useCallback(() => {
    snapshotRef.current = null;
    setRenderSnapshot(null);
    isExitingRef.current = false;
    setIsExiting(false);
  }, []);

  const applySnapshot = useCallback(
    (next: ThreadStatusCalloutProps | null) => {
      snapshotRef.current = next;
      setRenderSnapshot(next);
      if (next) {
        resetAnimValues();
      }
    },
    [resetAnimValues],
  );

  const finishExit = useCallback(() => {
    const pending = pendingAfterExitRef.current;
    pendingAfterExitRef.current = null;
    isExitingRef.current = false;
    setIsExiting(false);

    if (pending) {
      applySnapshot(pending);
      return;
    }

    clearSnapshot();
  }, [applySnapshot, clearSnapshot]);

  const startExitAnimation = useCallback(() => {
    if (!snapshotRef.current || isExitingRef.current) return;

    isExitingRef.current = true;
    setIsExiting(true);

    const height = measuredHeightRef.current;
    contentHeight.setValue(height > 0 ? height : 0);

    const animation = Animated.parallel([
      Animated.timing(opacity, {
        toValue: 0,
        duration: EXIT_DURATION_MS,
        easing: EXIT_EASING,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: EXIT_TRANSLATE_Y,
        duration: EXIT_DURATION_MS,
        easing: EXIT_EASING,
        useNativeDriver: true,
      }),
      Animated.timing(contentHeight, {
        toValue: 0,
        duration: EXIT_DURATION_MS,
        easing: EXIT_EASING,
        useNativeDriver: false,
      }),
      Animated.timing(marginTop, {
        toValue: 0,
        duration: EXIT_DURATION_MS,
        easing: EXIT_EASING,
        useNativeDriver: false,
      }),
      Animated.timing(marginBottom, {
        toValue: 0,
        duration: EXIT_DURATION_MS,
        easing: EXIT_EASING,
        useNativeDriver: false,
      }),
    ]);

    exitAnimationRef.current = animation;
    animation.start(({ finished }) => {
      exitAnimationRef.current = null;
      if (finished) {
        finishExit();
      }
    });
  }, [contentHeight, finishExit, marginBottom, marginTop, opacity, translateY]);

  useEffect(() => {
    if (prevThreadIdRef.current !== selectedThreadId) {
      prevThreadIdRef.current = selectedThreadId;
      cancelExitAnimation();
      pendingAfterExitRef.current = null;
      applySnapshot(callout);
      return;
    }

    const previous = snapshotRef.current;

    if (callout && isSmartHandlingCallout(callout)) {
      pendingAfterExitRef.current = null;
      if (!isExitingRef.current) {
        applySnapshot(callout);
      }
      return;
    }

    if (shouldAnimateSmartHandlingExit(previous, callout) && !isExitingRef.current) {
      pendingAfterExitRef.current = callout?.kind === 'pipeline_only' ? callout : null;
      startExitAnimation();
    } else if (!isExitingRef.current) {
      applySnapshot(callout);
    }
  }, [applySnapshot, callout, cancelExitAnimation, selectedThreadId, startExitAnimation]);

  useEffect(() => {
    return () => {
      exitAnimationRef.current?.stop();
    };
  }, []);

  const onContentLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const height = event.nativeEvent.layout.height;
      measuredHeightRef.current = height;
      if (!isExitingRef.current && height > 0) {
        contentHeight.setValue(height);
      }
    },
    [contentHeight],
  );

  if (!renderSnapshot) {
    return null;
  }

  const animatedShell = (
    <Animated.View
      pointerEvents={isExiting ? 'none' : 'auto'}
      style={{
        overflow: 'hidden',
        marginTop,
        marginBottom,
        opacity,
        height: isExiting ? contentHeight : undefined,
        transform: [{ translateY }],
      }}
    >
      <View onLayout={onContentLayout}>
        <CalloutBar callout={renderSnapshot} isExiting={isExiting} />
      </View>
    </Animated.View>
  );

  if (messageColumnNarrow) {
    return (
      <View className="flex-row w-full justify-center items-center">
        <View className="w-[92%] max-w-[92%]">{animatedShell}</View>
      </View>
    );
  }

  return animatedShell;
}
