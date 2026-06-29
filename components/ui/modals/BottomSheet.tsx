import React, { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MobileHeaderBackButton } from '@/components/ui/layout/MobileHeaderBackButton';
import { useVisualViewportKeyboardInset } from '@/hooks/useVisualViewportKeyboardInset';
import { useRegisterBlockingOverlay } from '@/components/onboarding/overlayPresence';
import {
  BottomSheetTakeoverContext,
  type BottomSheetTakeoverOptions,
  PickerInsideBottomSheetProvider,
} from './PickerInsideBottomSheetContext';

const isWeb = Platform.OS === 'web';

/** Max sheet height as a fraction of screen height (content can scroll inside below this cap). */
export const BOTTOM_SHEET_MAX_VIEWPORT_RATIO = 0.92;

/**
 * Vertical space available for scrollable sheet content (below drag handle, inside sheet padding).
 * Keep in sync with `sheetStyle` padding and `dragHandleStyle` margins in this file.
 */
export function getBottomSheetBodyScrollMaxHeight(screenHeight: number, bottomInset: number): number {
  const sheetMax = screenHeight * BOTTOM_SHEET_MAX_VIEWPORT_RATIO;
  const paddingBottom = Math.max(bottomInset, 16);
  const dragBlock = 4 + 16; // handle height + marginBottom
  return sheetMax - 12 - paddingBottom - dragBlock;
}

/** Body height when `expandBodyToMax` uses `expandBodyHeightFraction` (clamped to 0.35–1). */
export function getBottomSheetExpandedBodyHeight(
  sheetBodyMaxHeight: number,
  fraction: number = 1,
): number {
  const f = Math.min(1, Math.max(0.35, fraction));
  return Math.round(sheetBodyMaxHeight * f);
}

export interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Fires once after the close animation finishes (Modal fully dismissed). */
  onAfterClose?: () => void;
  /**
   * When true, the body region uses a fixed height derived from `getBottomSheetBodyScrollMaxHeight`
   * so nested pickers/takeovers are not clipped. Use with `flex:1` + `minHeight:0` on a child `ScrollView`.
   * Tune with `expandBodyHeightFraction` (default 1 = full max height).
   */
  expandBodyToMax?: boolean;
  /** With `expandBodyToMax`, body height = max body × this fraction (clamped 0.35–1). Default 1. */
  expandBodyHeightFraction?: number;
  overlayZIndex?: number;
}

const BACKDROP_OPACITY = 0.5;
const ANIMATION_DURATION = 250;
const TAKEOVER_DURATION = 250;
const TAKEOVER_NUDGE_Y = 10;
const TAKEOVER_SCALE_FROM = 0.97;
const HOST_OPACITY_WHEN_PICKER = 0.92;

/**
 * Slide-up bottom sheet (modal). Use for mobile action sheets and option lists.
 * Backdrop fades in place; sheet slides up from the bottom. Backdrop tap closes.
 */
