import { useEffect } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useRouter } from 'expo-router';

interface CompleteStepProps {
  campaignId: string;
}

export function CompleteStep({ campaignId }: CompleteStepProps) {
  const router = useRouter();

  useEffect(() => {
    // Navigate to the campaign view after a short delay
    const timer = setTimeout(() => {
      router.push(`/test/campaign-flow/${campaignId}` as any);
    }, 1500);

    return () => clearTimeout(timer);
  }, [campaignId, router]);

  return (
    <View>
      <View className="bg-green-900/20 border border-green-800 rounded-xl p-6 mb-4">
        <View className="flex-row items-center gap-2 mb-3">
          <Text className="text-2xl">✅</Text>
          <Text className="text-green-400 font-instrument-semibold text-lg">
            Test Campaign Created Successfully!
          </Text>
        </View>
        <Text className="text-gray-300 font-instrument text-sm mb-4">
          Your test campaign has been created and is ready to run. Redirecting to campaign view...
        </Text>
        <Pressable
          onPress={() => router.push(`/test/campaign-flow/${campaignId}` as any)}
          className="bg-brand-orange rounded-lg px-4 py-2 self-start"
          style={{ backgroundColor: '#f85102' }}
          accessibilityRole="button"
          accessibilityLabel="View campaign"
        >
          <Text className="text-white font-instrument-semibold text-sm">
            View Campaign →
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

