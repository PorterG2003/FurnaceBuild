import React from 'react';
import { View, Text, Image, Pressable, Linking } from 'react-native';
import type { CompetitorAdAuditBlockProps } from '@/lib/flux/types';
import { fluxPreviewFontFamily } from '@/lib/flux/fluxPreviewFontFamily';
import { useFluxPresentation, useFluxTheme } from '../FluxThemeProvider';

function statusLabel(status: CompetitorAdAuditBlockProps['status']): string {
  switch (status) {
    case 'pending':
      return 'Not run yet';
    case 'running':
      return 'Running audit…';
    case 'ready':
      return 'Ready';
    case 'error':
      return 'Audit failed';
    default:
      return String(status);
  }
}

export function CompetitorAdAuditBlock({ props }: { props: CompetitorAdAuditBlockProps }) {
  const theme = useFluxTheme();
  const presentation = useFluxPresentation();
  const headingFont = fluxPreviewFontFamily(theme.fontFamily, '600');
  const bodyFont = fluxPreviewFontFamily(theme.fontFamily, '400');

  return (
    <View className="w-full px-6 py-10" style={{ backgroundColor: theme.backgroundColor }}>
      <View className="flex-row flex-wrap items-center gap-2 mb-2">
        <Text
          className="text-2xl md:text-3xl"
          style={{ color: theme.textColor, fontFamily: headingFont }}
        >
          {props.heading?.trim() || 'Competitor ad audit'}
        </Text>
        <View
          className="px-2 py-0.5 rounded-md border"
          style={{
            borderColor: theme.primaryColor,
            backgroundColor: `${theme.primaryColor}18`,
          }}
        >
          <Text className="text-xs font-instrument-semibold" style={{ color: theme.primaryColor }}>
            {statusLabel(props.status)}
          </Text>
        </View>
      </View>
      {props.status === 'error' && props.errorMessage ? (
        <Text className="text-sm mb-4" style={{ color: '#b91c1c', fontFamily: bodyFont }}>
          {props.errorMessage}
        </Text>
      ) : null}
      {props.status === 'pending' || props.status === 'running' ? (
        <Text className="text-sm text-gray-600 font-instrument leading-6 max-w-xl">
          {props.status === 'running'
            ? 'We are scanning Google Ads Transparency and building your competitor map. Refresh in a minute.'
            : 'Run the competitor audit from the prospect editor when you are ready. It needs a saved service area on the prospect.'}
        </Text>
      ) : null}
      {props.status === 'ready' && props.competitors.length > 0 ? (
        <View className="gap-10 mt-4">
          {props.competitors.map((row, i) => (
            <View key={`${row.name}-${i}`} className="gap-3">
              <Text className="text-lg font-instrument-semibold" style={{ color: theme.textColor }}>
                {row.name}
              </Text>
              {row.mapImageUrl ? (
                <Image
                  source={{ uri: row.mapImageUrl }}
                  className="w-full max-w-2xl h-48 rounded-xl bg-gray-200"
                  resizeMode="cover"
                />
              ) : null}
              <Text className="text-sm leading-6" style={{ color: theme.textColor, fontFamily: bodyFont }}>
                {row.adsSummary}
              </Text>
              <View className="gap-3">
                {row.examples.map((ex, j) => (
                  <View
                    key={`${ex.sourceUrl}-${j}`}
                    className="rounded-xl p-4"
                    style={presentation.card}
                  >
                    <Text className="text-base font-instrument-semibold mb-1" style={{ color: theme.textColor }}>
                      {ex.headline}
                    </Text>
                    <Text className="text-sm mb-2" style={{ color: theme.textColor, opacity: 0.85, fontFamily: bodyFont }}>
                      {ex.body}
                    </Text>
                    <Pressable onPress={() => Linking.openURL(ex.sourceUrl)}>
                      <Text className="text-xs font-instrument-semibold" style={{ color: theme.primaryColor }}>
                        View on Google Ads Transparency
                      </Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}
