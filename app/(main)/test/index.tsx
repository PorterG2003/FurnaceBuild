import { View, Text, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { PageLayout } from '@/components/ui/layout';
import { EnvelopeIcon, ArrowsRightLeftIcon, ListBulletIcon, PaintBrushIcon, ArrowPathIcon } from 'react-native-heroicons/outline';

interface Test {
  id: string;
  name: string;
  description: string;
  route: string;
  icon: React.ReactNode;
  category: 'workers' | 'integration';
}

const tests: Test[] = [
  {
    id: 'send-worker',
    name: 'Send Worker Test',
    description: 'Test the ECS send worker by creating message jobs in the database. Workers will pick them up automatically via database polling. Supports single and scale testing.',
    route: '/test/worker',
    icon: <EnvelopeIcon size={24} color="#f85102" />,
    category: 'workers',
  },
  {
    id: 'campaign-flow',
    name: 'Campaign Flow Test',
    description: 'Test full campaign flows end-to-end. Create campaigns, enroll leads, and verify the complete flow execution with a clean interface.',
    route: '/test/campaign-flow',
    icon: <ArrowsRightLeftIcon size={24} color="#f85102" />,
    category: 'integration',
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

      {/* UI Tests Section */}
      <View className="mb-6">
        <Pressable
          onPress={() => router.push('/test/ui' as any)}
          className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-6 active:opacity-80 mb-4"
          accessibilityRole="button"
          accessibilityLabel="UI test playground"
        >
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-4 flex-1">
              <View className="bg-brand-orange/20 p-3 rounded-lg">
                <PaintBrushIcon size={24} color="#f85102" />
              </View>
              <View className="flex-1">
                <Text className="text-white font-instrument-semibold text-lg mb-1">
                  UI Test Playground
                </Text>
                <Text className="text-gray-400 font-instrument text-sm">
                  Test toasts and other UI components
                </Text>
              </View>
            </View>
            <Text className="text-gray-500 font-instrument text-2xl">→</Text>
          </View>
        </Pressable>
      </View>

      {/* Test Campaigns Section */}
      <View className="mb-6">
        <Pressable
          onPress={() => router.push('/test/campaigns' as any)}
          className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-6 active:opacity-80"
          accessibilityRole="button"
          accessibilityLabel="View test campaigns"
        >
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-4 flex-1">
              <View className="bg-brand-orange/20 p-3 rounded-lg">
                <ListBulletIcon size={24} color="#f85102" />
              </View>
              <View className="flex-1">
                <Text className="text-white font-instrument-semibold text-lg mb-1">
                  Test Campaigns
                </Text>
                <Text className="text-gray-400 font-instrument text-sm">
                  View and manage your test campaigns
                </Text>
              </View>
            </View>
            <Text className="text-gray-500 font-instrument text-2xl">→</Text>
          </View>
        </Pressable>
      </View>

      {/* Reconcile Stats Section */}
      <View className="mb-6">
        <Pressable
          onPress={() => router.push('/test/reconcile-stats' as any)}
          className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-6 active:opacity-80"
          accessibilityRole="button"
          accessibilityLabel="Reconcile campaign stats"
        >
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-4 flex-1">
              <View className="bg-brand-orange/20 p-3 rounded-lg">
                <ArrowPathIcon size={24} color="#f85102" />
              </View>
              <View className="flex-1">
                <Text className="text-white font-instrument-semibold text-lg mb-1">
                  Reconcile Campaign Stats
                </Text>
                <Text className="text-gray-400 font-instrument text-sm">
                  Recompute stats from source tables to fix list/detail drift
                </Text>
              </View>
            </View>
            <Text className="text-gray-500 font-instrument text-2xl">→</Text>
          </View>
        </Pressable>
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
                          : '#10b98120',
                    }}
                  >
                    <Text
                      className="text-xs font-instrument-semibold uppercase"
                      style={{
                      color:
                        test.category === 'workers'
                          ? '#3b82f6'
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
          Use them to test worker scaling and end-to-end email sending.
        </Text>
      </View>
    </PageLayout>
  );
}

