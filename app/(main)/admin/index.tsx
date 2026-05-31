import { Pressable, Text, View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { PageLayout, PageHeader, LAYOUT_BREAKPOINT } from '@/components/ui/layout';
import { Alert, LoadingState } from '@/components/ui/feedback';
import { usePlatformAdminAccess } from '@/hooks/usePlatformAdminAccess';

const adminCards = [
  {
    title: 'Account Management',
    description: 'Manage draft proposals, live invites, account billing, and client onboarding from one place.',
    href: '/admin/accounts',
  },
  {
    title: 'Platform Terms',
    description: 'Review, add, and change the default terms versions used for new client proposals.',
    href: '/admin/terms',
  },
];

export default function AdminDashboardPage() {
  const access = usePlatformAdminAccess();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isMobile = width < LAYOUT_BREAKPOINT;

  if (access === 'loading') {
    return (
      <PageLayout>
        <LoadingState message="Loading admin tools..." />
      </PageLayout>
    );
  }

  if (access !== 'allowed') {
    return (
      <PageLayout>
        <Alert variant="error" message="You do not have access to admin tools." />
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <PageHeader
        title="Admin Tools"
        subtitle="Run the full client onboarding pipeline from a single admin surface."
      />

      <View className={isMobile ? 'gap-4' : 'flex-row flex-wrap gap-4'}>
        {adminCards.map((card) => (
          <Pressable
            key={card.href}
            onPress={() => router.push(card.href)}
            className="rounded-2xl border border-[#2A2A2A] bg-[#181818] p-5 active:opacity-80"
            style={isMobile ? undefined : { width: '48%' }}
          >
            <Text className="text-xl font-instrument-semibold text-white mb-2">{card.title}</Text>
            <Text className="text-gray-400 font-instrument text-sm">{card.description}</Text>
          </Pressable>
        ))}
      </View>
    </PageLayout>
  );
}
