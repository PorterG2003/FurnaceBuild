import { useState, type ReactNode } from 'react';
import { Platform, Pressable, Text, View, useWindowDimensions } from 'react-native';
import {
  PaperAirplaneIcon,
  ChatBubbleLeftIcon,
  CheckCircleIcon,
  InformationCircleIcon,
  MegaphoneIcon,
  RectangleStackIcon,
} from 'react-native-heroicons/outline';
import { StatColumn } from '@/components/ui/StatColumn';
import { Tooltip } from '@/components/ui/Tooltip';
import { CAMPAIGN_STAT_COLORS } from '@/lib/campaigns/campaignStatColors';
import { copyStatCell, formatCopyStatPct } from '@/lib/metrics/copyLeaderboard';
import { copySkewWarnings } from '@/lib/metrics/copySkew';
import type { AccountCopyStatRow } from '@/lib/supabase/services/campaigns/account-copy-stats-rpc-map';
import { LAYOUT_BREAKPOINT } from '@/components/ui/layout/constants';
import { CopyPieceDetails } from './CopyPieceDetails';

const NON_OOO_HELP =
  'Human replies as a share of sends. Excludes out-of-office and auto-replies.';
const INTERESTED_HELP =
  'Interested replies as a share of sends. Pieces with at least 100 sends are ranked by this rate.';

function StatHelpIcon() {
  return (
    <View className="shrink-0">
      <InformationCircleIcon size={12} color="#9CA3AF" />
    </View>
  );
}

function StatHelpTooltip({
  help,
  enabled,
  children,
}: {
  help?: string;
  enabled: boolean;
  children: ReactNode;
}) {
  if (!help || !enabled) return children;
  return (
    <Tooltip
      content={
        <Text className="text-gray-300 font-instrument text-xs leading-5" style={{ maxWidth: 260 }}>
          {help}
        </Text>
      }
      placement="top"
    >
      {children}
    </Tooltip>
  );
}

function SkewPills({ row }: { row: AccountCopyStatRow }) {
  const warnings = copySkewWarnings(row);
  if (warnings.length === 0) return null;
  return (
    <>
      {warnings.map((warning) => (
        <Tooltip
          key={warning.code}
          placement="top"
          content={
            <Text className="text-gray-300 font-instrument text-xs leading-5" style={{ maxWidth: 260 }}>
              {warning.detail}
            </Text>
          }
        >
          <View className="flex-row items-center gap-1 rounded-full bg-amber-400/10 px-2 py-0.5">
            <Text className="text-[10px] text-amber-400 font-instrument-semibold">
              {warning.label}
            </Text>
            <InformationCircleIcon size={10} color="#fbbf24" />
          </View>
        </Tooltip>
      ))}
    </>
  );
}

export function CopyPieceRow({
  row,
}: {
  row: AccountCopyStatRow;
}) {
  const [expanded, setExpanded] = useState(false);
  const { width: screenWidth } = useWindowDimensions();
  const isMobile = screenWidth < LAYOUT_BREAKPOINT;
  const statSize = isMobile ? 'xs' : 'default';

  const nonOoo = copyStatCell(Math.max(0, row.replied - row.ooo_replied), row.sent);
  const interested = copyStatCell(row.positive_reply, row.sent);
  const contextFlex = isMobile ? 0.92 : 1;
  const sentFlex = isMobile ? 0.96 : 1;
  const rateFlex = isMobile ? 1.1 : 1;

  const identityBlock = (
    <View className={isMobile ? '' : 'flex-1 min-w-0'}>
      <View className="flex-row items-center gap-2 flex-wrap">
        <Text
          className={`text-white font-instrument-semibold ${isMobile ? 'text-base' : 'text-lg'}`}
          numberOfLines={2}
        >
          {row.name}
        </Text>
        <SkewPills row={row} />
      </View>
    </View>
  );

  const hoverHelp = Platform.OS === 'web' && !isMobile;
  const contextStats = (
    <>
      <View className="items-center min-w-0" style={{ flex: contextFlex }}>
        <StatColumn icon={MegaphoneIcon} value={row.campaigns} label="Campaigns" color="#f85102" size={statSize} />
      </View>
      <View className="items-center min-w-0" style={{ flex: contextFlex }}>
        <StatColumn icon={RectangleStackIcon} value={row.distinct_nodes} label="Steps" color="#9ca3af" size={statSize} />
      </View>
      <View className="items-center min-w-0" style={{ flex: sentFlex }}>
        <StatColumn icon={PaperAirplaneIcon} value={row.sent} label="Sent" color={CAMPAIGN_STAT_COLORS.sent} size={statSize} />
      </View>
    </>
  );
  const rateStats = (
    <>
      <View className="items-center min-w-0" style={{ flex: rateFlex }}>
        <StatHelpTooltip help={NON_OOO_HELP} enabled={hoverHelp}>
          <StatColumn
            icon={ChatBubbleLeftIcon}
            value={formatCopyStatPct(nonOoo.pct)}
            secondary={nonOoo.pct == null ? undefined : nonOoo.count}
            label="Non-OOO"
            color="#06b6d4"
            size={statSize}
            labelAccessory={hoverHelp ? <StatHelpIcon /> : undefined}
          />
        </StatHelpTooltip>
      </View>
      <View className="items-center min-w-0" style={{ flex: rateFlex }}>
        <StatHelpTooltip help={INTERESTED_HELP} enabled={hoverHelp}>
          <StatColumn
            icon={CheckCircleIcon}
            value={formatCopyStatPct(interested.pct)}
            secondary={interested.pct == null ? undefined : interested.count}
            label="Interested"
            color={CAMPAIGN_STAT_COLORS.positiveReply}
            size={statSize}
            labelAccessory={hoverHelp ? <StatHelpIcon /> : undefined}
          />
        </StatHelpTooltip>
      </View>
    </>
  );

  if (isMobile) {
    return (
      <View className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl mb-4 overflow-hidden">
        <Pressable
          onPress={() => setExpanded((prev) => !prev)}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          className="p-3.5 hover:bg-white/[0.02]"
        >
          {identityBlock}
          <View className="flex-row items-start mt-3">
            {contextStats}
            {rateStats}
          </View>
        </Pressable>
        {expanded ? <CopyPieceDetails row={row} /> : null}
      </View>
    );
  }

  return (
    <View className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl mb-4 overflow-hidden">
      <Pressable
        onPress={() => setExpanded((prev) => !prev)}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        className="p-4 hover:bg-white/[0.02]"
      >
        <View className="flex-row items-center gap-4">
          <View className="flex-row gap-3 flex-1 min-w-0">
            {identityBlock}
          </View>
          <View className="flex-row flex-none shrink-0" style={{ flexBasis: '56%' }}>
            {contextStats}
            {rateStats}
          </View>
        </View>
      </Pressable>
      {expanded ? <CopyPieceDetails row={row} /> : null}
    </View>
  );
}
