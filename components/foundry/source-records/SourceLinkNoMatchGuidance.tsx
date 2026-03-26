import { View, Text, Pressable } from 'react-native';
import { Link, useRouter } from 'expo-router';
import { formatLinkScore } from './sourceRecordViewModel';

const isWeb = typeof window !== 'undefined';

export function SourceLinkNoMatchGuidance({
  variant,
  weakAutomaticMatch,
  bestCandidateScore,
  noCandidates,
  notLinked,
  importRunRecordsHref,
}: {
  variant: 'full' | 'compact';
  weakAutomaticMatch: boolean;
  bestCandidateScore: number | null;
  noCandidates: boolean;
  notLinked: boolean;
  importRunRecordsHref: string | null;
}) {
  const router = useRouter();

  if (!notLinked) return null;

  const pad = variant === 'compact' ? 'p-2 mb-2' : 'p-3 mb-4';

  if (weakAutomaticMatch && bestCandidateScore != null) {
    return (
      <View className={`rounded-lg border border-amber-900/50 bg-amber-950/30 ${pad}`}>
        <Text className="text-amber-200/95 font-instrument-semibold text-xs">
          Weak automatic match (best score {formatLinkScore(bestCandidateScore)})
        </Text>
        <Text className="text-amber-200/80 font-instrument text-xs mt-1 leading-5">
          {variant === 'compact'
            ? 'Verify before linking, search the registry, or create a new company if needed.'
            : 'The system would not auto-link at this confidence. Open each company and compare to the import before linking, use registry search for a different company, or create a new company if this import is genuinely new.'}
        </Text>
      </View>
    );
  }

  if (noCandidates) {
    return (
      <View className={`rounded-lg border border-[#3A3A3A] bg-[#141414] ${pad}`}>
        <Text className="text-gray-400 font-instrument-semibold text-xs">No suggested matches yet</Text>
        <Text className="text-gray-500 font-instrument text-xs mt-2 leading-5">
          {variant === 'compact' ? (
            <>
              Try <Text className="text-gray-400">Generate</Text>, <Text className="text-gray-400">Search registry</Text>{' '}
              below, <Text className="text-gray-400">Create company</Text>, or fix the row via import records.
            </>
          ) : (
            <>
              Next steps:{`\n`}
              1. Run <Text className="text-gray-400">Generate candidates</Text> after normalization if you have not
              already.
              {`\n`}
              2. Use <Text className="text-gray-400">Search registry</Text> below to find an existing company by name.
              {`\n`}
              3. Use <Text className="text-gray-400">Create company + link</Text> if this business is new to the registry.
              {`\n`}
              4. <Text className="text-gray-400">Reject candidates</Text> if suggestions are wrong, then fix the source
              row and re-import if the name or address was bad.
            </>
          )}
        </Text>
        {importRunRecordsHref ? (
          isWeb ? (
            <Link href={importRunRecordsHref} style={{ marginTop: 8 }}>
              <Text className="text-sky-400 font-instrument text-xs">Open import run records (fix source data)</Text>
            </Link>
          ) : (
            <Pressable onPress={() => router.push(importRunRecordsHref)} className="mt-2 py-1 self-start">
              <Text className="text-sky-400 font-instrument text-xs">Open import run records (fix source data)</Text>
            </Pressable>
          )
        ) : null}
      </View>
    );
  }

  return null;
}
