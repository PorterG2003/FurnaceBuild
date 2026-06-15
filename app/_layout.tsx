import { Slot, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts, InstrumentSans_400Regular, InstrumentSans_500Medium, InstrumentSans_600SemiBold, InstrumentSans_700Bold, InstrumentSans_400Regular_Italic, InstrumentSans_500Medium_Italic, InstrumentSans_600SemiBold_Italic, InstrumentSans_700Bold_Italic } from '@expo-google-fonts/instrument-sans';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AppBootScreen } from '@/components/ui/AppBootScreen';
import { FeedbackProvider } from '@/components/ui/feedback';
import { AuthProvider } from '@/contexts/AuthContext';
import { AccountProvider } from '@/contexts/AccountContext';
import { WebInstallGate } from '@/components/web/WebInstallGate';
import { isFluxPublicLandingRoute } from '@/lib/web/installGate';

const MIN_BOOT_MS = 350;
const MAX_FONT_BOOT_MS = 3000;

// Suppress pointerEvents deprecation from react-native-web (triggered by @react-navigation)
if (typeof console !== 'undefined' && console.warn) {
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    const msg = typeof args[0] === 'string' ? args[0] : String(args[0] ?? '');
    if (msg.includes('pointerEvents') && msg.includes('deprecated')) return;
    originalWarn.apply(console, args);
  };
}

// Keep the splash screen visible while we fetch resources
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const pathname = usePathname();
  const skipAppBoot = useMemo(() => {
    if (isFluxPublicLandingRoute(pathname)) return true;
    if (typeof window !== 'undefined' && isFluxPublicLandingRoute(window.location.pathname)) {
      return true;
    }
    return false;
  }, [pathname]);

  const [minBootElapsed, setMinBootElapsed] = useState(false);
  const [fontBootTimedOut, setFontBootTimedOut] = useState(false);
  const [fontsLoaded, fontError] = useFonts({
    InstrumentSans_400Regular,
    InstrumentSans_500Medium,
    InstrumentSans_600SemiBold,
    InstrumentSans_700Bold,
    InstrumentSans_400Regular_Italic,
    InstrumentSans_500Medium_Italic,
    InstrumentSans_600SemiBold_Italic,
    InstrumentSans_700Bold_Italic,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (skipAppBoot) return;
    const timer = setTimeout(() => setMinBootElapsed(true), MIN_BOOT_MS);
    const fontTimer = setTimeout(() => setFontBootTimedOut(true), MAX_FONT_BOOT_MS);
    return () => {
      clearTimeout(timer);
      clearTimeout(fontTimer);
    };
  }, [skipAppBoot]);

  useEffect(() => {
    if (skipAppBoot) {
      void SplashScreen.hideAsync();
      return;
    }
    if ((fontsLoaded || fontError) && minBootElapsed) {
      void SplashScreen.hideAsync();
    }
  }, [skipAppBoot, fontsLoaded, fontError, minBootElapsed]);

  const bootComplete =
    skipAppBoot || (minBootElapsed && (fontsLoaded || !!fontError || fontBootTimedOut));

  const safeAreaRootStyle = {
    flex: 1,
    backgroundColor: skipAppBoot ? '#ffffff' : '#121212',
    paddingTop: 'env(safe-area-inset-top, 0px)' as unknown as number,
  };

  // Render app even if fonts fail (avoids white screen on web)
  if (!bootComplete) {
    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View style={safeAreaRootStyle} testID="safe-area-root">
          <AppBootScreen />
        </View>
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <AccountProvider>
          <FeedbackProvider>
            <View style={safeAreaRootStyle} testID="safe-area-root">
              <StatusBar style="auto" />
              <WebInstallGate />
              <Slot />
            </View>
          </FeedbackProvider>
        </AccountProvider>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}

