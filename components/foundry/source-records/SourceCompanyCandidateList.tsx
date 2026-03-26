import { View, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '@/components/ui/button';
import type { SourceCandidateRow } from './sourceRecordViewModel';
import { formatLinkScore } from './sourceRecordViewModel';

export function SourceCompanyCandidateList({
  candidates,
  onPickCompany,
  busyCompanyId,
  disabled,
}: {
  candidates: SourceCandidateRow[];
  onPickCompany: (companyId: string) => void | Promise<void>;
  busyCompanyId?: string | null;
  disabled?: boolean;
}) {
  const router = useRouter();

  if (candidates.length === 0) {
    return (
      <View className="mb-4 p-3 rounded-lg border border-[#2A2A2A] bg-[#121212]">
        <Text className="text-gray-500 font-instrument text-xs uppercase tracking-wider mb-2">
          Companies in your registry (suggested matches)
        </Text>
        <Text className="text-gray-500 font-instrument text-xs leading-5">
          None listed yet. Use <Text className="text-gray-400">Generate candidates</Text> or{' '}
          <Text className="text-gray-400">Search registry</Text> below. If a &quot;next steps&quot; panel appears above,
          follow that first.
        </Text>
      </View>
    );
  }

  return (
    <View className="mb-4">
      <Text className="text-gray-500 font-instrument text-xs uppercase tracking-wider mb-1">
        Companies in your registry (suggested matches)
      </Text>
      <Text className="text-gray-500 font-instrument text-[11px] leading-5 mb-2">
        These rows already exist in your company directory. Scores reflect name and key similarity to the imported row
        above—not proof they are the same business.
      </Text>
      {candidates.map((c) => {
        const rowBusy = busyCompanyId === c.companyId;
        return (
          <View
            key={c.companyId}
            className="mb-2 p-3 rounded-lg border border-[#2A2A2A] bg-[#1A1A1A]"
          >
            <View className="flex-row flex-wrap items-baseline justify-between gap-2">
              <Text className="text-gray-200 font-instrument text-sm flex-1" numberOfLines={3}>
                {c.legalName}
              </Text>
              <Text className="text-gray-400 font-mono text-xs">{formatLinkScore(c.linkScore)}</Text>
            </View>
            {c.normalizedKey ? (
              <Text className="text-gray-500 font-mono text-[10px] mt-1" numberOfLines={1}>
                {c.normalizedKey}
              </Text>
            ) : null}
            <View className="flex-row flex-wrap gap-2 mt-2">
              <Button
                variant="default"
                size="sm"
                disabled={disabled || (busyCompanyId != null && busyCompanyId !== c.companyId) || rowBusy}
                onPress={() => void onPickCompany(c.companyId)}
              >
                {rowBusy ? 'Linking…' : 'Link to this company'}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={disabled}
                onPress={() => router.push(`/foundry/companies/${c.companyId}`)}
              >
                Open company
              </Button>
            </View>
          </View>
        );
      })}
    </View>
  );
}
