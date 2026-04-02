import { useState, type ReactNode } from 'react';
import { View, Text, Pressable, Link } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '@/components/ui/button';
import { SourceImportedRowSummary } from './SourceImportedRowSummary';
import { SourceLinkCandidateRow } from './SourceLinkCandidateRow';
import { RegistryCompanySearchPanel } from './RegistryCompanySearchPanel';
import type { SourceRecordViewModel } from './sourceRecordViewModel';
import { formatLinkScore } from './sourceRecordViewModel';

const isWeb = typeof window !== 'undefined';

function NoSuggestedMatchPanel({
  importRunRecordsHref,
  showGenerateCandidatesHint,
  embedded = false,
}: {
  importRunRecordsHref: string | null;
  showGenerateCandidatesHint: boolean;
  /** When true, omit outer spacing (parent handles layout). */
  embedded?: boolean;
}) {
  const router = useRouter();

  const shell = embedded ? '' : 'mb-6 pb-6 border-b border-white/[0.06]';

  return (
    <View className={shell}>
      <Text className="text-neutral-300 font-instrument text-sm font-medium">No suggested match</Text>
      <Text className="text-neutral-500 font-instrument text-xs mt-1 leading-5">
        {showGenerateCandidatesHint
          ? 'Try generating candidates, search, or fix the source row.'
          : 'Search the registry or create a new company.'}
      </Text>
      {importRunRecordsHref ? (
        isWeb ? (
          <Link href={importRunRecordsHref} style={{ marginTop: 10 }}>
            <Text className="text-sky-400/90 font-instrument text-sm">Open import run</Text>
          </Link>
        ) : (
          <Pressable onPress={() => router.push(importRunRecordsHref)} className="mt-2 py-1 self-start">
            <Text className="text-sky-400/90 font-instrument text-sm">Open import run</Text>
          </Pressable>
        )
      ) : null}
    </View>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <Text className="text-neutral-500 font-instrument text-[11px] font-medium tracking-wide mb-2">{children}</Text>
  );
}

export function SourceLinkDecisionLadder({
  vm,
  density,
  importRunRecordsHref,
  busyCompanyId,
  disabled,
  onPickCompany,
  onCreateCompany,
  createBusy,
  showGenerateCandidatesHint = false,
  trailingSlot,
}: {
  vm: SourceRecordViewModel;
  density: 'compact' | 'comfortable';
  importRunRecordsHref: string | null;
  busyCompanyId: string | null;
  disabled: boolean;
  onPickCompany: (companyId: string) => void | Promise<void>;
  onCreateCompany: () => void | Promise<void>;
  createBusy: boolean;
  showGenerateCandidatesHint?: boolean;
  trailingSlot?: ReactNode;
}) {
  const { imported, normalization, candidates, match } = vm;
  const primary = candidates[0] ?? null;
  const extras = candidates.slice(1);
  const [moreOpen, setMoreOpen] = useState(false);

  const weakHeader =
    match.weakAutomaticMatch && match.bestCandidateScore != null && candidates.length > 0;
  const searchVariant = density === 'compact' ? 'compact' : 'full';
  const actionLocked = disabled || createBusy;
  const isQueue = density === 'compact';

  const registryRightClass =
    weakHeader && candidates.length > 0
      ? 'rounded-xl border border-amber-500/25 bg-amber-500/[0.04] p-4'
      : '';

  const inner = (
    <>
      {/* Import (left) + registry suggestions (right) on md+ */}
      <View className="mb-6 pb-6 border-b border-white/[0.06] flex-col md:flex-row md:items-start">
        <View className="flex-1 min-w-0 pb-6 md:pb-0 border-b border-white/[0.06] md:border-b-0 md:border-r md:border-white/[0.06] md:pr-6">
          <SourceImportedRowSummary
            imported={imported}
            normalization={normalization}
            density={density}
            inLadder
          />
        </View>

        <View
          className={`flex-1 min-w-0 pt-6 md:min-w-[260px] md:max-w-[48%] md:pt-0 md:pl-6 ${registryRightClass}`}
        >
          {candidates.length === 0 ? (
            <NoSuggestedMatchPanel
              importRunRecordsHref={importRunRecordsHref}
              showGenerateCandidatesHint={showGenerateCandidatesHint}
              embedded
            />
          ) : (
            <>
              <View className="flex-row flex-wrap items-center justify-between gap-2 mb-3">
                <Text className="text-neutral-400 font-instrument text-[11px] font-medium tracking-wide">
                  Registry match
                </Text>
                <View className="flex-row flex-wrap items-center gap-2">
                  {primary ? (
                    <View className="rounded-full bg-white/5 px-2.5 py-0.5 border border-white/10">
                      <Text className="text-neutral-300 font-mono text-[11px] tabular-nums">
                        {formatLinkScore(primary.linkScore)}
                      </Text>
                    </View>
                  ) : null}
                  {weakHeader ? (
                    <View className="rounded-full bg-amber-500/15 px-2.5 py-0.5 border border-amber-500/25">
                      <Text className="text-amber-200/95 font-instrument text-[11px] font-medium">Weak match</Text>
                    </View>
                  ) : null}
                </View>
              </View>
              {primary ? (
                <SourceLinkCandidateRow
                  candidate={primary}
                  variant="primary"
                  busyCompanyId={busyCompanyId}
                  disabled={actionLocked}
                  onPickCompany={onPickCompany}
                  scoreText={null}
                />
              ) : null}

              {extras.length > 0 ? (
                <View className="mt-5 pt-5 border-t border-white/[0.08]">
                  <Pressable onPress={() => setMoreOpen((o) => !o)} className="py-1 self-start mb-2">
                    <Text className="text-neutral-500 font-instrument text-sm">
                      {moreOpen ? '▼' : '▶'} {extras.length} more suggestion{extras.length === 1 ? '' : 's'}
                    </Text>
                  </Pressable>
                  {moreOpen ? (
                    <View className="gap-3">
                      {extras.map((c) => (
                        <View key={c.companyId} className="pl-3 border-l border-white/10 py-1">
                          <SourceLinkCandidateRow
                            candidate={c}
                            variant="secondary"
                            busyCompanyId={busyCompanyId}
                            disabled={actionLocked}
                            onPickCompany={onPickCompany}
                            scoreText={formatLinkScore(c.linkScore)}
                            linkLabel="Link here"
                          />
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
              ) : null}
            </>
          )}
        </View>
      </View>

      <View className="mb-6">
        <SectionLabel>Search registry</SectionLabel>
        <RegistryCompanySearchPanel
          variant={searchVariant}
          hideIntro
          flat
          busyCompanyId={busyCompanyId}
          disabled={actionLocked}
          onLinkCompany={onPickCompany}
        />
      </View>

      <View>
        <SectionLabel>New company</SectionLabel>
        <Button
          variant="default"
          size="sm"
          className={isQueue ? 'self-stretch w-full max-w-sm' : 'self-start'}
          disabled={busyCompanyId != null || actionLocked}
          onPress={() => void onCreateCompany()}
        >
          {createBusy ? 'Creating…' : 'Create company + link'}
        </Button>
      </View>

      {trailingSlot ? <View className="mt-5 pt-4 border-t border-white/[0.06]">{trailingSlot}</View> : null}
    </>
  );

  if (isQueue) {
    return <View className="mt-2">{inner}</View>;
  }

  return <View>{inner}</View>;
}
