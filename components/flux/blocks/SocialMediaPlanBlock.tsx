import React from 'react';
import { View, Text } from 'react-native';
import type { SocialMediaPlanBlockProps } from '@/lib/flux/types';
import { fluxPreviewFontFamily } from '@/lib/flux/fluxPreviewFontFamily';
import { useFluxTheme } from '../FluxThemeProvider';

export function SocialMediaPlanBlock({ props }: { props: SocialMediaPlanBlockProps }) {
  const theme = useFluxTheme();
  const primaryTint = theme.primaryColor + '18';
  const accentTint = (theme.accentColor || theme.primaryColor) + '22';

  return (
    <View className="w-full py-10 px-4 md:px-6" style={{ backgroundColor: theme.backgroundColor }}>
      <View className="w-full max-w-4xl self-center">
        {/* Header strip: vertical + honest rationale */}
        <View
          className="rounded-xl overflow-hidden border mb-6"
          style={{
            borderColor: theme.primaryColor + '35',
            backgroundColor: primaryTint,
          }}
        >
          <View className="px-4 py-3 md:px-5 md:py-4">
            <Text
              className="text-[10px] md:text-xs uppercase tracking-wider mb-1"
              style={{
                color: theme.textColor,
                opacity: 0.65,
                fontFamily: fluxPreviewFontFamily(theme.fontFamily, '600'),
              }}
            >
              Inferred vertical (labeled honestly)
            </Text>
            <Text
              className="text-xl md:text-2xl mb-2"
              style={{
                color: theme.textColor,
                fontFamily: fluxPreviewFontFamily(theme.fontFamily, '600'),
              }}
            >
              {props.inferred_vertical || '—'}
            </Text>
            <Text
              className="text-sm md:text-base leading-5"
              style={{
                color: theme.textColor,
                opacity: 0.85,
                fontFamily: fluxPreviewFontFamily(theme.fontFamily, '400'),
              }}
            >
              {props.inferred_vertical_rationale || ''}
            </Text>
          </View>
        </View>

        {/* Positioning */}
        <Text
          className="text-base md:text-lg leading-6 mb-8"
          style={{
            color: theme.textColor,
            fontFamily: fluxPreviewFontFamily(theme.fontFamily, '400'),
          }}
        >
          {props.positioning_summary || ''}
        </Text>

        {/* Week calendar */}
        <View className="gap-8 mb-8">
          {props.weeks.map((week, wi) => (
            <View key={wi}>
              <View className="flex-row items-center gap-2 mb-3">
                <View
                  className="h-7 w-1 rounded-full"
                  style={{ backgroundColor: theme.primaryColor }}
                />
                <Text
                  className="text-lg md:text-xl flex-1"
                  style={{
                    color: theme.textColor,
                    fontFamily: fluxPreviewFontFamily(theme.fontFamily, '600'),
                  }}
                >
                  Week {wi + 1}
                  {week.theme ? `: ${week.theme}` : ''}
                </Text>
              </View>
              <View className="flex-row flex-wrap gap-3">
                {week.days.map((day, di) => (
                  <View
                    key={di}
                    className="w-full sm:w-[calc(50%-6px)] lg:w-[calc(33.333%-8px)] rounded-xl p-4 border"
                    style={{
                      backgroundColor: '#ffffff',
                      borderColor: '#e5e5e5',
                    }}
                  >
                    <View className="flex-row flex-wrap gap-2 mb-2">
                      <View
                        className="px-2 py-0.5 rounded-md"
                        style={{ backgroundColor: accentTint }}
                      >
                        <Text
                          className="text-xs"
                          style={{
                            color: theme.textColor,
                            fontFamily: fluxPreviewFontFamily(theme.fontFamily, '600'),
                          }}
                        >
                          {day.platform || '—'}
                        </Text>
                      </View>
                      <View
                        className="px-2 py-0.5 rounded-md border"
                        style={{ borderColor: theme.primaryColor + '40' }}
                      >
                        <Text
                          className="text-xs"
                          style={{
                            color: theme.primaryColor,
                            fontFamily: fluxPreviewFontFamily(theme.fontFamily, '600'),
                          }}
                        >
                          {day.post_type || '—'}
                        </Text>
                      </View>
                    </View>
                    <Text
                      className="text-sm leading-5 mb-2"
                      style={{
                        color: '#1a1a1a',
                        fontFamily: fluxPreviewFontFamily(theme.fontFamily, '600'),
                      }}
                    >
                      {day.hook || ''}
                    </Text>
                    {day.cta ? (
                      <Text
                        className="text-xs leading-4"
                        style={{
                          color: '#666666',
                          fontFamily: fluxPreviewFontFamily(theme.fontFamily, '400'),
                        }}
                      >
                        CTA: {day.cta}
                      </Text>
                    ) : null}
                  </View>
                ))}
              </View>
            </View>
          ))}
        </View>

        {/* CTA ladder + platform note */}
        <View
          className="rounded-xl border p-4 md:p-5"
          style={{
            borderColor: theme.primaryColor + '30',
            backgroundColor: '#ffffff',
          }}
        >
          <Text
            className="text-xs uppercase tracking-wider mb-3"
            style={{
              color: theme.textColor,
              opacity: 0.6,
              fontFamily: fluxPreviewFontFamily(theme.fontFamily, '600'),
            }}
          >
            CTA ladder
          </Text>
          <View className="flex-row flex-wrap gap-y-2 gap-x-1 items-center mb-4">
            {props.cta_ladder.length === 0 ? (
              <Text
                className="text-sm"
                style={{ color: '#666666', fontFamily: fluxPreviewFontFamily(theme.fontFamily, '400') }}
              >
                —
              </Text>
            ) : (
              props.cta_ladder.map((step, i) => (
                <React.Fragment key={i}>
                  {i > 0 ? (
                    <Text
                      className="text-xs px-1"
                      style={{ color: theme.primaryColor, fontFamily: fluxPreviewFontFamily(theme.fontFamily, '600') }}
                    >
                      →
                    </Text>
                  ) : null}
                  <View
                    className="px-2.5 py-1 rounded-lg mr-1"
                    style={{ backgroundColor: primaryTint }}
                  >
                    <Text
                      className="text-xs md:text-sm"
                      style={{
                        color: theme.textColor,
                        fontFamily: fluxPreviewFontFamily(theme.fontFamily, '600'),
                      }}
                    >
                      {step}
                    </Text>
                  </View>
                </React.Fragment>
              ))
            )}
          </View>
          <Text
            className="text-xs md:text-sm leading-5"
            style={{
              color: '#555555',
              fontFamily: fluxPreviewFontFamily(theme.fontFamily, '400'),
            }}
          >
            <Text style={{ fontFamily: fluxPreviewFontFamily(theme.fontFamily, '600') }}>Platform mix: </Text>
            {props.platform_mix_note || ''}
          </Text>
        </View>
      </View>
    </View>
  );
}
