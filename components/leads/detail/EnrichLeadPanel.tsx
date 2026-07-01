import React, { useEffect, useState } from 'react';
import { View, ScrollView, Text, Animated, KeyboardAvoidingView, Platform } from 'react-native';
import { XMarkIcon } from 'react-native-heroicons/outline';
import { IconButton } from '@/components/ui/icon-button';
import type { AccountLeadDetail } from '@/lib/leads/types';
import { getCreditBalance, type CreditBalance } from '@/lib/credits/balance';
import { CREDIT_METERS } from '@/lib/credits/meters';
import { EnrichLeadScreen } from './EnrichLeadScreen';
import { ENRICH_COPY } from './enrichCopy';
import { EnrichCreditBalancePill } from './EnrichLeadMeta';

export interface EnrichLeadPanelProps {
  visible: boolean;
  onClose: () => void;
  accountId: string;
  detail: AccountLeadDetail;
  onApplied: () => void;
  onCreditsChange?: (balance: CreditBalance) => void;
  slideAnim: Animated.Value;
  panelWidth?: number;
}

export function EnrichLeadPanel({
  visible,
  onClose,
  accountId,
  detail,
  onApplied,
  onCreditsChange,
  slideAnim,
  panelWidth = 480,
}: EnrichLeadPanelProps) {
  const [creditBalance, setCreditBalance] = useState<CreditBalance | null>(null);

  useEffect(() => {
    if (!visible || !accountId) return;
    let cancelled = false;
    void getCreditBalance(accountId, CREDIT_METERS.apolloEnrichment)
      .then((balance) => {
        if (!cancelled) setCreditBalance(balance);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [accountId, visible]);

  if (!visible) return null;

  return (
    <Animated.View
      style={{
        width: slideAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [panelWidth, 0],
        }),
        overflow: 'hidden',
        backgroundColor: '#1A1A1A',
        borderLeftWidth: 1,
        borderLeftColor: '#2A2A2A',
        alignSelf: 'stretch',
        minHeight: 0,
      }}
    >
      <View style={{ width: panelWidth, flex: 1, minHeight: 0 }}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1, minHeight: 0 }}
        >
          <View className="flex-1 min-h-0">
            <View className="flex-row items-center justify-between gap-3 px-5 py-4 border-b border-[#2A2A2A]">
              <View className="flex-1 min-w-0 flex-row items-center gap-2 flex-wrap">
                <Text
                  className="text-base font-instrument-semibold text-white leading-5 shrink-0"
                  numberOfLines={1}
                >
                  {ENRICH_COPY.title}
                </Text>
                {creditBalance ? (
                  <View className="shrink-0 justify-center self-center">
                    <EnrichCreditBalancePill
                      creditsRemaining={creditBalance.remaining}
                      creditLimit={creditBalance.limit}
                    />
                  </View>
                ) : null}
              </View>
              <IconButton
                variant="ghost"
                size="sm"
                icon={XMarkIcon}
                onPress={onClose}
                accessibilityLabel="Close enrich panel"
                className="-mr-1 shrink-0"
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              />
            </View>

            <ScrollView
              className="flex-1 px-5"
              contentContainerStyle={{ paddingTop: 16, paddingBottom: 24 }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <EnrichLeadScreen
                accountId={accountId}
                detail={detail}
                onApplied={() => {
                  onApplied();
                  onClose();
                }}
                onCancel={onClose}
                onCreditsChange={(balance) => {
                  setCreditBalance(balance);
                  onCreditsChange?.(balance);
                }}
              />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Animated.View>
  );
}
