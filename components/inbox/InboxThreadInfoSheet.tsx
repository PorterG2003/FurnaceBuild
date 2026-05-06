import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { BottomSheet } from '@/components/ui/modals';
import type { LeadReplacementSummary } from '@/lib/supabase/services/leads';

export interface InboxThreadInfoSheetProps {
  visible: boolean;
  onClose: () => void;
  campaignName: string | null;
  replacementSummary: LeadReplacementSummary | null;
}

function buildReplacementLine(summary: LeadReplacementSummary): string {
  const counterpart = summary.counterpartLabel || summary.counterpartEmail || (summary.role === 'new' ? 'previous lead' : 'new lead');
  return summary.role === 'new' ? `Replaces ${counterpart}` : `Replaced by ${counterpart}`;
}

export function InboxThreadInfoSheet({
  visible,
  onClose,
  campaignName,
  replacementSummary,
}: InboxThreadInfoSheetProps) {
  const hasAnyInfo = !!campaignName || !!replacementSummary;

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View style={{ paddingBottom: 12 }}>
        <Text className="text-lg font-instrument-semibold text-white" style={{ marginBottom: 16 }}>
          Conversation info
        </Text>

        {!hasAnyInfo ? (
          <Text className="text-gray-400 font-instrument text-sm">
            No additional info for this conversation.
          </Text>
        ) : (
          <View style={{ gap: 16 }}>
            {replacementSummary ? (
              <View>
                <Text className="text-gray-500 font-instrument text-xs uppercase tracking-wide" style={{ marginBottom: 6 }}>
                  Replacement status
                </Text>
                <View
                  className="self-start rounded-lg px-2.5 py-1"
                  style={{
                    backgroundColor: 'rgba(249, 115, 22, 0.12)',
                    borderWidth: 1,
                    borderColor: 'rgba(249, 115, 22, 0.35)',
                  }}
                >
                  <Text className="text-sm font-instrument-medium" style={{ color: '#FDBA74' }}>
                    {buildReplacementLine(replacementSummary)}
                  </Text>
                </View>
                {replacementSummary.reasonNote ? (
                  <Text className="text-gray-400 font-instrument text-sm" style={{ marginTop: 8 }}>
                    {replacementSummary.reasonNote}
                  </Text>
                ) : null}
              </View>
            ) : null}

            {campaignName ? (
              <View>
                <Text className="text-gray-500 font-instrument text-xs uppercase tracking-wide" style={{ marginBottom: 6 }}>
                  Campaign
                </Text>
                <View
                  className="self-start rounded-lg px-2.5 py-1"
                  style={{ backgroundColor: '#2A2A2A', borderWidth: 1, borderColor: '#3A3A3A' }}
                >
                  <Text className="text-sm font-instrument text-gray-300">{campaignName}</Text>
                </View>
              </View>
            ) : null}
          </View>
        )}

        <Pressable
          onPress={onClose}
          style={{
            marginTop: 24,
            alignItems: 'center',
            justifyContent: 'center',
            paddingVertical: 12,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: '#3A3A3A',
            backgroundColor: '#2A2A2A',
          }}
        >
          <Text className="text-white font-instrument-medium text-base">Close</Text>
        </Pressable>
      </View>
    </BottomSheet>
  );
}
