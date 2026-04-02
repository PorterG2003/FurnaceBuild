import { View, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '@/components/ui/button';
import type { SourceCandidateRow } from './sourceRecordViewModel';

export function SourceLinkCandidateRow({
  candidate,
  variant,
  busyCompanyId,
  disabled,
  onPickCompany,
  scoreText,
  linkLabel = 'Link to this company',
}: {
  candidate: SourceCandidateRow;
  variant: 'primary' | 'secondary';
  busyCompanyId?: string | null;
  disabled?: boolean;
  onPickCompany: (companyId: string) => void | Promise<void>;
  scoreText?: string | null;
  linkLabel?: string;
}) {
  const router = useRouter();
  const rowBusy = busyCompanyId === candidate.companyId;
  const websites = candidate.linkedSourceWebsites ?? [];
  const primaryWebsite = websites[0];
  const extraWebsites = websites.length > 1 ? websites.length - 1 : 0;

  const nameClass =
    variant === 'primary'
      ? 'text-white font-instrument-semibold text-lg leading-6 tracking-tight'
      : 'text-neutral-100 font-instrument text-sm font-medium leading-5';

  return (
    <View>
      <View className="flex-row flex-wrap items-start justify-between gap-2">
        <Text className={`${nameClass} flex-1`} numberOfLines={4}>
          {candidate.legalName}
        </Text>
        {scoreText != null && scoreText !== '' ? (
          <Text className="text-neutral-400 font-mono text-xs tabular-nums pt-0.5">{scoreText}</Text>
        ) : null}
      </View>
      {candidate.normalizedKey ? (
        <Text className="text-neutral-500 font-mono text-[11px] mt-1.5" numberOfLines={1}>
          {candidate.normalizedKey}
        </Text>
      ) : null}
      {primaryWebsite ? (
        <View className="flex-row flex-wrap items-center gap-1.5 mt-2">
          <Text className="text-sky-400/90 font-instrument text-sm flex-1" numberOfLines={2}>
            {primaryWebsite}
          </Text>
          {extraWebsites > 0 ? (
            <Text className="text-neutral-500 font-instrument text-[11px] shrink-0">+{extraWebsites}</Text>
          ) : null}
        </View>
      ) : null}
      {candidate.primaryAddressLine ? (
        <Text className="text-neutral-400 font-instrument text-sm mt-1.5 leading-5" numberOfLines={3}>
          {candidate.primaryAddressLine}
        </Text>
      ) : null}
      <View className="flex-row flex-wrap gap-2 mt-3">
        <Button
          variant="default"
          size="sm"
          disabled={disabled || (busyCompanyId != null && busyCompanyId !== candidate.companyId) || rowBusy}
          onPress={() => void onPickCompany(candidate.companyId)}
        >
          {rowBusy ? 'Linking…' : linkLabel}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={disabled}
          onPress={() => router.push(`/foundry/companies/${candidate.companyId}`)}
        >
          Open
        </Button>
      </View>
    </View>
  );
}
