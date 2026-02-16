import { View, Text, ScrollView } from 'react-native';
import { PageLayout } from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/feedback';

export default function UITestPage() {
  const { toast } = useToast();

  return (
    <PageLayout>
      <View className="mb-6">
        <Text className="text-2xl font-instrument-semibold text-white mb-1">
          UI Test Playground
        </Text>
        <Text className="text-gray-400 font-instrument text-sm">
          Test UI components and interactions
        </Text>
      </View>

      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        {/* Toast testers */}
        <View className="mb-8">
          <Text className="text-lg font-instrument-semibold text-white mb-3">
            Toasts
          </Text>
          <View className="gap-3">
            <Button
              onPress={() => toast.success('Something went right!')}
              variant="default"
              className="bg-green-600 border-0"
            >
              Success toast
            </Button>
            <Button
              onPress={() => toast.error('Something went wrong.')}
              variant="default"
              className="bg-red-600 border-0"
            >
              Error toast
            </Button>
            <Button
              onPress={() => toast.warning('Heads up — check this.')}
              variant="default"
              className="bg-amber-600 border-0"
            >
              Warning toast
            </Button>
            <Button
              onPress={() => toast.info('Here’s some information.')}
              variant="default"
              className="bg-blue-600 border-0"
            >
              Info toast
            </Button>
            <Button
              onPress={() => {
                toast.success('First toast');
                setTimeout(() => toast.info('Second toast'), 400);
                setTimeout(() => toast.warning('Third toast'), 800);
              }}
              variant="default"
              className="bg-white/10 border border-white/20"
            >
              Stack 3 toasts
            </Button>
          </View>
        </View>
      </ScrollView>
    </PageLayout>
  );
}
