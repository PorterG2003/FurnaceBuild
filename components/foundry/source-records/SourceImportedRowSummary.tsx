import { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Link, useRouter } from 'expo-router';
import type { SourceRecordImportedFields, SourceRecordNormalization } from './sourceRecordViewModel';

const isWeb = typeof window !== 'undefined';

function shortId(uuid: string): string {
  if (uuid.length <= 12) return uuid;
  return `${uuid.slice(0, 8)}…`;
}

export function SourceImportedRowSummary({
  imported,
  normalization,
  density = 'comfortable',
  inLadder = false,
}: {
  imported: SourceRecordImportedFields;
  normalization: SourceRecordNormalization;
  density?: 'comfortable' | 'compact';
  /** When nested in SourceLinkDecisionLadder, drop extra bottom margin on the detail card. */
  inLadder?: boolean;
}) {
  const router = useRouter();
  const runHref =
    imported.ingestionRunId != null ? `/foundry/imports/${imported.ingestionRunId}/records` : null;
  const [idsOpen, setIdsOpen] = useState(false);

  const isCompact = density === 'compact';

  if (isCompact) {
    const metaParts: string[] = [];
    if (imported.sourceName) metaParts.push(imported.sourceName);
    if (imported.observedAt) metaParts.push(imported.observedAt.slice(0, 10));

    return (
      <View className="mb-0">
        <Text
          className="text-white font-instrument-semibold text-lg leading-6 tracking-tight"
          numberOfLines={4}
        >
          {imported.nameRaw}
        </Text>
        {imported.website ? (
          <Text className="text-sky-400/90 font-instrument text-sm mt-2" numberOfLines={2}>
            {imported.website}
          </Text>
        ) : null}
        {imported.addressRaw ? (
          <Text className="text-neutral-400 font-instrument text-sm mt-1.5 leading-5" numberOfLines={4}>
            {imported.addressRaw}
          </Text>
        ) : null}
        {metaParts.length > 0 ? (
          <Text className="text-neutral-500 font-instrument text-[11px] mt-2">{metaParts.join(' · ')}</Text>
        ) : null}

        {normalization.normalizedNameKey ? (
          <Text className="text-neutral-500 font-mono text-[11px] mt-2" numberOfLines={2}>
            {normalization.normalizedNameKey}
            {normalization.inferredStateRegion ? ` · ${normalization.inferredStateRegion}` : ''}
          </Text>
        ) : (
          <Text className="text-amber-500/85 font-instrument text-[11px] mt-2">
            No match key yet—normalize job may still be running.
          </Text>
        )}

        <Pressable onPress={() => setIdsOpen((o) => !o)} className="mt-3 py-1 self-start">
          <Text className="text-neutral-500 font-instrument text-xs">
            {idsOpen ? '▼' : '▶'} Record IDs & import
          </Text>
        </Pressable>
        {idsOpen ? (
          <View className="mt-2 pl-1 border-l border-white/10">
            {imported.sourceRecordId ? (
              <Text className="text-neutral-500 font-mono text-[10px] selectable" numberOfLines={2}>
                {imported.sourceRecordId}
              </Text>
            ) : null}
            {runHref ? (
              isWeb ? (
                <Link href={runHref} style={{ marginTop: 6 }}>
                  <Text className="text-sky-400/90 font-instrument text-xs">Open import run</Text>
                </Link>
              ) : (
                <Pressable onPress={() => router.push(runHref)} className="mt-2 py-1 self-start">
                  <Text className="text-sky-400/90 font-instrument text-xs">Open import run</Text>
                </Pressable>
              )
            ) : null}
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View className={`${inLadder ? 'mb-0' : 'mb-4'} p-4 rounded-2xl border border-white/[0.08] bg-[#141414]`}>
      <Text className="text-neutral-500 font-instrument text-[11px] font-medium tracking-wide mb-3">
        Imported row
      </Text>
      {imported.sourceRecordId ? (
        <Text className="text-neutral-500 font-mono text-[10px] mb-1" selectable numberOfLines={1}>
          {shortId(imported.sourceRecordId)}
        </Text>
      ) : null}
      {imported.sourceName ? (
        <Text className="text-neutral-500 font-instrument text-xs mb-2">{imported.sourceName}</Text>
      ) : null}
      <Text className="text-white font-instrument-semibold text-lg leading-6" numberOfLines={4}>
        {imported.nameRaw}
      </Text>
      {imported.website ? (
        <Text className="text-sky-400/90 font-instrument text-sm mt-2" numberOfLines={2}>
          {imported.website}
        </Text>
      ) : (
        <Text className="text-neutral-600 font-instrument text-sm mt-2">No website</Text>
      )}
      {imported.addressRaw ? (
        <Text className="text-neutral-400 font-instrument text-sm mt-1.5 leading-5" numberOfLines={4}>
          {imported.addressRaw}
        </Text>
      ) : (
        <Text className="text-neutral-600 font-instrument text-sm mt-1.5">No address</Text>
      )}
      {imported.observedAt ? (
        <Text className="text-neutral-500 font-instrument text-[11px] mt-2">
          Observed {imported.observedAt.slice(0, 19).replace('T', ' ')}
        </Text>
      ) : null}

      <View className="mt-4 pt-3 border-t border-white/[0.06]">
        {normalization.normalizedNameKey ? (
          <Text className="text-neutral-500 font-mono text-[11px]" numberOfLines={2}>
            Key {normalization.normalizedNameKey}
            {normalization.inferredStateRegion ? ` · ${normalization.inferredStateRegion}` : ''}
          </Text>
        ) : (
          <Text className="text-amber-500/90 font-instrument text-xs">
            No normalized name key yet — wait for the post-import normalize job to finish, refresh, or check Runs if it
            is stuck.
          </Text>
        )}
        {runHref ? (
          isWeb ? (
            <Link href={runHref} style={{ marginTop: 8, alignSelf: 'flex-start' }}>
              <Text className="text-sky-400/90 font-instrument text-xs">Open import run records</Text>
            </Link>
          ) : (
            <Pressable onPress={() => router.push(runHref)} className="mt-2 self-start py-1">
              <Text className="text-sky-400/90 font-instrument text-xs">Open import run records</Text>
            </Pressable>
          )
        ) : null}
      </View>
    </View>
  );
}
