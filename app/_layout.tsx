import { Slot } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts, InstrumentSans_400Regular, InstrumentSans_500Medium, InstrumentSans_600SemiBold, InstrumentSans_700Bold, InstrumentSans_400Regular_Italic, InstrumentSans_500Medium_Italic, InstrumentSans_600SemiBold_Italic, InstrumentSans_700Bold_Italic } from '@expo-google-fonts/instrument-sans';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { Authenticator } from '@aws-amplify/ui-react-native';
import { ToastProvider } from '@/components/ui/feedback';

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
    <Authenticator.Provider>
      <ToastProvider>
        <StatusBar style="auto" />
        <Slot />
      </ToastProvider>
    </Authenticator.Provider>
  );
}

