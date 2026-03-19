import React, { type ReactNode, useEffect, useRef, useState } from 'react';
import { Animated, Modal, Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const isWeb = Platform.OS === 'web';

export interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
}

const BACKDROP_OPACITY = 0.5;
const ANIMATION_DURATION = 250;

/**
 * Slide-up bottom sheet (modal). Use for mobile action sheets and option lists.
 * Backdrop fades in place; sheet slides up from the bottom. Backdrop tap closes.
 */
export function BottomSheet({ visible, onClose, children }: BottomSheetProps) {
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  // Modal stays visible until close animation completes (avoids flash when parent sets visible=false)
  const [isOpen, setIsOpen] = useState(visible);
  const prevVisibleRef = useRef(visible);
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const sheetTranslateY = useRef(new Animated.Value(screenHeight)).current;

  // Close animation: native driver on native, JS driver on web (for consistent close behavior)
  const useNative = !isWeb;

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

  const containerStyle = isWeb
    ? [
        styles.container,
        {
          position: 'fixed',
          left: 0,
          top: 0,
          right: 0,
          bottom: 0,
          width: '100vw',
          height: '100vh',
        } as Record<string, unknown>,
      ]
    : [styles.container, { width: screenWidth, height: screenHeight }];

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
          <View style={containerStyle as React.ComponentProps<typeof View>['style']}>
            <Animated.View
              style={[
                StyleSheet.absoluteFillObject,
                {
                  backgroundColor: `rgba(0, 0, 0, ${BACKDROP_OPACITY})`,
                  opacity: backdropOpacity,
                },
              ]}
            >
              <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />
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
            style={containerStyle as React.ComponentProps<typeof View>['style']}
            onPress={onClose}
          >
            <Animated.View
              style={[
                styles.sheet,
                {
                  paddingBottom: Math.max(insets.bottom, 16),
                  transform: [{ translateY: sheetTranslateY }],
                  minHeight: 120,
                },
              ]}
              onStartShouldSetResponder={() => true}
            >
              <View style={styles.dragHandle} />
              {children}
            </Animated.View>
          </Pressable>
        </Modal>
      </>
    );
  }

  return (
    <Modal visible={isOpen} transparent animationType="none" onRequestClose={onClose}>
      <View style={containerStyle as React.ComponentProps<typeof View>['style']}>
        <Animated.View
          style={[
            StyleSheet.absoluteFillObject,
            {
              backgroundColor: `rgba(0, 0, 0, ${BACKDROP_OPACITY})`,
              opacity: backdropOpacity,
            },
          ]}
        >
          <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />
        </Animated.View>
        <Animated.View
          style={[
            styles.sheet,
            {
              paddingBottom: Math.max(insets.bottom, 16),
              transform: [{ translateY: sheetTranslateY }],
              minHeight: 120,
            },
          ]}
          onStartShouldSetResponder={() => true}
        >
          <View style={styles.dragHandle} />
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  sheet: {
    backgroundColor: '#1A1A1A',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderColor: '#2A2A2A',
    paddingTop: 12,
    paddingHorizontal: 16,
  },
  dragHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#4B5563',
    alignSelf: 'center',
    marginBottom: 8,
  },
});
