import { useCallback, useState } from 'react';
import {
  View,
  ScrollView,
  Text,
  Pressable,
  useWindowDimensions,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { PageHeader, Breadcrumb } from '@/components/ui/layout';
import { LAYOUT_BREAKPOINT } from '@/components/ui/layout/constants';
import { Button } from '@/components/ui/button';
import { fetchCompanyDetail } from '@/lib/foundry/registry-client';
import type { ParsedCompanyDetail } from '@/lib/foundry/registry-types';
import { CompanyProfilePanel } from '@/components/foundry/companies/CompanyProfilePanel';
import { CompanyLocationsPanel } from '@/components/foundry/companies/CompanyLocationsPanel';
import { CompanySourceLinksTimeline } from '@/components/foundry/companies/CompanySourceLinksTimeline';
import { CompanyEntityMatchesPanel } from '@/components/foundry/companies/CompanyEntityMatchesPanel';
import { CompanyQuickActions } from '@/components/foundry/companies/CompanyQuickActions';

function buildSubtitle(detail: ParsedCompanyDetail | null): string | undefined {
  if (!detail?.company) return undefined;
  const parts = [detail.company.normalized_key, detail.company.notes].filter(
    (p): p is string => typeof p === 'string' && p.length > 0,
  );
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

function copyCompanyId(id: string) {
  if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(id).then(
      () => Alert.alert('Copied', 'Company ID copied to clipboard.'),
      () => Alert.alert('Copy failed', 'Unable to copy to clipboard.'),
    );
    return;
  }
  Alert.alert('Copy ID', 'Select the ID in the profile block to copy on this device.');
}

export default function CompanyDetailPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { width } = useWindowDimensions();
  const wide = width >= LAYOUT_BREAKPOINT;

  const [detail, setDetail] = useState<ParsedCompanyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showRawJson, setShowRawJson] = useState(false);

  const load = useCallback(async () => {
    if (!id || typeof id !== 'string') return;
    setError(null);
    setLoading(true);
    try {
      const d = await fetchCompanyDetail(id);
      setDetail(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (!id || typeof id !== 'string') {
    return (
      <View className="flex-1 p-6">
        <Text className="text-gray-500">Invalid company.</Text>
      </View>
    );
  }

  const company = detail?.company;
  const title = company?.legal_name?.trim() || 'Company';
  const subtitle = buildSubtitle(detail);

  const mainGrid =
    company != null && detail != null ? (
      wide ? (
        <View className="flex-row items-start gap-5">
          <View className="flex-[0.4] min-w-[280px] max-w-md">
            <CompanyProfilePanel company={company} />
          </View>
          <View className="flex-1 min-w-0">
            <CompanyLocationsPanel locations={detail.locations} />
            <CompanySourceLinksTimeline links={detail.source_links} />
            <CompanyEntityMatchesPanel matches={detail.entity_matches} />
            <CompanyQuickActions />
          </View>
        </View>
      ) : (
        <View>
          <CompanyProfilePanel company={company} />
          <CompanyLocationsPanel locations={detail.locations} />
          <CompanySourceLinksTimeline links={detail.source_links} />
          <CompanyEntityMatchesPanel matches={detail.entity_matches} />
          <CompanyQuickActions />
        </View>
      )
    ) : !loading && !error ? (
      <Text className="text-gray-500 font-instrument text-sm mb-4">Could not read company from the API response.</Text>
    ) : null;

  return (
    <ScrollView
      className="flex-1"
      contentContainerStyle={{ padding: 16, paddingBottom: 48 }}
      showsVerticalScrollIndicator={false}
    >
      <Breadcrumb
        items={[
          { label: 'Foundry', href: '/foundry' },
          { label: 'Company' },
        ]}
      />
      <PageHeader
        title={title}
        subtitle={subtitle}
        primaryAction={
          <View className="flex-row flex-wrap justify-end gap-2">
            <Button variant="outline" size="sm" disabled={loading || !company} onPress={() => void load()}>
              Refresh
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={loading || !company}
              onPress={() => company && copyCompanyId(company.id)}
            >
              Copy ID
            </Button>
          </View>
        }
      />

      {error ? <Text className="text-red-400 mb-3 font-instrument text-sm">{error}</Text> : null}

      {loading ? (
        <View className="py-8 items-center">
          <ActivityIndicator color="#f3440d" />
          <Text className="text-gray-500 font-instrument text-sm mt-3">Loading…</Text>
        </View>
      ) : (
        mainGrid
      )}

      <Pressable onPress={() => setShowRawJson((v) => !v)} className="mb-2 py-2 mt-2">
        <Text className="text-gray-500 font-instrument text-xs">
          {showRawJson ? '▼ Hide API payload (debug)' : '▶ Show API payload (debug)'}
        </Text>
      </Pressable>
      {showRawJson && detail ? (
        <Text className="text-gray-300 font-mono text-xs leading-5 mb-4">
          {JSON.stringify(detail, null, 2)}
        </Text>
      ) : null}
    </ScrollView>
  );
}
