import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { IconBadgeAnchor } from '@/components/ui/CountBadge';
import { OpenConversationCountLabel } from '@/components/inbox/OpenConversationCountLabel';

const NAV_ICON_SIZE = 20;

type NavBarButtonProps = {
  icon: React.ComponentType<{ size?: number; color?: string }>;
  label: string;
  onPress: () => void;
  isExpanded: boolean;
  active?: boolean;
  variant?: 'default' | 'primary';
  badgeCount?: number;
  badgeLayout?: 'overlay' | 'trailing';
};

export const NavBarButton = React.forwardRef<View, NavBarButtonProps>(function NavBarButton(
  {
    icon: Icon,
    label,
    onPress,
    isExpanded,
    active = false,
    variant = 'default',
    badgeCount = 0,
    badgeLayout = 'overlay',
  },
  ref,
) {
  const isPrimary = variant === 'primary';
  const showOverlayBadge = badgeCount > 0 && (!isExpanded || badgeLayout === 'overlay');
  const showTrailingBadge = badgeCount > 0 && isExpanded && badgeLayout === 'trailing';

  const iconContent = showOverlayBadge ? (
    <IconBadgeAnchor count={badgeCount} iconSize={NAV_ICON_SIZE} ringColor="#1A1A1A">
      <Icon size={NAV_ICON_SIZE} color="#ffffff" />
    </IconBadgeAnchor>
  ) : (
    <Icon size={NAV_ICON_SIZE} color="#ffffff" />
  );

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
        className={`flex-row items-center ${isExpanded ? 'w-full' : 'justify-center'}`}
        style={{ minWidth: 0 }}
      >
        <View className={isExpanded ? 'mr-3' : undefined}>{iconContent}</View>
        {isExpanded ? (
          <>
            <Text
              className="text-white font-instrument text-sm"
              numberOfLines={1}
              ellipsizeMode="tail"
              style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 }}
            >
              {label}
            </Text>
            {showTrailingBadge ? <OpenConversationCountLabel count={badgeCount} /> : null}
          </>
        ) : null}
      </View>
    </Pressable>
  );
});
