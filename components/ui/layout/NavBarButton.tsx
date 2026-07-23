import React from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { IconBadgeAnchor } from '@/components/ui/CountBadge';
import { OpenConversationCountLabel } from '@/components/inbox/OpenConversationCountLabel';

const NAV_ICON_SIZE = 20;

const BRAND_ORANGE = '#F3440D';
const ACTIVE_BG = 'rgba(243,68,13,0.15)';
const HOVER_BG = 'rgba(255,255,255,0.06)';
const isWeb = Platform.OS === 'web';

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
  const [hovered, setHovered] = React.useState(false);
  const showOverlayBadge = badgeCount > 0 && (!isExpanded || badgeLayout === 'overlay');
  const showTrailingBadge = badgeCount > 0 && isExpanded && badgeLayout === 'trailing';

  const iconColor = isPrimary || active ? '#ffffff' : '#D1D5DB';

  const iconContent = showOverlayBadge ? (
    <IconBadgeAnchor count={badgeCount} iconSize={NAV_ICON_SIZE} ringColor="#1A1A1A">
      <Icon size={NAV_ICON_SIZE} color={iconColor} />
    </IconBadgeAnchor>
  ) : (
    <Icon size={NAV_ICON_SIZE} color={iconColor} />
  );

  // Modern flat treatment: transparent by default, subtle hover fill, keep the
  // orange active/primary emphasis. No permanent "card" background or border.
  const backgroundColor = isPrimary
    ? BRAND_ORANGE
    : active
      ? ACTIVE_BG
      : isWeb && hovered
        ? HOVER_BG
        : 'transparent';

  return (
    <Pressable
      ref={ref}
      onPress={onPress}
      collapsable={isWeb ? undefined : false}
      onHoverIn={isWeb ? () => setHovered(true) : undefined}
      onHoverOut={isWeb ? () => setHovered(false) : undefined}
      className={`h-9 rounded-lg ${isExpanded ? 'px-2' : 'px-0'}`}
      style={{ backgroundColor }}
    >
      <View
        className={`h-full flex-row items-center ${isExpanded ? 'w-full' : 'justify-center'}`}
        style={{ minWidth: 0 }}
      >
        <View className={isExpanded ? 'mr-3' : undefined}>{iconContent}</View>
        {isExpanded ? (
          <>
            <Text
              className={`font-instrument text-sm ${
                isPrimary || active ? 'text-white' : 'text-gray-300'
              }`}
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
