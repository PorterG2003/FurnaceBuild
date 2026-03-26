import { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, ScrollView, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '@/components/ui/button';
import { fetchRegistryCompanies } from '@/lib/foundry/registry-client';
import type { RegistryCompany } from '@/lib/foundry/registry-types';

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

export function RegistryCompanySearchPanel({
  onLinkCompany,
  busyCompanyId,
  disabled,
  variant = 'full',
}: {
  onLinkCompany: (companyId: string) => void | Promise<void>;
  busyCompanyId?: string | null;
  disabled?: boolean;
  variant?: 'full' | 'compact';
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const debouncedQ = useDebouncedValue(query, 350);
  const [companies, setCompanies] = useState<RegistryCompany[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchErr, setSearchErr] = useState<string | null>(null);

  const runSearch = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setCompanies([]);
      setSearchErr(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setSearchErr(null);
    try {
      const r = await fetchRegistryCompanies({ q: trimmed, limit: 50 });
      setCompanies(r.companies);
    } catch (e) {
      setSearchErr(e instanceof Error ? e.message : 'Search failed');
      setCompanies([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void runSearch(debouncedQ);
  }, [debouncedQ, runSearch]);

  const title =
    variant === 'compact'
      ? 'Search registry (by company name)'
      : 'Search registry for a different company';

  return (
    <View className="mb-4 p-3 rounded-lg border border-[#2A2A2A] bg-[#121212]">
      <Text className="text-gray-500 font-instrument text-xs uppercase tracking-wider mb-1">{title}</Text>
      <Text className="text-gray-500 font-instrument text-[11px] leading-5 mb-2">
        Type at least 2 characters to search existing companies by legal name. Use this when suggestions are wrong or
        missing.
      </Text>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Company name…"
        placeholderTextColor="#666"
        editable={!disabled}
        className="text-gray-200 font-instrument text-sm p-2 rounded border border-[#3A3A3A] bg-[#1A1A1A] mb-2"
      />
      {loading ? (
        <View className="py-2 flex-row items-center gap-2">
          <ActivityIndicator size="small" color="#888" />
          <Text className="text-gray-500 font-instrument text-xs">Searching…</Text>
        </View>
      ) : null}
      {searchErr ? <Text className="text-red-400 font-instrument text-xs mb-2">{searchErr}</Text> : null}
      {!loading && debouncedQ.trim().length >= 2 && companies.length === 0 && !searchErr ? (
        <Text className="text-gray-500 font-instrument text-xs mb-2">No companies matched that search.</Text>
      ) : null}
      <ScrollView className="max-h-48" nestedScrollEnabled>
        {companies.map((c) => {
          const rowBusy = busyCompanyId === c.id;
          return (
            <View
              key={c.id}
              className="py-2 border-b border-[#2A2A2A] flex-row flex-wrap items-center justify-between gap-2"
            >
              <View className="flex-1 min-w-[120px]">
                <Text className="text-gray-200 font-instrument text-xs" numberOfLines={2}>
                  {c.legal_name}
                </Text>
                <Text className="text-gray-600 font-mono text-[10px] mt-0.5" numberOfLines={1}>
                  {c.id}
                </Text>
              </View>
              <View className="flex-row flex-wrap gap-1">
                <Button
                  variant="default"
                  size="sm"
                  disabled={disabled || (busyCompanyId != null && busyCompanyId !== c.id) || rowBusy}
                  onPress={() => void onLinkCompany(c.id)}
                >
                  {rowBusy ? '…' : 'Link'}
                </Button>
                <Button variant="secondary" size="sm" disabled={disabled} onPress={() => router.push(`/foundry/companies/${c.id}`)}>
                  Open
                </Button>
              </View>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}