export function BottomSheet({
  visible,
  onClose,
  children,
  onAfterClose,
  expandBodyToMax = false,
  expandBodyHeightFraction = 1,
  overlayZIndex,
}: BottomSheetProps) {
  const onAfterCloseRef = useRef(onAfterClose);
  onAfterCloseRef.current = onAfterClose;
  useRegisterBlockingOverlay(visible);
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const [takeover, setTakeover] = useState<BottomSheetTakeoverOptions | null>(null);

  // --- Web keyboard avoidance ---
  const webKeyboardInset = useVisualViewportKeyboardInset();
  const webSheetRef = useRef<View | null>(null);

  useEffect(() => {
    if (!isWeb) return;
    const el = webSheetRef.current as unknown as HTMLElement | null;
    if (!el) return;

    if (!visible || webKeyboardInset === 0) {
      el.style.transition = '';
      el.style.transform = '';
      el.style.maxHeight = '';
      return;
    }

    const vv = window.visualViewport;
    const availableH = vv ? vv.height - insets.top : screenHeight - webKeyboardInset - insets.top;
    const maxH = Math.min(screenHeight * BOTTOM_SHEET_MAX_VIEWPORT_RATIO, availableH);

    el.style.transition = 'transform 0.2s ease, max-height 0.2s ease';
    el.style.transform = `translateY(-${webKeyboardInset}px)`;
    el.style.maxHeight = `${maxH}px`;
  }, [webKeyboardInset, visible, screenHeight, insets.top]);

  // Web: scroll focused input into view when keyboard opens or input changes
  useEffect(() => {
    if (!isWeb || !visible) return;
    const sheetEl = webSheetRef.current as unknown as HTMLElement | null;
    if (!sheetEl) return;

    const scrollFocusedInput = () => {
      requestAnimationFrame(() => {
        const active = document.activeElement;
        if (!(active instanceof HTMLElement) || !active.matches('input, textarea, [contenteditable="true"]')) return;
        if (!sheetEl.contains(active)) return;

        const vv = window.visualViewport;
        const visibleBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
        const margin = 16;

        const inputRect = active.getBoundingClientRect();
        if (inputRect.bottom <= visibleBottom - margin && inputRect.top >= 0) return;

        // Find nearest scrollable ancestor
        let scrollEl: HTMLElement | null = active.parentElement;
        while (scrollEl && scrollEl !== sheetEl) {
          if (scrollEl.scrollHeight > scrollEl.clientHeight + 1) break;
          scrollEl = scrollEl.parentElement;
        }

        if (scrollEl && scrollEl !== sheetEl && inputRect.bottom > visibleBottom - margin) {
          scrollEl.scrollTop += inputRect.bottom - (visibleBottom - margin);
        } else {
          active.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      });
    };

    sheetEl.addEventListener('focusin', scrollFocusedInput);
    // Also scroll when keyboard inset changes (input already focused)
    if (webKeyboardInset > 0) scrollFocusedInput();

    return () => sheetEl.removeEventListener('focusin', scrollFocusedInput);
  }, [visible, webKeyboardInset]);

  const takeoverOpacity = useRef(new Animated.Value(0)).current;
  const takeoverTranslateY = useRef(new Animated.Value(0)).current;
  const takeoverScale = useRef(new Animated.Value(1)).current;
  const hostOpacity = useRef(new Animated.Value(1)).current;
  const takeoverExitingRef = useRef(false);
  const dismissTokenRef = useRef(0);
  const prevHadTakeoverRef = useRef(false);
  const takeoverRef = useRef<BottomSheetTakeoverOptions | null>(null);
  takeoverRef.current = takeover;

  const dismissTakeover = useCallback(() => {
    if (takeoverExitingRef.current) return;
    const current = takeoverRef.current;
    if (current == null) return;

    takeoverExitingRef.current = true;
    const optsToDismiss = current;
    const dismissToken = ++dismissTokenRef.current;
    const useNativeDriver = !isWeb;

    Animated.parallel([
      Animated.timing(takeoverOpacity, {
        toValue: 0,
        duration: TAKEOVER_DURATION,
        easing: Easing.in(Easing.cubic),
        useNativeDriver,
      }),
      Animated.timing(takeoverTranslateY, {
        toValue: TAKEOVER_NUDGE_Y,
        duration: TAKEOVER_DURATION,
        easing: Easing.in(Easing.cubic),
        useNativeDriver,
      }),
      Animated.timing(takeoverScale, {
        toValue: TAKEOVER_SCALE_FROM,
        duration: TAKEOVER_DURATION,
        easing: Easing.in(Easing.cubic),
        useNativeDriver,
      }),
      Animated.timing(hostOpacity, {
        toValue: 1,
        duration: TAKEOVER_DURATION,
        easing: Easing.in(Easing.cubic),
        useNativeDriver,
      }),
    ]).start(({ finished }) => {
      takeoverExitingRef.current = false;
      if (!finished) return;
      if (dismissToken !== dismissTokenRef.current) return;
      setTakeover(null);
      optsToDismiss.onRequestDismiss?.();
    });
  }, [
    takeoverOpacity,
    takeoverTranslateY,
    takeoverScale,
    hostOpacity,
  ]);

  const presentTakeover = useCallback(
    (opts: BottomSheetTakeoverOptions) => {
      dismissTokenRef.current += 1;
      takeoverOpacity.stopAnimation();
      takeoverTranslateY.stopAnimation();
      takeoverScale.stopAnimation();
      hostOpacity.stopAnimation();
      takeoverExitingRef.current = false;
      // Do not call Animated.setValue inside setState's updater — on RN Web it can
      // schedule updates to animated ForwardRefs during React's render phase.
      const prev = takeoverRef.current;
      if (prev != null) {
        takeoverOpacity.setValue(1);
        takeoverTranslateY.setValue(0);
        takeoverScale.setValue(1);
        hostOpacity.setValue(HOST_OPACITY_WHEN_PICKER);
      } else {
        takeoverOpacity.setValue(0);
        takeoverTranslateY.setValue(TAKEOVER_NUDGE_Y);
        takeoverScale.setValue(TAKEOVER_SCALE_FROM);
        hostOpacity.setValue(1);
      }
      setTakeover(opts);
    },
    [
      takeoverOpacity,
      takeoverTranslateY,
      takeoverScale,
      hostOpacity,
    ]
  );

  const handleBackdropOrHardwareBack = useCallback(() => {
    if (takeoverRef.current != null) {
      dismissTakeover();
      return;
    }
    onClose();
  }, [dismissTakeover, onClose]);

  const takeoverContextValue = useMemo(
    () => ({
      presentTakeover,
      dismissTakeover,
      takeoverActive: takeover != null,
    }),
    [presentTakeover, dismissTakeover, takeover]
  );

  useEffect(() => {
    if (!visible) {
      takeoverOpacity.stopAnimation();
      takeoverOpacity.setValue(0);
      takeoverTranslateY.stopAnimation();
      takeoverTranslateY.setValue(0);
      takeoverScale.stopAnimation();
      takeoverScale.setValue(1);
      hostOpacity.stopAnimation();
      hostOpacity.setValue(1);
      takeoverExitingRef.current = false;
      dismissTokenRef.current += 1;
      setTakeover(null);
      prevHadTakeoverRef.current = false;
    }
  }, [visible, takeoverOpacity, takeoverTranslateY, takeoverScale, hostOpacity]);

  // Modal stays visible until close animation completes (avoids flash when parent sets visible=false)
  const [isOpen, setIsOpen] = useState(visible);
  const prevVisibleRef = useRef(visible);
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const sheetTranslateY = useRef(new Animated.Value(screenHeight)).current;

  // Close animation: native driver on native, JS driver on web (for consistent close behavior)
  const useNative = !isWeb;

  useEffect(() => {
    if (takeover != null) {
      const openingFresh = !prevHadTakeoverRef.current;
      prevHadTakeoverRef.current = true;
      if (openingFresh) {
        Animated.parallel([
          Animated.timing(takeoverOpacity, {
            toValue: 1,
            duration: TAKEOVER_DURATION,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: useNative,
          }),
          Animated.timing(takeoverTranslateY, {
            toValue: 0,
            duration: TAKEOVER_DURATION,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: useNative,
          }),
          Animated.timing(takeoverScale, {
            toValue: 1,
            duration: TAKEOVER_DURATION,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: useNative,
          }),
          Animated.timing(hostOpacity, {
            toValue: HOST_OPACITY_WHEN_PICKER,
            duration: TAKEOVER_DURATION,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: useNative,
          }),
        ]).start();
      }
      return;
    }
    prevHadTakeoverRef.current = false;
  }, [takeover, useNative, takeoverOpacity, takeoverTranslateY, takeoverScale, hostOpacity]);

  useEffect(() => {
    if (visible) {
      setIsOpen(true);
      prevVisibleRef.current = true;
      if (isWeb) {
        // On web: two Modals so backdrop only fades (no slide) and sheet only slides
        backdropOpacity.setValue(1);
        sheetTranslateY.setValue(0);
      } else {
        backdropOpacity.setValue(0);
        sheetTranslateY.setValue(screenHeight);
        Animated.parallel([
          Animated.timing(backdropOpacity, {
            toValue: 1,
            duration: ANIMATION_DURATION,
            useNativeDriver: true,
          }),
          Animated.timing(sheetTranslateY, {
            toValue: 0,
            duration: ANIMATION_DURATION,
            useNativeDriver: true,
          }),
        ]).start();
      }
    } else if (prevVisibleRef.current) {
      prevVisibleRef.current = false;
      // Dismiss keyboard so it animates out with the sheet
      if (isWeb) (document.activeElement as HTMLElement | null)?.blur?.();
      // Don't set isOpen false here — only after animation completes, so modal doesn't flash
      Animated.parallel([
        Animated.timing(backdropOpacity, {
          toValue: 0,
          duration: ANIMATION_DURATION,
          useNativeDriver: useNative,
        }),
        Animated.timing(sheetTranslateY, {
          toValue: screenHeight,
          duration: ANIMATION_DURATION,
          useNativeDriver: useNative,
        }),
      ]).start(({ finished }) => {
        if (!finished && !isWeb) return;
        setIsOpen(false);
        onAfterCloseRef.current?.();
      });
    }
  }, [visible, screenHeight, backdropOpacity, sheetTranslateY, useNative, isWeb]);

  const containerClassName = isWeb
    ? 'fixed inset-0 w-screen h-screen flex justify-end overflow-hidden'
    : 'flex-1 justify-end overflow-hidden';
  /** Web: omit flex justify-end here — with RN Web it can collapse an absolutely positioned backdrop to height 0. */
  const webBackdropModalContainerClassName = 'fixed inset-0 w-screen h-screen overflow-hidden';
  const containerStyle = isWeb
    ? overlayZIndex != null
      ? { zIndex: overlayZIndex }
      : undefined
    : overlayZIndex != null
      ? { width: screenWidth, height: screenHeight, zIndex: overlayZIndex }
      : { width: screenWidth, height: screenHeight };
  const webBackdropFillStyle = {
    position: 'absolute' as const,
    left: 0,
    top: 0,
    width: screenWidth,
    height: screenHeight,
  };

  const sheetMaxHeight = screenHeight * BOTTOM_SHEET_MAX_VIEWPORT_RATIO;
  const sheetBodyMaxHeight = getBottomSheetBodyScrollMaxHeight(screenHeight, insets.bottom);
  const expandedBodyHeight = expandBodyToMax
    ? getBottomSheetExpandedBodyHeight(sheetBodyMaxHeight, expandBodyHeightFraction)
    : undefined;
  /** When not expanding the body, temporarily lift the host floor while a takeover is open. */
  const takeoverHostMinHeight =
    expandBodyToMax || takeover == null
      ? undefined
      : Math.min(sheetBodyMaxHeight, Math.max(280, Math.round(screenHeight * 0.35)));

  const sheetStyle = {
    backgroundColor: '#1A1A1A',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderColor: '#2A2A2A',
    paddingTop: 12,
    paddingHorizontal: 16,
    paddingBottom: Math.max(insets.bottom, 16),
    minHeight: 120,
    maxHeight: sheetMaxHeight,
    width: screenWidth,
    alignSelf: 'stretch' as const,
    transform: [{ translateY: sheetTranslateY }],
  };

  const backdropStyle = {
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    opacity: backdropOpacity,
  };

  const dragHandleStyle = {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#4B5563',
    alignSelf: 'center' as const,
    marginBottom: 16,
  };

  const sheetBody = (
    <>
      <View style={dragHandleStyle} />
      <BottomSheetTakeoverContext.Provider value={takeoverContextValue}>
        <View
          style={[
            styles.sheetBodyHost,
            { maxHeight: sheetBodyMaxHeight },
            expandBodyToMax && expandedBodyHeight != null
              ? { height: expandedBodyHeight }
              : null,
            takeoverHostMinHeight != null ? { minHeight: takeoverHostMinHeight } : null,
          ]}
        >
          <Animated.View style={{ flex: 1, minHeight: 0, opacity: hostOpacity }}>
            <PickerInsideBottomSheetProvider value={true}>
              {children}
            </PickerInsideBottomSheetProvider>
          </Animated.View>
          {takeover != null && (
            <Animated.View
              style={[
                styles.takeoverLayer,
                {
                  opacity: takeoverOpacity,
                  transform: [
                    { translateY: takeoverTranslateY },
                    { scale: takeoverScale },
                  ],
                },
              ]}
              pointerEvents="box-none"
            >
              <View style={styles.takeoverInner}>
                <MobileHeaderBackButton onPress={dismissTakeover} className="mb-1" />
                {takeover.title != null && takeover.title !== '' && (
                  <Text
                    className="text-lg font-instrument-medium text-white mb-3"
                    style={{ fontFamily: 'Instrument Sans, system-ui, sans-serif' }}
                  >
                    {takeover.title}
                  </Text>
                )}
                <KeyboardAvoidingView
                  behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                  style={styles.takeoverKav}
                >
                  <PickerInsideBottomSheetProvider value={false}>
                    {takeover.content}
                  </PickerInsideBottomSheetProvider>
                </KeyboardAvoidingView>
              </View>
            </Animated.View>
          )}
        </View>
      </BottomSheetTakeoverContext.Provider>
    </>
  );

  // On web: two Modals — backdrop fades in place, sheet slides up (close uses our Animated)
  if (isWeb) {
    return (
      <>
        <Modal
          visible={isOpen}
          transparent
          animationType="fade"
          onRequestClose={handleBackdropOrHardwareBack}
          {...(overlayZIndex != null ? { style: { zIndex: overlayZIndex } } : {})}
        >
          <View className={webBackdropModalContainerClassName} style={containerStyle}>
            <Animated.View style={[webBackdropFillStyle, backdropStyle]}>
              <Pressable className="absolute inset-0" onPress={handleBackdropOrHardwareBack} />
            </Animated.View>
          </View>
        </Modal>
        <Modal
          visible={isOpen}
          transparent
          animationType="slide"
          onRequestClose={handleBackdropOrHardwareBack}
          {...(overlayZIndex != null ? { style: { zIndex: overlayZIndex } } : {})}
        >
          <View
            className="fixed inset-0 w-screen h-screen flex flex-col overflow-hidden"
            style={containerStyle}
          >
            <Pressable
              className="w-full flex-1 min-h-0"
              onPress={handleBackdropOrHardwareBack}
            />
            <Animated.View
              ref={webSheetRef}
              className="overflow-hidden flex-shrink-0"
              style={sheetStyle}
              onStartShouldSetResponder={() => true}
            >
              {sheetBody}
            </Animated.View>
          </View>
        </Modal>
      </>
    );
  }

  return (
    <Modal
      visible={isOpen}
      transparent
      animationType="none"
      onRequestClose={handleBackdropOrHardwareBack}
      {...(overlayZIndex != null ? { style: { zIndex: overlayZIndex } } : {})}
    >
      <View className={containerClassName} style={containerStyle}>
        <Animated.View className="absolute inset-0" style={backdropStyle}>
          <Pressable className="absolute inset-0" onPress={handleBackdropOrHardwareBack} />
        </Animated.View>
        <Animated.View
          className="overflow-hidden"
          style={sheetStyle}
          onStartShouldSetResponder={() => true}
        >
          {sheetBody}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheetBodyHost: {
    position: 'relative',
    minHeight: 120,
    overflow: 'hidden',
  },
  takeoverLayer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#1A1A1A',
    zIndex: 10,
  },
  takeoverInner: {
    flex: 1,
    paddingHorizontal: 0,
  },
  takeoverKav: {
    flex: 1,
    minHeight: 0,
  },
});
