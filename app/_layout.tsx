import { Slot } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts, InstrumentSans_400Regular, InstrumentSans_500Medium, InstrumentSans_600SemiBold, InstrumentSans_700Bold, InstrumentSans_400Regular_Italic, InstrumentSans_500Medium_Italic, InstrumentSans_600SemiBold_Italic, InstrumentSans_700Bold_Italic } from '@expo-google-fonts/instrument-sans';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { ToastProvider } from '@/components/ui/feedback';
import { ConfirmProvider } from '@/components/ui/ConfirmContext';
import { AuthProvider } from '@/contexts/AuthContext';

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
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  // Render app even if fonts fail (avoids white screen on web)
  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <AuthProvider>
      <ToastProvider>
        <ConfirmProvider>
          <StatusBar style="auto" />
          <Slot />
        </ConfirmProvider>
      </ToastProvider>
    </AuthProvider>
  );
}

