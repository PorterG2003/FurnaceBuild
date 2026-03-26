import { View, Text, Pressable } from 'react-native';
import { Link, useRouter } from 'expo-router';
import type { SourceRecordImportedFields, SourceRecordNormalization } from './sourceRecordViewModel';

const isWeb = typeof window !== 'undefined';

export function SourceImportedRowSummary({
  imported,
  normalization,
}: {
  imported: SourceRecordImportedFields;
  normalization: SourceRecordNormalization;
}) {
  const router = useRouter();
  const runHref =
    imported.ingestionRunId != null ? `/foundry/imports/${imported.ingestionRunId}/records` : null;

  return (
    <View className="mb-4 p-3 rounded-lg border border-[#2A2A2A] bg-[#1A1A1A]">
      <Text className="text-gray-500 font-instrument text-[10px] uppercase tracking-wider mb-2">
        Imported row (from your data)
      </Text>
      {imported.sourceRecordId ? (
        <Text className="text-gray-500 font-mono text-[10px] mb-1" selectable>
          Source record ID: {imported.sourceRecordId}
        </Text>
      ) : null}
      {imported.sourceName ? (
        <Text className="text-gray-500 font-instrument text-[10px] mb-2">Source: {imported.sourceName}</Text>
      ) : null}
      <Text className="text-white font-instrument-semibold text-sm" numberOfLines={3}>
        {imported.nameRaw}
      </Text>
      {imported.website ? (
        <Text className="text-gray-400 font-instrument text-xs mt-2" numberOfLines={2}>
          {imported.website}
        </Text>
      ) : (
        <Text className="text-gray-600 font-instrument text-xs mt-2">No website</Text>
      )}
      {imported.addressRaw ? (
        <Text className="text-gray-400 font-instrument text-xs mt-1" numberOfLines={3}>
          {imported.addressRaw}
        </Text>
      ) : (
        <Text className="text-gray-600 font-instrument text-xs mt-1">No address</Text>
      )}
      {imported.observedAt ? (
        <Text className="text-gray-500 font-instrument text-[10px] mt-2">
          Observed {imported.observedAt.slice(0, 19).replace('T', ' ')}
        </Text>
      ) : null}

      <View className="mt-3 pt-3 border-t border-[#2A2A2A]">
        <Text className="text-gray-500 font-instrument text-[10px] uppercase tracking-wider mb-1">
          Normalization
        </Text>
        {normalization.normalizedNameKey ? (
          <Text className="text-gray-300 font-mono text-[10px]" numberOfLines={2}>
            Key: {normalization.normalizedNameKey}
          </Text>
        ) : (
          <Text className="text-amber-500/90 font-instrument text-xs">
            No normalized name key yet — wait for the post-import normalize job to finish, refresh, or check Runs if it is
            stuck.
          </Text>
        )}
        {normalization.inferredStateRegion ? (
          <Text className="text-gray-400 font-instrument text-xs mt-1">
            Inferred state: {normalization.inferredStateRegion}
          </Text>
        ) : null}
        {runHref ? (
          isWeb ? (
            <Link href={runHref} style={{ marginTop: 8, alignSelf: 'flex-start' }}>
              <Text className="text-sky-400 font-instrument text-xs">Open import run records</Text>
            </Link>
          ) : (
            <Pressable onPress={() => router.push(runHref)} className="mt-2 self-start py-1">
              <Text className="text-sky-400 font-instrument text-xs">Open import run records</Text>
            </Pressable>
          )
        ) : null}
      </View>
    </View>
  );
}
