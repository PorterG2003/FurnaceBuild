import { useEffect, useRef } from 'react';
import { Modal, Pressable, View, Text, ScrollView, useWindowDimensions } from 'react-native';
import { XMarkIcon } from 'react-native-heroicons/outline';
import { BottomSheet } from './BottomSheet';
import { LAYOUT_BREAKPOINT } from '@/components/ui/layout/constants';
import { useVisualViewportKeyboardInset } from '@/hooks/useVisualViewportKeyboardInset';

const isWeb = typeof window !== 'undefined';

interface BaseModalProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  /** On mobile (sheet), use this footer instead of footer when set. Use to omit Cancel and show only primary action(s). */
  footerMobile?: React.ReactNode;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | 'full';
  maxHeight?: number;
  /** When set, modal has a fixed height (min and max). Use with maxHeight for consistent size. */
  height?: number;
  /** When true, omits the content area. Use for modals with only title, description, and footer. */
  compact?: boolean;
}

const maxWidthClasses = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '3xl': 'max-w-3xl',
  '4xl': 'max-w-4xl',
  full: 'max-w-[95vw]',
};

export function BaseModal({
  visible,
  onClose,
  title,
  description,
  children,
  footer,
  footerMobile,
  maxWidth = 'md',
  maxHeight,
  height,
  compact = false,
}: BaseModalProps) {
  const { width, height: screenHeight } = useWindowDimensions();
  const isMobile = width < LAYOUT_BREAKPOINT;
  /** Explicit `height` opts into a stretched inner layout (legacy). `maxHeight` alone only caps total height. */
  const stretchContent = height != null;
  const dialogMaxHeight =
    maxHeight != null
      ? Math.min(maxHeight, Math.round(screenHeight * 0.92) - 40)
      : height != null
        ? Math.min(height, Math.round(screenHeight * 0.92) - 40)
        : undefined;
  const containerStyle =
    stretchContent && (height ?? maxHeight) != null
      ? { maxHeight: height ?? maxHeight, minHeight: height ?? 320 }
      : dialogMaxHeight != null
        ? { maxHeight: dialogMaxHeight }
        : {};
  /** Desktop modal: `maxHeight` without `height` — pin dialog height and flex the body so footer stays inside the frame. */
  const fillMaxHeightColumn =
    maxHeight != null && !stretchContent && !compact && dialogMaxHeight != null;
  const dialogRef = useRef<View>(null);
  const webKeyboardInset = useVisualViewportKeyboardInset();

  useEffect(() => {
    if (visible && isWeb && !isMobile && dialogRef.current) {
      const node = (dialogRef.current as any) as HTMLElement | undefined;
      if (node?.focus) {
        const t = setTimeout(() => node.focus(), 0);
        return () => clearTimeout(t);
      }
    }
  }, [visible, isMobile]);

  if (isMobile) {
    return (
      <BottomSheet visible={visible} onClose={onClose}>
        <View style={{ flex: 1, minHeight: 0 }}>
          <View className="border-b border-[#2A2A2A] pb-4 mb-4 flex-shrink-0">
            <View className="min-w-0">
              <Text className="text-xl font-instrument-semibold text-white" numberOfLines={2}>
                {title}
              </Text>
              {description ? (
                <Text className="text-gray-400 font-instrument text-sm mt-1" numberOfLines={3}>
                  {description}
                </Text>
              ) : null}
            </View>
          </View>
          {!compact && (
            <ScrollView
              style={{ flex: 1, minHeight: 0 }}
              contentContainerStyle={{
                paddingBottom: ((footerMobile ?? footer) ? 12 : 0) + (webKeyboardInset > 0 ? webKeyboardInset : 0),
                flexGrow: 1,
              }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator
              nestedScrollEnabled
            >
              {children}
            </ScrollView>
          )}
          {(footerMobile ?? footer) ? (
            <View className="pt-4 border-t border-[#2A2A2A] mt-4 flex-shrink-0">
              {footerMobile ?? footer}
            </View>
          ) : null}
        </View>
      </BottomSheet>
    );
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable
        style={{ flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.7)' }}
        onPress={onClose}
      >
        <View
          style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20, pointerEvents: 'box-none' }}
        >
          <Pressable
            ref={dialogRef}
            onPress={(e) => e.stopPropagation()}
            style={{ alignSelf: 'stretch', alignItems: 'center' }}
            {...(isWeb ? { tabIndex: -1 } : {})}
          >
            <View
              className={`bg-[#1A1A1A] rounded-2xl border border-[#2A2A2A] w-full ${maxWidthClasses[maxWidth]}`}
              style={[
                containerStyle,
                fillMaxHeightColumn
                  ? {
                      height: dialogMaxHeight,
                      flexDirection: 'column',
                      overflow: 'hidden',
                    }
                  : null,
              ]}
            >
            {/* Header */}
            <View
              className="flex-row items-start justify-between p-6 border-b border-[#2A2A2A]"
              style={fillMaxHeightColumn ? { flexShrink: 0 } : undefined}
            >
              <View className="flex-1 mr-4">
                <Text className="text-2xl font-instrument-semibold mb-2 text-white">
                  {title}
                </Text>
                {description && (
                  <Text className="text-gray-400 font-instrument text-sm">
                    {description}
                  </Text>
                )}
              </View>
              <Pressable
                onPress={onClose}
                className="p-2 rounded-lg border border-[#3A3A3A] bg-[#2A2A2A]"
              >
                <XMarkIcon size={20} color="#9CA3AF" />
              </Pressable>
            </View>

            {/* Content - omitted when compact (title + description + footer only) */}
            {!compact && (
              <View
                className="p-6"
                style={
                  stretchContent && dialogMaxHeight != null
                    ? { flexGrow: 1, flexShrink: 1, minHeight: 0 }
                    : fillMaxHeightColumn
                      ? { flexGrow: 1, flexShrink: 1, minHeight: 0 }
                      : undefined
                }
              >
                {maxHeight != null && !stretchContent ? (
                  <ScrollView
                    style={{ flex: 1 }}
                    contentContainerStyle={{ paddingBottom: footer ? 12 : 0, flexGrow: 0 }}
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator
                  >
                    {children}
                  </ScrollView>
                ) : stretchContent && dialogMaxHeight != null ? (
                  <ScrollView
                    style={{ flex: 1 }}
                    contentContainerStyle={{ paddingBottom: footer ? 12 : 0 }}
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator
                  >
                    {children}
                  </ScrollView>
                ) : (
                  children
                )}
              </View>
            )}

            {/* Footer */}
            {footer && (
              <View
                className={`px-6 pb-6 pt-6 ${!compact ? 'border-t border-[#2A2A2A]' : ''}`}
                style={fillMaxHeightColumn ? { flexShrink: 0 } : undefined}
              >
                {footer}
              </View>
            )}
          </View>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

