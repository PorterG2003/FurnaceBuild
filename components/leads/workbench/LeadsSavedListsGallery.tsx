import { View, Text, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/feedback';
import { LAYOUT_BREAKPOINT } from '@/components/ui/layout';
import { formatFluxListDate } from '@/lib/flux/formatFluxListDate';
import type { SavedLeadListSummary } from '@/lib/supabase/services/leads/saved-lists';

function LeadCountStat({ count, isMobile }: { count: number; isMobile: boolean }) {
  const statWidth = isMobile ? 48 : 56;
  return (
    <View className="items-center" style={{ minWidth: statWidth }}>
      <Text
        className="text-white font-instrument-semibold text-center"
        style={{ fontSize: isMobile ? 24 : 28, lineHeight: isMobile ? 28 : 32 }}
      >
        {count.toLocaleString('en-US')}
      </Text>
      <Text className="text-gray-500 font-instrument text-xs mt-0.5 text-center">Leads</Text>
    </View>
  );
}

function SavedListCard({
  list,
  leadCount,
  isMobile,
  onPress,
}: {
  list: SavedLeadListSummary;
  leadCount: number;
  isMobile: boolean;
  onPress: () => void;
}) {
  return (
    <Card variant="card" onPress={onPress}>
      <View className="flex-row gap-3 items-start">
        <View className="mt-0.5">
          <LeadCountStat count={leadCount} isMobile={isMobile} />
        </View>
        <View className="flex-1 min-w-0">
          <Text
            className={`text-white font-instrument-semibold ${isMobile ? 'text-base' : 'text-lg'}`}
            numberOfLines={2}
          >
            {list.name}
          </Text>
          {list.description ? (
            <Text
              className="text-gray-400 font-instrument text-sm mt-1"
              numberOfLines={2}
            >
              {list.description}
            </Text>
          ) : null}
          <Text className={`text-gray-500 font-instrument mt-1 ${isMobile ? 'text-xs' : 'text-sm'}`}>
            Updated {formatFluxListDate(list.updatedAt)}
          </Text>
        </View>
      </View>
    </Card>
  );
}

export function LeadsSavedListsGallery({
  lists,
  onCreateList,
  allowCreateList = true,
}: {
  lists: SavedLeadListSummary[];
  onCreateList: () => void;
  allowCreateList?: boolean;
}) {
  const router = useRouter();
  const { width: screenWidth } = useWindowDimensions();
  const isMobile = screenWidth < LAYOUT_BREAKPOINT;

  if (lists.length === 0) {
    return (
      <EmptyState
        title="No lists yet"
        description={
          allowCreateList
            ? 'Create a list from the explorer or import a CSV on desktop.'
            : 'Lists created from the explorer or CSV import will appear here.'
        }
        actionText={allowCreateList ? 'Create list' : undefined}
        onAction={allowCreateList ? onCreateList : undefined}
      />
    );
  }

  return (
    <View className="gap-3">
      {lists.map((list) => (
        <SavedListCard
          key={list.id}
          list={list}
          leadCount={list.leadCount}
          isMobile={isMobile}
          onPress={() => router.push(`/leads/lists/${list.id}`)}
        />
      ))}
    </View>
  );
}
