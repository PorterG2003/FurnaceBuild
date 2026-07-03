import { useMemo, useState } from 'react';
import { View, Text, Pressable, type LayoutChangeEvent } from 'react-native';
import { SmartleadBadge } from '@/components/campaigns';
import { Select } from '@/components/ui/forms';
import { useOnboardingTarget } from '@/components/onboarding/useOnboardingTarget';
import { TARGETS } from '@/lib/onboarding/types';
import type { InboxThreadToolbarAction } from '@/lib/inbox';
import { getCategoryColor } from '@/lib/inbox/category-colors';
import type { LeadReplacementSummary } from '@/lib/supabase/services/leads';
import {
  THREAD_CATEGORIES,
} from './inboxConstants';
import { MessagePanelToolbar } from './MessagePanelToolbar';

const TITLE_BLOCK_MAX_WIDTH = 420;
const CATEGORY_CONTROL_WIDTH = 140;
const COMPACT_CHIP_BLOCK_MAX_WIDTH = 280;
const ROOMY_CHIP_BLOCK_MAX_WIDTH = 340;
const SOURCE_CHIP_MAX_WIDTH = 100;
const COMPACT_CAMPAIGN_CHIP_MAX_WIDTH = 200;
const ROOMY_CAMPAIGN_CHIP_MAX_WIDTH = 260;
const ROOMY_RIGHT_CLUSTER_THRESHOLD = 720;
const EMPTY_BLOCKED_EMAILS: string[] = [];
const DEFAULT_CATEGORY_OPTIONS = THREAD_CATEGORIES;

