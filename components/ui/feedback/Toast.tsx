import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { View, Text, Animated, Easing, StyleSheet, Platform, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LAYOUT_BREAKPOINT } from '@/components/ui/layout/constants';

export type ToastVariant = 'error' | 'success' | 'warning' | 'info' | 'notification';

const TOAST_DURATION_MS = 4500;
const SLIDE_OFFSET = 120;
const ANIMATION_DURATION = 320;
const ANIMATION_EASING = Easing.out(Easing.cubic);
const FLOAT_DELAY_MS = 60;
const MAX_STACK_DEPTH = 3;
const STACK_MIN_HEIGHT = 120;

const STACK_Z_INDEX = [3, 2, 1] as const;
const STACK_TRANSLATE_Y = [0, 10, 20] as const;
const STACK_SCALE = [1, 0.92, 0.84] as const;

const TOAST_BASE_WIDTH = 320;

const variantStyles = {
  error: {
    container: 'bg-red-900 border-red-500',
    text: 'text-red-100',
  },
  success: {
    container: 'bg-green-900 border-green-500',
    text: 'text-green-100',
  },
  warning: {
    container: 'bg-amber-900 border-amber-500',
    text: 'text-amber-100',
  },
  info: {
    container: 'bg-blue-900 border-blue-500',
    text: 'text-blue-100',
  },
  notification: {
    container: 'bg-[#2A2A2A] border-[#3A3A3A]',
    text: 'text-gray-100',
  },
};

interface ToastItem {
  id: string;
  message: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  toast: {
    success: (message: string) => void;
    error: (message: string) => void;
    warning: (message: string) => void;
    info: (message: string) => void;
    /** Neutral in-app notification (bell / activity), not success or error */
    notification: (message: string) => void;
  };
}

const ToastContext = createContext<ToastContextValue | null>(null);

