import { Image, Platform, View } from 'react-native';
import { BootSpinner } from '@/components/ui/BootSpinner';
import { Logo } from '@/components/ui/branding/Logo';

/** Wordmark max width 300 → 75px tall; stack height matches `public/index.html`. */
const BOOT_WORDMARK_H = 75;
const BOOT_SPINNER_GAP = 28;
const BOOT_SPINNER_H = 36;
const BOOT_STACK_H = BOOT_WORDMARK_H + BOOT_SPINNER_GAP + BOOT_SPINNER_H;
const BOOT_STACK_HALF = BOOT_STACK_H / 2;

/** Full-screen boot UI: same wordmark as PWA splash (Logo_Color.svg) on #121212 while fonts or session resolve. */
export function AppBootScreen() {
  return (
    <View
      className="flex-1 bg-[#121212]"
      style={{ position: 'relative' }}
      accessibilityLabel="Loading Furnace"
    >
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: '50%',
          alignItems: 'center',
          transform: [{ translateY: -BOOT_STACK_HALF }],
        }}
      >
        <View
          style={{
            width: '100%',
            maxWidth: 300,
            height: BOOT_STACK_H,
            alignItems: 'center',
          }}
        >
          <View style={{ height: BOOT_WORDMARK_H, width: '100%', alignItems: 'center' }}>
            {Platform.OS === 'web' ? (
              <Image
                source={{ uri: '/Logo_Color.svg' }}
                style={{ width: '100%', maxWidth: 300, height: BOOT_WORDMARK_H }}
                resizeMode="contain"
                accessible={false}
              />
            ) : (
              <Logo className="items-center" />
            )}
          </View>
          <View
            style={{
              marginTop: BOOT_SPINNER_GAP,
              height: BOOT_SPINNER_H,
              width: BOOT_SPINNER_H,
              minWidth: BOOT_SPINNER_H,
              minHeight: BOOT_SPINNER_H,
              flexShrink: 0,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <BootSpinner />
          </View>
        </View>
      </View>
    </View>
  );
}
