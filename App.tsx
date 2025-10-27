import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { Button } from '@/components/ui/button';

export default function App() {
  return (
    <View className="flex-1 bg-white items-center justify-center gap-4">
      <Button onPress={() => console.log('Primary pressed')}>
        Primary Button
      </Button>
      <Button variant="secondary" onPress={() => console.log('Secondary pressed')}>
        Secondary Button
      </Button>
      <Button variant="outline" onPress={() => console.log('Outline pressed')}>
        Outline Button
      </Button>
      <StatusBar style="auto" />
    </View>
  );
}
