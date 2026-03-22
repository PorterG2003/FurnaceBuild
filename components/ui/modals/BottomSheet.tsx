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
import { MobileHeaderBackButton } from '@/components/ui/layout';
import {
  BottomSheetTakeoverContext,
  type BottomSheetTakeoverOptions,
  PickerInsideBottomSheetProvider,
} from './PickerInsideBottomSheetContext';

const isWeb = Platform.OS === 'web';

export interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
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
export function BottomSheet({ visible, onClose, children }: BottomSheetProps) {
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const [takeover, setTakeover] = useState<BottomSheetTakeoverOptions | null>(null);

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
      setTakeover((prev) => {
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
        return opts;
      });
    },
    [
      takeoverOpacity,
      takeoverTranslateY,
      takeoverScale,
      hostOpacity,
    ]
  );

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
      ]).start(() => setIsOpen(false));
    }
  }, [visible, screenHeight, backdropOpacity, sheetTranslateY, useNative, isWeb]);

  const containerClassName = isWeb
    ? 'fixed inset-0 w-screen h-screen flex justify-end overflow-hidden'
    : 'flex-1 justify-end overflow-hidden';
  /** Web: omit flex justify-end here — with RN Web it can collapse an absolutely positioned backdrop to height 0. */
  const webBackdropModalContainerClassName = 'fixed inset-0 w-screen h-screen overflow-hidden';
  const containerStyle = isWeb ? undefined : { width: screenWidth, height: screenHeight };
  const webBackdropFillStyle = {
    position: 'absolute' as const,
    left: 0,
    top: 0,
    width: screenWidth,
    height: screenHeight,
  };

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
        <View style={styles.sheetBodyHost}>
          <Animated.View style={{ flex: 1, opacity: hostOpacity }}>
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
          onRequestClose={onClose}
        >
          <View className={webBackdropModalContainerClassName} style={containerStyle}>
            <Animated.View style={[webBackdropFillStyle, backdropStyle]}>
              <Pressable className="absolute inset-0" onPress={onClose} />
            </Animated.View>
          </View>
        </Modal>
        <Modal
          visible={isOpen}
          transparent
          animationType="slide"
          onRequestClose={onClose}
        >
          <Pressable
            className={containerClassName}
            style={containerStyle}
            onPress={onClose}
          >
            <Animated.View
              className="overflow-hidden"
              style={sheetStyle}
              onStartShouldSetResponder={() => true}
            >
              {sheetBody}
            </Animated.View>
          </Pressable>
        </Modal>
      </>
    );
  }

  return (
    <Modal visible={isOpen} transparent animationType="none" onRequestClose={onClose}>
      <View className={containerClassName} style={containerStyle}>
        <Animated.View className="absolute inset-0" style={backdropStyle}>
          <Pressable className="absolute inset-0" onPress={onClose} />
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
    flexGrow: 1,
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