/** Sticky header: left = prospect name + email; right = toolbar (campaign chip, Block, tags, category) */
export function MessagePanelHeader({
  prospectName,
  campaignName,
  sourceLabel,
  prospectEmails,
  blockedEmails,
  toolbarActions,
  category,
  onSetCategory,
  categoryOptions,
  showToolbar = true,
  showTitleAndEmail = true,
  replacementSummary = null,
  onOpenLeadDetail,
}: {
  prospectName?: string | null;
  campaignName?: string | null;
  sourceLabel?: string | null;
  prospectEmails: string[];
  blockedEmails?: string[] | Set<string>;
  toolbarActions: InboxThreadToolbarAction[];
  category?: string | null;
  onSetCategory?: (category: string | null) => void;
  categoryOptions?: string[];
  /** When false, hide the right-side toolbar (Block, Tags, Category). Default true. */
  showToolbar?: boolean;
  /** When false, hide the left-side title and email (e.g. when shown in a parent header). Default true. */
  showTitleAndEmail?: boolean;
  replacementSummary?: LeadReplacementSummary | null;
  /** Opens the account lead detail page for this prospect. */
  onOpenLeadDetail?: () => void;
}) {
  const _blockedEmails = blockedEmails ?? EMPTY_BLOCKED_EMAILS;
  const leadDetailRef = useOnboardingTarget(TARGETS.inboxLeadDetail);
  const threadActionsRef = useOnboardingTarget(TARGETS.inboxThreadActions);
  const [rightClusterWidth, setRightClusterWidth] = useState(0);
  const isSmartleadSource = !!sourceLabel && (sourceLabel === 'Smartlead' || sourceLabel.startsWith('Imported from Smartlead'));
  const resolvedCategoryOptions = categoryOptions ?? DEFAULT_CATEGORY_OPTIONS;
  const roomyChipLayout = rightClusterWidth >= ROOMY_RIGHT_CLUSTER_THRESHOLD;
  const chipBlockMaxWidth = roomyChipLayout ? ROOMY_CHIP_BLOCK_MAX_WIDTH : COMPACT_CHIP_BLOCK_MAX_WIDTH;
  const campaignChipMaxWidth = roomyChipLayout ? ROOMY_CAMPAIGN_CHIP_MAX_WIDTH : COMPACT_CAMPAIGN_CHIP_MAX_WIDTH;
  const categoryItems = useMemo(
    () => [{ id: '', name: 'No category' }, ...resolvedCategoryOptions.map((c) => ({ id: c, name: c }))],
    [resolvedCategoryOptions]
  );
  const title = prospectName ?? prospectEmails[0] ?? '—';
  const replacementLine = replacementSummary
    ? replacementSummary.role === 'new'
      ? `Replaces ${replacementSummary.counterpartLabel || replacementSummary.counterpartEmail || 'previous lead'}`
      : `Replaced by ${replacementSummary.counterpartLabel || replacementSummary.counterpartEmail || 'new lead'}`
    : null;

  const hasLeftContent = showTitleAndEmail;
  const hasRightContent = showToolbar;

  const titleContent = (
    <View className="min-w-0 w-full" style={{ maxWidth: '100%' }}>
      <View className="flex-row items-center gap-2 min-w-0">
        <Text
          className="text-lg font-instrument-semibold text-white leading-tight"
          numberOfLines={1}
          style={{ flexShrink: 1, maxWidth: '100%' }}
        >
          {title}
        </Text>
        {replacementLine ? (
          <View
            className="rounded-lg px-2 py-0.5 min-w-0"
            style={{
              backgroundColor: 'rgba(249, 115, 22, 0.12)',
              borderWidth: 1,
              borderColor: 'rgba(249, 115, 22, 0.35)',
            }}
          >
            <Text
              className="text-xs font-instrument-medium"
              style={{ color: '#FDBA74' }}
              numberOfLines={1}
            >
              {replacementLine}
            </Text>
          </View>
        ) : null}
      </View>
      {prospectEmails.length > 0 ? (
        <View className="gap-0.5 min-w-0" style={{ marginTop: 2 }}>
          {prospectEmails.map((email, index) => (
            <Text
              key={`${email}-${index}`}
              className="text-sm font-instrument text-gray-500 leading-tight"
              numberOfLines={1}
              style={{ maxWidth: '100%' }}
            >
              {email}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );

  if (!hasLeftContent && !hasRightContent) {
    return null;
  }

  const handleRightClusterLayout = (event: LayoutChangeEvent) => {
    const nextWidth = Math.ceil(event.nativeEvent.layout.width);
    setRightClusterWidth((current) => (current === nextWidth ? current : nextWidth));
  };

  return (
    <View
      className="px-5 py-3.5 border-b border-[#2A2A2A] bg-[#0D0D0D]"
      style={{ borderBottomWidth: 1 }}
    >
      <View className="flex-row items-start gap-3">
        {/* Left: prospect name + email (optional) */}
        <View
          ref={leadDetailRef}
          collapsable={false}
          className="min-w-0"
          style={{
            flexBasis: showToolbar ? TITLE_BLOCK_MAX_WIDTH : 0,
            flexGrow: showToolbar ? 0 : 1,
            flexShrink: 1,
            maxWidth: showToolbar ? TITLE_BLOCK_MAX_WIDTH : undefined,
          }}
        >
          {showTitleAndEmail ? (
            onOpenLeadDetail ? (
              <Pressable
                onPress={onOpenLeadDetail}
                accessibilityLabel="View lead profile"
                style={{ width: '100%', maxWidth: '100%' }}
              >
                {titleContent}
              </Pressable>
            ) : (
              titleContent
            )
          ) : null}
        </View>

        {/* Right: toolbar — campaign chip, Block List, tags, category */}
        {showToolbar ? (
          <View
            ref={threadActionsRef}
            collapsable={false}
            className="flex-1 min-w-0 flex-row items-center justify-end gap-2"
            style={{ flexBasis: 0 }}
            onLayout={handleRightClusterLayout}
          >
            <MessagePanelToolbar
              actions={toolbarActions}
              prefix={
                sourceLabel || campaignName ? (
                  <View
                    className="flex-row items-center gap-2 min-w-0 shrink"
                    style={{ maxWidth: chipBlockMaxWidth, flexShrink: 1 }}
                  >
                    {sourceLabel ? (
                      isSmartleadSource ? (
                        <SmartleadBadge />
                      ) : (
                        <View
                          className="rounded-lg px-2 py-0.5 items-center justify-center min-w-0 shrink"
                          style={{
                            backgroundColor: 'rgba(243, 68, 13, 0.12)',
                            borderWidth: 1,
                            borderColor: 'rgba(243, 68, 13, 0.3)',
                            maxWidth: SOURCE_CHIP_MAX_WIDTH,
                            flexShrink: 1,
                          }}
                        >
                          <Text
                            className="text-xs font-instrument"
                            style={{ color: '#F97316', maxWidth: '100%', flexShrink: 1 }}
                            numberOfLines={1}
                          >
                            {sourceLabel}
                          </Text>
                        </View>
                      )
                    ) : null}
                    {campaignName ? (
                      <View
                        className="rounded-lg px-2 py-0.5 min-w-0 shrink"
                        style={{
                          backgroundColor: '#2A2A2A',
                          borderWidth: 1,
                          borderColor: '#3A3A3A',
                          maxWidth: campaignChipMaxWidth,
                          flexShrink: 1,
                        }}
                      >
                        <Text
                          className="text-xs font-instrument text-gray-400"
                          numberOfLines={1}
                          style={{ maxWidth: '100%', flexShrink: 1 }}
                        >
                          {campaignName}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                ) : null
              }
              suffix={
                onSetCategory && resolvedCategoryOptions.length > 0 ? (
                  <View style={{ width: CATEGORY_CONTROL_WIDTH }}>
                    <Select<{ id: string; name: string }>
                      items={categoryItems}
                      getItemId={(i) => i.id}
                      getItemLabel={(i) => ({
                        primary: i.name,
                        // Auto Reply releases a held outbound sequence in categorizer flows.
                        secondary: i.id === 'Auto Reply' ? 'Not a real reply — sequence continues' : undefined,
                      })}
                      getItemColor={(item) => getCategoryColor(item.id || null)}
                      itemColorVariant="tint"
                      value={category ?? ''}
                      onChange={(id) => onSetCategory(id || null)}
                      placeholder="Category"
                      searchable={false}
                      noMargin
                      size="compact"
                      dropdownMinWidth={220}
                      listMaxHeight={220}
                    />
                  </View>
                ) : null
              }
            />
          </View>
        ) : null}
      </View>
    </View>
  );
}