function generateToastId(): string {
  return `toast-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return ctx;
}

interface ToastItemProps {
  id: string;
  message: string;
  variant: ToastVariant;
  fullWidth: boolean;
  stackPosition: 0 | 1 | 2;
  zIndex: number;
  onStartExit?: (id: string) => void;
  onDismiss: (id: string) => void;
  durationMs: number;
}

function ToastItemComponent({
  id,
  message,
  variant,
  fullWidth,
  stackPosition,
  zIndex,
  onStartExit,
  onDismiss,
  durationMs,
}: ToastItemProps) {
  const translateY = useRef(new Animated.Value(-SLIDE_OFFSET)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(STACK_SCALE[0])).current;
  const stackOffsetYAnim = useRef(new Animated.Value(STACK_TRANSLATE_Y[0])).current;
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isInitialMount = useRef(true);

  useEffect(() => {
    scaleAnim.setValue(STACK_SCALE[stackPosition]);
    stackOffsetYAnim.setValue(STACK_TRANSLATE_Y[stackPosition]);
    const startY = -SLIDE_OFFSET;
    translateY.setValue(startY);
    opacity.setValue(0);
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: 0,
        duration: ANIMATION_DURATION,
        easing: ANIMATION_EASING,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: ANIMATION_DURATION,
        easing: ANIMATION_EASING,
        useNativeDriver: true,
      }),
    ]).start();
  }, [translateY, opacity]);

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    Animated.sequence([
      Animated.delay(FLOAT_DELAY_MS),
      Animated.parallel([
        Animated.timing(scaleAnim, {
          toValue: STACK_SCALE[stackPosition],
          duration: ANIMATION_DURATION,
          easing: ANIMATION_EASING,
          useNativeDriver: true,
        }),
        Animated.timing(stackOffsetYAnim, {
          toValue: STACK_TRANSLATE_Y[stackPosition],
          duration: ANIMATION_DURATION,
          easing: ANIMATION_EASING,
          useNativeDriver: true,
        }),
      ]),
    ]).start();
  }, [stackPosition, scaleAnim, stackOffsetYAnim]);

  useEffect(() => {
    if (stackPosition !== 0) return;

    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      onStartExit?.(id);
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: -SLIDE_OFFSET,
          duration: ANIMATION_DURATION,
          easing: ANIMATION_EASING,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0,
          duration: ANIMATION_DURATION,
          easing: ANIMATION_EASING,
          useNativeDriver: true,
        }),
      ]).start(() => {
        onDismiss(id);
      });
    }, durationMs);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [stackPosition, id, durationMs, translateY, opacity, onStartExit, onDismiss]);

  const variantStyle = variantStyles[variant];

  return (
    <Animated.View
      style={[
        itemStyles.stackWrapper,
        {
          zIndex,
          transform: [{ scale: scaleAnim }, { translateY: stackOffsetYAnim }],
          pointerEvents: 'auto',
        },
      ]}
    >
      <Animated.View
        style={[
          itemStyles.animatedInner,
          fullWidth && itemStyles.animatedInnerFullWidth,
          {
            transform: [{ translateY }],
            opacity,
          },
        ]}
      >
        <View
          className={`border ${variantStyle.container}`}
          style={[itemStyles.toast, fullWidth ? itemStyles.toastFullWidth : itemStyles.toastFixedWidth]}
        >
          <Text className={`font-instrument-medium ${variantStyle.text}`} style={itemStyles.toastText}>
            {message}
          </Text>
        </View>
      </Animated.View>
    </Animated.View>
  );
}

const itemStyles = StyleSheet.create({
  stackWrapper: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    width: '100%',
    alignItems: 'center',
  },
  animatedInner: {
    alignSelf: 'center',
  },
  animatedInnerFullWidth: {
    width: '100%',
  },
  toast: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  toastFixedWidth: {
    width: TOAST_BASE_WIDTH,
    maxWidth: '100%',
  },
  toastFullWidth: {
    width: '100%',
  },
  toastText: {
    fontSize: 14,
  },
});

interface ToastProviderProps {
  children: React.ReactNode;
}

export function ToastProvider({ children }: ToastProviderProps) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [exitingId, setExitingId] = useState<string | null>(null);

  const removeToast = useCallback((id: string) => {
    setExitingId((prev) => (prev === id ? null : prev));
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const onStartExit = useCallback((id: string) => {
    setExitingId(id);
  }, []);

  const show = useCallback((message: string, variant: ToastVariant) => {
    const id = generateToastId();
    setToasts((prev) => [...prev, { id, message, variant }]);
  }, []);

  const toast = {
    success: useCallback((message: string) => show(message, 'success'), [show]),
    error: useCallback((message: string) => show(message, 'error'), [show]),
    warning: useCallback((message: string) => show(message, 'warning'), [show]),
    info: useCallback((message: string) => show(message, 'info'), [show]),
    notification: useCallback((message: string) => show(message, 'notification'), [show]),
  };

  const value: ToastContextValue = { toast };
  const isMobile = width < LAYOUT_BREAKPOINT;

  /** Overlay sits outside the padded root View in _layout; align with safe area + gap below notch/status bar. */
  const topGap = 12;
  const topInset =
    Platform.OS === 'web'
      ? Math.max(24, insets.top + topGap)
      : insets.top + topGap;

  const displayToasts = toasts;
  const visibleWhenExiting = exitingId ? toasts.filter((t) => t.id !== exitingId) : null;

  return (
    <ToastContext.Provider value={value}>
      {children}
      <View style={[styles.overlay, { top: topInset, pointerEvents: 'none' }]}>
        <View
          style={[
            styles.stackContainer,
            isMobile ? styles.stackContainerMobile : styles.stackContainerDesktop,
            { pointerEvents: 'box-none' },
          ]}
        >
          {displayToasts.map((item, index) => {
            const isExiting = item.id === exitingId;
            const visualIndex = visibleWhenExiting
              ? isExiting
                ? 0
                : visibleWhenExiting.findIndex((t) => t.id === item.id)
              : index;
            const stackPosition = Math.min(visualIndex, 2) as 0 | 1 | 2;
            const zIndex = isExiting ? 4 : visualIndex <= 2 ? STACK_Z_INDEX[visualIndex] : 0;
            return (
              <ToastItemComponent
                key={item.id}
                id={item.id}
                message={item.message}
                variant={item.variant}
                fullWidth={isMobile}
                stackPosition={stackPosition}
                zIndex={zIndex}
                onStartExit={onStartExit}
                onDismiss={removeToast}
                durationMs={TOAST_DURATION_MS}
              />
            );
          })}
        </View>
      </View>
    </ToastContext.Provider>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  stackContainer: {
    position: 'relative',
    minHeight: STACK_MIN_HEIGHT,
    width: '100%',
  },
  stackContainerDesktop: {
    maxWidth: TOAST_BASE_WIDTH + 32,
  },
  stackContainerMobile: {
    maxWidth: '100%',
  },
});
