import { View, Text } from 'react-native';
import Svg, { Rect } from 'react-native-svg';
import type { CampaignStatsByDay } from '@/lib/supabase/services/campaigns';
import { format, parseISO } from 'date-fns';

const BAR_HEIGHT = 12;
const CHART_WIDTH = 220;
const COLORS = {
  sent: '#a78bfa',
  replied: '#14b8a6',
  positiveReply: '#10b981',
  bounce: '#f59e0b',
};

interface CampaignStatsChartProps {
  data: CampaignStatsByDay[];
  loading?: boolean;
}

export function CampaignStatsChart({ data, loading }: CampaignStatsChartProps) {
  if (loading) {
    return (
      <View className="rounded-xl border border-[#2A2A2A] bg-[#1A1A1A] p-4">
        <Text className="text-gray-400 font-instrument text-sm">Loading chart...</Text>
      </View>
    );
  }

  if (!data || data.length === 0) {
    return (
      <View className="rounded-xl border border-[#2A2A2A] bg-[#1A1A1A] p-4">
        <Text className="text-gray-400 font-instrument text-sm">No activity in this range yet.</Text>
      </View>
    );
  }

  const maxTotal = Math.max(
    1,
    ...data.map((d) => d.sent + d.replied + d.positiveReply + d.bounce)
  );

  return (
    <View className="rounded-xl border border-[#2A2A2A] bg-[#1A1A1A] p-4">
      <View style={{ flexDirection: 'row', marginBottom: 12, gap: 16, flexWrap: 'wrap' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: COLORS.sent }} />
          <Text className="text-gray-400 font-instrument text-xs">Sent</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: COLORS.replied }} />
          <Text className="text-gray-400 font-instrument text-xs">Replied</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: COLORS.positiveReply }} />
          <Text className="text-gray-400 font-instrument text-xs">Positive</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: COLORS.bounce }} />
          <Text className="text-gray-400 font-instrument text-xs">Bounced</Text>
        </View>
      </View>
      <View style={{ gap: 8 }}>
        {data.slice(-14).map((day) => {
          const total = day.sent + day.replied + day.positiveReply + day.bounce;
          const scale = total > 0 ? CHART_WIDTH / total : 0;
          const x0 = 0;
          const x1 = day.sent * scale;
          const x2 = x1 + day.replied * scale;
          const x3 = x2 + day.positiveReply * scale;
          return (
            <View key={day.date} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text className="text-gray-500 font-instrument text-xs" style={{ width: 64 }}>
                {format(parseISO(day.date), 'MMM d')}
              </Text>
              <Svg width={CHART_WIDTH} height={BAR_HEIGHT}>
                <Rect x={x0} y={0} width={day.sent * scale} height={BAR_HEIGHT} fill={COLORS.sent} rx={2} />
                <Rect x={x1} y={0} width={day.replied * scale} height={BAR_HEIGHT} fill={COLORS.replied} rx={2} />
                <Rect x={x2} y={0} width={day.positiveReply * scale} height={BAR_HEIGHT} fill={COLORS.positiveReply} rx={2} />
                <Rect x={x3} y={0} width={day.bounce * scale} height={BAR_HEIGHT} fill={COLORS.bounce} rx={2} />
              </Svg>
              <Text className="text-gray-400 font-instrument text-xs">
                {total > 0 ? `${day.sent}/${day.replied}/${day.positiveReply}/${day.bounce}` : '—'}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}
