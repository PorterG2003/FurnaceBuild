import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '@/components/ui/button';
import { AdminCollapsibleCard } from '@/components/platform/admin/AdminCollapsibleCard';
import { StatusBadge } from '@/components/platform/admin/shared';
import { isPendingAmendmentStatus } from '@/lib/platform/amendment/acceptFlow';
import type { PlatformAccountAmendment } from '@/lib/supabase/services/platform';

type PlatformAccountAmendmentsSectionProps = {
  accountId: string;
  amendments: PlatformAccountAmendment[];
  expanded: boolean;
  onToggle: () => void;
  savingAction?: boolean;
  onCancelAmendment: (amendmentId: string) => void;
  formatTimestamp: (value: string | null) => string;
};

export function PlatformAccountAmendmentsSection({
  accountId,
  amendments,
  expanded,
  onToggle,
  savingAction,
  onCancelAmendment,
  formatTimestamp,
}: PlatformAccountAmendmentsSectionProps) {
  const router = useRouter();
  const activeCount = amendments.filter((a) => a.status === 'draft' || isPendingAmendmentStatus(a.status)).length;

  return (
    <AdminCollapsibleCard
      title="Amendments"
      expanded={expanded}
      onToggle={onToggle}
      summary={
        <Text className="text-gray-400 font-instrument text-sm text-right">
          {amendments.length} total{activeCount > 0 ? ` • ${activeCount} open` : ''}
        </Text>
      }
    >
      {amendments.length === 0 ? (
        <Text className="text-gray-400 font-instrument">No amendments yet.</Text>
      ) : (
        <View className="gap-3">
          {amendments.map((amendment) => (
            <View
              key={amendment.id}
              className="rounded-xl border border-[#2A2A2A] bg-[#121212] p-4"
            >
              <View className="flex-row flex-wrap items-center justify-between gap-2">
                <StatusBadge status={amendment.status} label={amendment.status.replace(/_/g, ' ')} />
                <Text className="text-gray-500 font-instrument text-xs">
                  v{amendment.current_revision_number}
                  {amendment.published_revision_number != null
                    ? ` • published v${amendment.published_revision_number}`
                    : ''}
                </Text>
              </View>
              <Text className="text-gray-400 font-instrument text-sm mt-2">
                Updated {formatTimestamp(amendment.updated_at)}
              </Text>
              <View className="flex-row flex-wrap gap-2 mt-3">
                {amendment.status === 'draft' ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onPress={() =>
                      router.push({
                        pathname: '/admin/accounts/sign-account-amendment',
                        params: { accountId, amendmentId: amendment.id },
                      })
                    }
                  >
                    Resume
                  </Button>
                ) : null}
                {amendment.status === 'draft' || isPendingAmendmentStatus(amendment.status) ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={savingAction}
                    onPress={() => onCancelAmendment(amendment.id)}
                  >
                    Cancel
                  </Button>
                ) : null}
              </View>
            </View>
          ))}
        </View>
      )}
    </AdminCollapsibleCard>
  );
}
