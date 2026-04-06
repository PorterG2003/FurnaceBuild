import { ActivityIndicator, Image, Platform, View } from 'react-native';

const LOGO_SOURCE =
  Platform.OS === 'web'
    ? ({ uri: '/icon512_rounded.png' } as const)
    : (require('../../assets/icon.png') as number);

/** Full-screen boot UI: matches PWA splash (#121212 + mark) while fonts or session resolve. */
export function AppBootScreen() {
  return (
    <View
      className="flex-1 items-center justify-center bg-[#121212]"
      accessibilityLabel="Loading Furnace"
    >
      <Image source={LOGO_SOURCE} style={{ width: 112, height: 112 }} resizeMode="contain" />
      <ActivityIndicator size="large" color="#F3440D" style={{ marginTop: 28 }} />
    </View>
  );
}
