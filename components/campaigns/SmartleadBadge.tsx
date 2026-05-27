import { Alert, Image, Platform, Pressable, Text, View } from 'react-native';
import { Tooltip, type TooltipPlacement } from '@/components/ui/Tooltip';

export const SMARTLEAD_IMPORT_TOOLTIP =
  'This was imported from Smartlead, it will have limited functionality and should be used mainly as a source for quick insights.';

const SMARTLEAD_BADGE_SOURCE =
  Platform.OS === 'web'
    ? { uri: '/smartlead_logo.png' }
    : require('../../public/smartlead_logo.png');

function SmartleadTooltipBody() {
  return (
    <Text className="text-gray-300 font-instrument text-xs leading-5" style={{ maxWidth: 280 }}>
      {SMARTLEAD_IMPORT_TOOLTIP}
    </Text>
  );
}

export interface SmartleadBadgeProps {
  size?: number;
  placement?: TooltipPlacement;
}

export function SmartleadBadge({ size = 20, placement = 'top' }: SmartleadBadgeProps) {
  const image = (
    <Image
      source={SMARTLEAD_BADGE_SOURCE}
      style={{ width: size, height: size, borderRadius: 6 }}
      resizeMode="cover"
      accessibilityLabel="Smartlead"
    />
  );

  if (Platform.OS === 'web') {
    return (
      <Tooltip content={<SmartleadTooltipBody />} placement={placement}>
        <View className="shrink-0">{image}</View>
      </Tooltip>
    );
  }

  return (
    <Pressable
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={`Smartlead — ${SMARTLEAD_IMPORT_TOOLTIP}`}
      onPress={() => Alert.alert('Imported from Smartlead', SMARTLEAD_IMPORT_TOOLTIP)}
      className="shrink-0"
    >
      {image}
    </Pressable>
  );
}
