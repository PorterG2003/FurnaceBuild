import { useEffect, useMemo, useState } from 'react';
import { Text, View, useWindowDimensions } from 'react-native';
import { Alert, Skeleton } from '@/components/ui/feedback';
import { Card } from '@/components/ui/Card';
import { Tabs, type Tab } from '@/components/ui/tabs';
import { Select } from '@/components/ui/forms';
import { LAYOUT_BREAKPOINT } from '@/components/ui/layout/constants';
import { groupCopyStatsByKind, type CopyLeaderboardGroup } from '@/lib/metrics/copyLeaderboard';
import type { AccountCopyStats } from '@/lib/supabase/services/campaigns/account-copy-stats-rpc-map';
import { CopyPieceRow } from './CopyPieceRow';

const INTEGER_FORMATTER = new Intl.NumberFormat('en-US');

function LoadingSkeleton() {
  return (
    <View className="gap-4">
      {[1, 2, 3].map((i) => (
        <Card key={i} variant="card">
          <View className="flex-row items-center gap-4">
            <View className="flex-1 min-w-0">
              <Skeleton className="h-5 w-40" />
            </View>
            <View className="flex-row gap-6">
              {[1, 2, 3, 4, 5].map((j) => (
                <View key={j} className="items-center gap-1">
                  <Skeleton className="h-4 w-4 mb-1" />
                  <Skeleton className="h-4 w-10" />
                  <Skeleton className="h-2.5 w-12 mt-0.5" />
                </View>
              ))}
            </View>
          </View>
        </Card>
      ))}
    </View>
  );
}

interface KindSelectItem {
  id: string;
  name: string;
}

export function CopyPerformancePanel({
  stats,
  loading,
}: {
  stats: AccountCopyStats | null;
  loading: boolean;
}) {
  const { width } = useWindowDimensions();
  const isMobile = width < LAYOUT_BREAKPOINT;

  const groups = useMemo(
    () => groupCopyStatsByKind(stats?.rows ?? []),
    [stats?.rows],
  );

  const [activeKind, setActiveKind] = useState<string | null>(null);

  // Fall back to first group when the selected kind has no data
  useEffect(() => {
    if (groups.length === 0) {
      setActiveKind(null);
      return;
    }
    if (activeKind && groups.some((g) => g.kind === activeKind)) return;
    setActiveKind(groups[0].kind);
  }, [groups, activeKind]);

  const tabs: Tab[] = useMemo(
    () => groups.map((g) => ({ id: g.kind, label: g.label })),
    [groups],
  );

  const selectItems: KindSelectItem[] = useMemo(
    () => groups.map((g) => ({ id: g.kind, name: g.label })),
    [groups],
  );

  const activeGroup: CopyLeaderboardGroup | undefined = useMemo(
    () => groups.find((g) => g.kind === activeKind),
    [groups, activeKind],
  );

  const backlog = stats?.copyBacklog ?? 0;
  const failed = stats?.failedContents ?? 0;

  return (
    <View>
      {backlog > 0 ? (
        <View className="mb-3">
          <Alert
            variant="warning"
            message={`${INTEGER_FORMATTER.format(backlog)} new email${backlog === 1 ? '' : 's'} still being labeled.`}
          />
        </View>
      ) : null}
      {failed > 0 ? (
        <View className="mb-3">
          <Alert
            variant="error"
            message={`${INTEGER_FORMATTER.format(failed)} email${failed === 1 ? '' : 's'} could not be labeled.`}
          />
        </View>
      ) : null}

      {loading ? (
        <LoadingSkeleton />
      ) : groups.length === 0 ? (
        <Text className="text-sm text-gray-400 font-instrument py-4">
          No sent emails with parsed copy in this range.
        </Text>
      ) : (
        <View>
          {isMobile ? (
            <View className="mb-4">
              <Select<KindSelectItem>
                items={selectItems}
                getItemId={(item) => item.id}
                getItemLabel={(item) => ({ primary: item.name })}
                value={activeKind}
                onChange={(id) => setActiveKind(id)}
                searchable={false}
                placeholder="Select type"
                noMargin
              />
            </View>
          ) : (
            <Tabs
              tabs={tabs}
              activeTab={activeKind ?? ''}
              onTabChange={setActiveKind}
              layout="content"
              marginBottom={12}
            />
          )}

          {activeGroup ? (
            <View>
              {activeGroup.rows.map((row) => (
                <CopyPieceRow key={row.id} row={row} />
              ))}
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
}
