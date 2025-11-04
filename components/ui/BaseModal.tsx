import { Modal, Pressable, View, Text, TouchableOpacity } from 'react-native';
import { XMarkIcon } from 'react-native-heroicons/outline';

interface BaseModalProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl';
}

const maxWidthClasses = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
};

export function BaseModal({
  visible,
  onClose,
  title,
  description,
  children,
  footer,
  maxWidth = 'md',
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
        <Pressable
          style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}
          onPress={(e) => e.stopPropagation()}
        >
          <View className={`bg-[#1A1A1A] rounded-2xl border border-[#2A2A2A] w-full ${maxWidthClasses[maxWidth]}`}>
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

            {/* Content */}
            <View className="p-6">
              {children}
            </View>

            {/* Footer */}
            {footer && (
              <View className="px-6 pb-6 border-t border-[#2A2A2A] pt-6">
                {footer}
              </View>
            )}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

