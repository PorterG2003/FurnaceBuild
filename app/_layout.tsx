import { Slot } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts, InstrumentSans_400Regular, InstrumentSans_500Medium, InstrumentSans_600SemiBold, InstrumentSans_700Bold, InstrumentSans_400Regular_Italic, InstrumentSans_500Medium_Italic, InstrumentSans_600SemiBold_Italic, InstrumentSans_700Bold_Italic } from '@expo-google-fonts/instrument-sans';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { AppBootScreen } from '@/components/ui/AppBootScreen';
import { ToastProvider } from '@/components/ui/feedback';
import { ConfirmProvider } from '@/components/ui/ConfirmContext';
import { AuthProvider } from '@/contexts/AuthContext';
import { WebInstallGate } from '@/components/web/WebInstallGate';

const MIN_BOOT_MS = 350;

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
  const [minBootElapsed, setMinBootElapsed] = useState(false);
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
    const timer = setTimeout(() => setMinBootElapsed(true), MIN_BOOT_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if ((fontsLoaded || fontError) && minBootElapsed) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError, minBootElapsed]);

  const safeAreaRootStyle = {
    flex: 1,
    backgroundColor: '#121212',
    paddingTop: 'env(safe-area-inset-top, 0px)' as unknown as number,
  };

  // Render app even if fonts fail (avoids white screen on web)
  if (!minBootElapsed || (!fontsLoaded && !fontError)) {
    return (
      <View style={safeAreaRootStyle} testID="safe-area-root">
        <AppBootScreen />
      </View>
    );
  }

  return (
    <AuthProvider>
      <ToastProvider>
        <ConfirmProvider>
          <View style={safeAreaRootStyle} testID="safe-area-root">
            <StatusBar style="auto" />
            <WebInstallGate />
            <Slot />
          </View>
        </ConfirmProvider>
      </ToastProvider>
    </AuthProvider>
  );
}

