import React from 'react';
import { View, Text } from 'react-native';
import type { SocialMediaPlanBlockProps } from '@/lib/flux/types';
import { fluxPreviewFontFamily } from '@/lib/flux/fluxPreviewFontFamily';
import { withFluxAlpha } from '@/lib/flux/fluxPresentationTokens';
import { useFluxPresentation, useFluxTheme } from '../FluxThemeProvider';

export function SocialMediaPlanBlock({ props }: { props: SocialMediaPlanBlockProps }) {
  const theme = useFluxTheme();
  const presentation = useFluxPresentation();
  const primaryTint = withFluxAlpha(theme.primaryColor, '18');
  const accentTint = withFluxAlpha(theme.accentColor || theme.primaryColor, '22');
  const complexLayout = presentation.layouts.complex;
  const headingFont = fluxPreviewFontFamily(theme.fontFamily, '600');
  const bodyFont = fluxPreviewFontFamily(theme.fontFamily, '400');
  const outerBg = theme.backgroundColor;
  const headerStyle =
    complexLayout === 'editorial'
      ? { borderLeftWidth: 3, borderLeftColor: theme.primaryColor, paddingLeft: 18 }
      : {
          ...presentation.tintedCard,
          backgroundColor: primaryTint,
        };
  const dayCardStyle = complexLayout === 'soft' ? presentation.tintedCard : presentation.card;

  return (
    <View className="w-full py-10 px-4 md:px-6" style={{ backgroundColor: outerBg }}>
      <View
        className={complexLayout === 'dashboard' ? 'w-full max-w-5xl self-center' : 'w-full max-w-4xl self-center'}
      >
        {/* Header strip: vertical + honest rationale */}
        <View
          className={complexLayout === 'editorial' ? 'mb-6' : 'overflow-hidden mb-6'}
          style={headerStyle}
        >
          <View className={complexLayout === 'editorial' ? '' : 'px-4 py-3 md:px-5 md:py-4'}>
            <Text
              className="text-[10px] md:text-xs uppercase tracking-wider mb-1"
              style={{
                color: theme.textColor,
                opacity: presentation.mutedTextOpacity,
                fontFamily: headingFont,
              }}
            >
              Inferred vertical (labeled honestly)
            </Text>
            <Text
              className="text-xl md:text-2xl mb-2"
              style={{
                color: theme.textColor,
                fontFamily: headingFont,
              }}
            >
              {props.inferred_vertical || '—'}
            </Text>
            <Text
              className="text-sm md:text-base leading-5"
              style={{
                color: theme.textColor,
                opacity: 0.85,
                fontFamily: bodyFont,
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
            fontFamily: bodyFont,
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
                    fontFamily: headingFont,
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
                    className={
                      complexLayout === 'editorial'
                        ? 'w-full p-4'
                        : 'w-full sm:w-[calc(50%-6px)] lg:w-[calc(33.333%-8px)] p-4'
                    }
                    style={dayCardStyle}
                  >
                    <View className="flex-row flex-wrap gap-2 mb-2">
                      <View
                        className="px-2 py-0.5"
                        style={{ ...presentation.chip, backgroundColor: accentTint }}
                      >
                        <Text
                          className="text-xs"
                          style={{
                            color: theme.textColor,
                            fontFamily: headingFont,
                          }}
                        >
                          {day.platform || '—'}
                        </Text>
                      </View>
                      <View
                        className="px-2 py-0.5"
                        style={{
                          ...presentation.outlineChip,
                          borderColor: withFluxAlpha(theme.primaryColor, '40'),
                        }}
                      >
                        <Text
                          className="text-xs"
                          style={{
                            color: theme.primaryColor,
                            fontFamily: headingFont,
                          }}
                        >
                          {day.post_type || '—'}
                        </Text>
                      </View>
                    </View>
                    <Text
                      className="text-sm leading-5 mb-2"
                      style={{
                        color: theme.textColor,
                        fontFamily: headingFont,
                      }}
                    >
                      {day.hook || ''}
                    </Text>
                    {day.cta ? (
                      <Text
                        className="text-xs leading-4"
                        style={{
                          color: theme.textColor,
                          opacity: presentation.mutedTextOpacity,
                          fontFamily: bodyFont,
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
          className="p-4 md:p-5"
          style={complexLayout === 'soft' ? presentation.tintedCard : presentation.strongCard}
        >
          <Text
            className="text-xs uppercase tracking-wider mb-3"
            style={{
              color: theme.textColor,
              opacity: 0.6,
              fontFamily: headingFont,
            }}
          >
            CTA ladder
          </Text>
          <View className="flex-row flex-wrap gap-y-2 gap-x-1 items-center mb-4">
            {props.cta_ladder.length === 0 ? (
              <Text
                className="text-sm"
                style={{
                  color: theme.textColor,
                  opacity: presentation.mutedTextOpacity,
                  fontFamily: fluxPreviewFontFamily(theme.fontFamily, '400'),
                }}
              >
                —
              </Text>
            ) : (
              props.cta_ladder.map((step, i) => (
                <React.Fragment key={i}>
                  {i > 0 ? (
                    <Text
                      className="text-xs px-1"
                      style={{ color: theme.primaryColor, fontFamily: headingFont }}
                    >
                      →
                    </Text>
                  ) : null}
                  <View
                    className="px-2.5 py-1 mr-1"
                    style={{ ...presentation.chip, backgroundColor: primaryTint }}
                  >
                    <Text
                      className="text-xs md:text-sm"
                      style={{
                        color: theme.textColor,
                        fontFamily: headingFont,
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
              color: theme.textColor,
              opacity: presentation.mutedTextOpacity,
              fontFamily: bodyFont,
            }}
          >
            <Text style={{ fontFamily: headingFont }}>Platform mix: </Text>
            {props.platform_mix_note || ''}
          </Text>
        </View>
      </View>
    </View>
  );
}
