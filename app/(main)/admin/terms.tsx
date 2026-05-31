import { View, useWindowDimensions } from 'react-native';
import { Alert, LoadingState } from '@/components/ui/feedback';
import { Breadcrumb, LAYOUT_BREAKPOINT, PageHeader, PageLayout } from '@/components/ui/layout';
import { PlatformTermsManager } from '@/components/admin/account-management/PlatformTermsManager';
import { usePlatformAdminAccess } from '@/hooks/usePlatformAdminAccess';

export default function TermsPage() {
  const access = usePlatformAdminAccess();
  const { width } = useWindowDimensions();
  const isMobile = width < LAYOUT_BREAKPOINT;

  if (access === 'loading') {
    return (
      <PageLayout>
        <LoadingState message="Loading platform terms..." />
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
      {!isMobile ? (
        <View className="mb-4">
          <Breadcrumb items={[{ label: 'Admin', href: '/admin' }, { label: 'Platform Terms' }]} />
        </View>
      ) : null}
      <PageHeader
        title="Platform Terms"
        subtitle="Manage the current agreement templates used during admin-led onboarding."
      />
      <PlatformTermsManager />
    </PageLayout>
  );
}
