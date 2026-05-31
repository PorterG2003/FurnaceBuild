import React, { useState } from 'react';
import { Text, type LayoutChangeEvent, View } from 'react-native';
import { ProposalMetricCard } from '@/components/platform-invite/ProposalMetricCard';
import {
  getProposalPlanCardStyle,
  getProposalPlanPreset,
  type ProposalPlanTier,
} from '@/lib/platform-invite/proposalPlans';

const COMPACT_METRICS_BREAKPOINT = 560;

export function ProposalPlanCard({
  tier,
  metrics = [],
  leadSourcing,
  consultingTime,
}: {
  tier: ProposalPlanTier;
  metrics?: Array<{
    key: string;
    title: string;
    value: string;
    subtitle?: string;
  }>;
  leadSourcing?: {
    key: string;
    title: string;
    value: string;
    subtitle?: string | null;
  } | null;
  consultingTime?: {
    key: string;
    title: string;
    value: string;
    subtitle?: string | null;
  } | null;
}) {
  const [containerWidth, setContainerWidth] = useState(0);
  const isCompactMetrics = containerWidth > 0 && containerWidth < COMPACT_METRICS_BREAKPOINT;
  const preset = getProposalPlanPreset(tier);
  const style = getProposalPlanCardStyle(tier);
  const hasMetrics = metrics.length > 0 || Boolean(leadSourcing) || Boolean(consultingTime);
  const metricRowClass = isCompactMetrics ? 'w-full flex-col gap-5' : 'w-full flex-row gap-4';

  const handleLayout = (event: LayoutChangeEvent) => {
    setContainerWidth(event.nativeEvent.layout.width);
  };

  const renderMetricCard = (metric: {
    key: string;
    title: string;
    value: string;
    subtitle?: string | null;
  }) => (
    <ProposalMetricCard
      key={metric.key}
      title={metric.title}
      subtitle={metric.subtitle}
      value={metric.value}
      accentColor={style.metricAccentColor}
      compact={isCompactMetrics}
    />
  );

  return (
    <View
      onLayout={handleLayout}
      style={{
        borderWidth: 1,
        borderColor: style.borderColor,
        borderRadius: 16,
        backgroundColor: style.backgroundColor,
        paddingHorizontal: style.isFeatured ? 28 : 24,
        paddingVertical: style.isFeatured ? 32 : 28,
      }}
    >
      <Text
        selectable={false}
        className="font-instrument-semibold"
        style={{
          color: style.titleColor,
          fontSize: style.isFeatured ? 28 : 24,
          marginBottom: hasMetrics ? 20 : 0,
        }}
      >
        {preset.label}
      </Text>

      {hasMetrics ? (
        isCompactMetrics ? (
          <View className="gap-5">
            {metrics.map(renderMetricCard)}
            {consultingTime ? renderMetricCard(consultingTime) : null}
            {leadSourcing ? renderMetricCard(leadSourcing) : null}
          </View>
        ) : (
          <View className="gap-5">
            {metrics.length > 0 ? (
              <View className={metricRowClass}>{metrics.map(renderMetricCard)}</View>
            ) : null}

            {leadSourcing || consultingTime ? (
              <View
                style={
                  metrics.length > 0
                    ? {
                        borderTopWidth: 1,
                        borderTopColor: 'rgba(255, 255, 255, 0.08)',
                        paddingTop: 20,
                      }
                    : undefined
                }
                className={metricRowClass}
              >
                {consultingTime ? renderMetricCard(consultingTime) : <View className="flex-1 min-w-0" />}
                {leadSourcing ? renderMetricCard(leadSourcing) : <View className="flex-1 min-w-0" />}
              </View>
            ) : null}
          </View>
        )
      ) : null}
    </View>
  );
}
