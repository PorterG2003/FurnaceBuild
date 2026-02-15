import { Modal, Pressable, View, Text, ScrollView } from 'react-native';
import { XMarkIcon } from 'react-native-heroicons/outline';

interface BaseModalProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl';
  maxHeight?: number;
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
};

export function BaseModal({
  visible,
  onClose,
  title,
  description,
  children,
  footer,
  maxWidth = 'md',
  maxHeight,
  compact = false,
}: BaseModalProps) {
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
          style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}
          pointerEvents="box-none"
        >
          <Pressable onPress={(e) => e.stopPropagation()} style={{ alignSelf: 'stretch', alignItems: 'center' }}>
            <View
              className={`bg-[#1A1A1A] rounded-2xl border border-[#2A2A2A] w-full ${maxWidthClasses[maxWidth]}`}
              style={maxHeight ? { maxHeight, minHeight: 320 } : {}}
            >
            {/* Header */}
            <View className="flex-row items-start justify-between p-6 border-b border-[#2A2A2A]">
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
                style={maxHeight ? { flexGrow: 1, flexShrink: 1, minHeight: 0 } : undefined}
              >
                {maxHeight ? (
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
              <View className={`px-6 pb-6 pt-6 ${!compact ? 'border-t border-[#2A2A2A]' : ''}`}>
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

