import React from 'react';
import { Pressable, Text, View } from 'react-native';

type NavBarButtonProps = {
  icon: React.ComponentType<{ size?: number; color?: string }>;
  label: string;
  onPress: () => void;
  isExpanded: boolean;
  active?: boolean;
  variant?: 'default' | 'primary';
};

export const NavBarButton = React.forwardRef<View, NavBarButtonProps>(function NavBarButton(
  {
    icon: Icon,
    label,
    onPress,
    isExpanded,
    active = false,
    variant = 'default',
  },
  ref,
) {
  const isPrimary = variant === 'primary';

  return (
    <Pressable
      ref={ref}
      onPress={onPress}
      collapsable={false}
      className={`py-2 rounded-lg border ${
        isExpanded ? 'px-2' : 'px-0'
      } ${
        isPrimary
          ? 'bg-brand-orange border-[rgba(248,81,2,0.3)]'
          : active
            ? 'bg-[rgba(243,68,13,0.15)] border-brand-orange'
            : 'bg-[rgba(42,42,42,0.6)] border-[#3A3A3A]'
      }`}
    >
      <View
        className={`flex-row items-center ${isExpanded ? '' : 'justify-center'}`}
        style={{ flexShrink: 0 }}
      >
        <View className={isExpanded ? 'mr-3' : ''}>
          <Icon size={20} color="#ffffff" />
        </View>
        {isExpanded ? (
          <Text
            className="text-white font-instrument text-sm"
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {label}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
});
