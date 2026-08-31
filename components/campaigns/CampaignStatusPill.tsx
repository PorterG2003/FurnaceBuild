import React from 'react';
import { View, Text } from 'react-native';

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  draft: { bg: '#374151', text: '#9CA3AF' },
  scheduled: { bg: '#1E3A8A', text: '#60A5FA' },
  running: { bg: '#065F46', text: '#10B981' },
  paused: { bg: '#78350F', text: '#F59E0B' },
  stopped: { bg: '#8B2E1F', text: '#EF5540' },
};

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  running: 'Running',
  paused: 'Paused',
  stopped: 'Stopped',
};

export interface CampaignStatusPillProps {
  status: string;
}

export function CampaignStatusPill({ status }: CampaignStatusPillProps) {
  const s =
    status?.toLowerCase() in STATUS_COLORS ? status.toLowerCase() : 'draft';
  const { bg, text } = STATUS_COLORS[s] ?? STATUS_COLORS.draft;
  const label = STATUS_LABELS[s] ?? STATUS_LABELS.draft;

  return (
    <View
      style={{
        backgroundColor: bg,
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 8,
      }}
    >
      <Text style={{ color: text, fontSize: 12, fontWeight: '500' }}>
        {label}
      </Text>
    </View>
  );
}
