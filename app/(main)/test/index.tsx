import { View, Text, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { PageLayout } from '@/components/ui/layout';
import { EnvelopeIcon, Cog6ToothIcon } from 'react-native-heroicons/outline';

interface Test {
  id: string;
  name: string;
  description: string;
  route: string;
  icon: React.ReactNode;
  category: 'workers' | 'scheduler' | 'integration';
}

const tests: Test[] = [
  {
    id: 'send-worker',
    name: 'Send Worker Test',
    description: 'Test the ECS send worker by creating message jobs and sending them to the SQS queue. Supports single and scale testing.',
    route: '/test/worker',
    icon: <EnvelopeIcon size={24} color="#f85102" />,
    category: 'workers',
  },
  {
    id: 'scheduler',
    name: 'Scheduler Test',
    description: 'Test the scheduler worker by creating test campaign flows and enrollments. Verify flow evaluation and message job creation.',
    route: '/test/scheduler',
    icon: <Cog6ToothIcon size={24} color="#f85102" />,
    category: 'scheduler',
  },
];

export default function TestIndexPage() {
  const router = useRouter();

  return (
    <PageLayout>
      {/* Header */}
      <View className="mb-6">
        <Text className="text-2xl font-instrument-semibold text-white mb-1">
          Testing Dashboard
        </Text>
        <Text className="text-gray-400 font-instrument text-sm">
          Test and verify different components of the system
        </Text>
      </View>

      {/* Tests Grid */}
      <View className="gap-4">
        {tests.map((test) => (
          <Pressable
            key={test.id}
            onPress={() => router.push(test.route as any)}
            className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-6 active:opacity-80"
          >
            <View className="flex-row items-start gap-4">
              <View className="mt-1">{test.icon}</View>
              <View className="flex-1">
                <Text className="text-white font-instrument-semibold text-lg mb-2">
                  {test.name}
                </Text>
                <Text className="text-gray-400 font-instrument text-sm leading-5">
                  {test.description}
                </Text>
                <View className="mt-3">
                  <View
                    className="self-start px-3 py-1 rounded-md"
                    style={{
                      backgroundColor:
                        test.category === 'workers'
                          ? '#3b82f620'
                          : test.category === 'scheduler'
                            ? '#8b5cf620'
                            : '#10b98120',
                    }}
                  >
                    <Text
                      className="text-xs font-instrument-semibold uppercase"
                      style={{
                        color:
                          test.category === 'workers'
                            ? '#3b82f6'
                            : test.category === 'scheduler'
                              ? '#8b5cf6'
                              : '#10b981',
                      }}
                    >
                      {test.category}
                    </Text>
                  </View>
                </View>
              </View>
              <View className="items-center justify-center">
                <Text className="text-gray-500 font-instrument text-2xl">→</Text>
              </View>
            </View>
          </Pressable>
        ))}
      </View>

      {/* Info Section */}
      <View className="mt-8 bg-blue-900/20 border border-blue-800 rounded-xl p-4">
        <Text className="text-blue-400 font-instrument-semibold text-sm mb-2">
          ℹ️ About Testing
        </Text>
        <Text className="text-gray-400 font-instrument text-sm leading-5">
          These test pages help verify that different components of the system are working correctly.
          Use them to test worker scaling, scheduler flow evaluation, and end-to-end email sending.
        </Text>
      </View>
    </PageLayout>
  );
}

