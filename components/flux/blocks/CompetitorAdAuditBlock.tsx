import React from 'react';
import { View, Text, Image, Pressable, Linking, type ViewStyle, type TextStyle } from 'react-native';
import type { CompetitorAdAuditBlockProps } from '@/lib/flux/types';
import { fluxImageResizeMode } from '@/lib/flux/fluxImageFit';
import { fluxPreviewFontFamily } from '@/lib/flux/fluxPreviewFontFamily';
import { withFluxAlpha } from '@/lib/flux/fluxPresentationTokens';
import { useFluxBlockPresentation, useFluxTheme } from '../FluxThemeProvider';

const DEFAULT_ADVERTISER_LINK_LABEL = "See all of {name}'s Google Ads";

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

function advertiserUrlFromSourceUrl(sourceUrl: string): string {
  const match = sourceUrl.match(/^(https:\/\/adstransparency\.google\.com\/advertiser\/[^/]+)/i);
  return match?.[1] ?? sourceUrl;
}

function formatAdvertiserLinkLabel(template: string | undefined, name: string): string {
  const pattern = template?.trim() || DEFAULT_ADVERTISER_LINK_LABEL;
  return pattern.replace(/\{name\}/g, name);
}

function AdvertiserLinkButton({
  label,
  url,
  buttonStyle,
  labelStyle,
}: {
  label: string;
  url: string;
  buttonStyle: ViewStyle;
  labelStyle: TextStyle;
}) {
  return (
    <Pressable
      className="self-start px-8 py-3 min-h-[44px] justify-center"
      style={buttonStyle}
      onPress={() => Linking.openURL(url)}
    >
      <Text className="text-base" style={labelStyle}>
        {label}
      </Text>
    </Pressable>
  );
}

export function CompetitorAdAuditBlock({ props }: { props: CompetitorAdAuditBlockProps }) {
  const theme = useFluxTheme();
  const presentation = useFluxBlockPresentation();
  const complexLayout = presentation.layouts.complex;
  const discoveryMode = props.discoveryMode ?? 'local_places';
  const headingFont = fluxPreviewFontFamily(theme.fontFamily, '600');
  const bodyFont = fluxPreviewFontFamily(theme.fontFamily, '400');
  const accentColor = theme.accentColor?.trim() || theme.primaryColor;
  const headingColor = presentation.headingColor;
  const outerBackground = presentation.sectionBackgroundColor;
  const frameClassName = complexLayout === 'dashboard' ? 'w-full max-w-5xl self-center' : 'w-full max-w-4xl self-center';
  const introCardStyle =
    complexLayout === 'soft'
      ? presentation.tintedCard
      : complexLayout === 'dashboard'
        ? presentation.strongCard
        : presentation.card;
  const advertiserButtonStyle = presentation.primaryButton;
  const advertiserButtonTextStyle: TextStyle = {
    color: presentation.onPrimaryColor,
    fontFamily: headingFont,
  };

  return (
    <View className="w-full py-10 px-4 md:px-6" style={{ backgroundColor: outerBackground }}>
      <View className={frameClassName}>
        <View className="flex-row flex-wrap items-start justify-between gap-3 mb-5">
          <View className="flex-1 min-w-[260px]">
            <Text
              className="text-[10px] md:text-xs uppercase tracking-[3px] mb-2"
              style={{ color: accentColor, fontFamily: headingFont }}
            >
              Competitive ad snapshot
            </Text>
            <Text
              className="text-2xl md:text-3xl"
              style={{ color: headingColor, fontFamily: headingFont }}
            >
              {props.heading?.trim() || 'Competitor ad audit'}
            </Text>
          </View>
          <View
            className="px-3 py-1 rounded-full border"
            style={{
              borderColor: accentColor,
              backgroundColor: withFluxAlpha(accentColor, '18'),
            }}
          >
            <Text className="text-xs font-instrument-semibold" style={{ color: accentColor, fontFamily: headingFont }}>
              {statusLabel(props.status)}
            </Text>
          </View>
        </View>

        {props.status === 'error' && props.errorMessage ? (
          <View className="p-4 mb-4" style={presentation.card}>
            <Text className="text-sm leading-6" style={{ color: presentation.errorColor, fontFamily: bodyFont }}>
              {props.errorMessage}
            </Text>
          </View>
        ) : null}

        {props.status === 'pending' || props.status === 'running' ? (
          <View className="p-4 md:p-5" style={introCardStyle}>
            <Text
              className="text-sm md:text-base leading-6"
              style={{ color: theme.textColor, opacity: presentation.mutedTextOpacity, fontFamily: bodyFont }}
            >
              {props.status === 'running'
                ? discoveryMode === 'curated_domains'
                  ? 'We are scanning Google Ads Transparency for the curated competitor list and assembling a cleaner read on who is active in this market, what they emphasize, and where you can out-position them. Refresh in a minute.'
                  : 'We are scanning Google Ads Transparency and assembling a cleaner read on who is active nearby, what they emphasize, and where you can out-position them. Refresh in a minute.'
                : discoveryMode === 'curated_domains'
                  ? 'Run the competitor audit from the prospect editor when you are ready. It needs at least three curated competitor domains from the template or the prospect override.'
                  : 'Run the competitor audit from the prospect editor when you are ready. It needs a saved service area on the prospect before we can map nearby advertisers and pull example creatives.'}
            </Text>
          </View>
        ) : null}

        {props.status === 'ready' && props.competitors.length > 0 ? (
          <View className={complexLayout === 'editorial' ? 'gap-0' : 'gap-5'}>
            {props.competitors.map((row, i) => {
              const advertiserUrl = row.examples[0]?.sourceUrl
                ? advertiserUrlFromSourceUrl(row.examples[0].sourceUrl)
                : null;
              const advertiserLinkLabel = formatAdvertiserLinkLabel(props.advertiserLinkLabel, row.name);
              const examples = row.examples.length > 0 ? (
                <View className="gap-3 mt-5">
                  <Text
                    className="text-[11px] uppercase tracking-[2px]"
                    style={{ color: theme.textColor, opacity: presentation.subtleTextOpacity, fontFamily: headingFont }}
                  >
                    Current Ads They Are Running
                  </Text>
                  <View className="flex-row flex-wrap gap-3">
                    {row.examples.map((ex, j) => (
                      <Pressable
                        key={`${ex.sourceUrl}-${j}`}
                        className="w-full md:flex-1 md:min-w-[220px] overflow-hidden"
                        style={[
                          { borderRadius: presentation.radii.media },
                          ex.imageUrl?.trim() ? null : presentation.card,
                        ]}
                        onPress={() => Linking.openURL(ex.sourceUrl)}
                      >
                        {ex.imageUrl?.trim() ? (
                          <Image
                            source={{ uri: ex.imageUrl.trim() }}
                            className="w-full h-56"
                            resizeMode={fluxImageResizeMode(props.exampleImageFit, 'contain')}
                          />
                        ) : (
                          <View className="min-h-56 p-4 justify-between gap-3">
                            <View className="gap-2">
                              <Text
                                className="text-[11px] uppercase tracking-[2px]"
                                style={{ color: accentColor, fontFamily: headingFont }}
                              >
                                Live ad detected
                              </Text>
                              <Text className="text-base" style={{ color: headingColor, fontFamily: headingFont }}>
                                {ex.headline?.trim() || 'Google Ad example'}
                              </Text>
                              <Text
                                className="text-sm leading-6"
                                style={{ color: theme.textColor, opacity: presentation.mutedTextOpacity, fontFamily: bodyFont }}
                              >
                                {ex.body?.trim() || 'Preview unavailable for this ad creative, but the Transparency record is still included.'}
                              </Text>
                            </View>
                            <Text className="text-sm" style={{ color: accentColor, fontFamily: headingFont }}>
                              View ad details →
                            </Text>
                          </View>
                        )}
                      </Pressable>
                    ))}
                  </View>
                </View>
              ) : null;

              if (complexLayout === 'editorial') {
                const isReversed = i % 2 === 1;
                const textCol = (
                  <View className="flex-[2] min-w-[220px] gap-3">
                    <Text className="text-xl md:text-2xl" style={{ color: headingColor, fontFamily: headingFont }}>
                      {row.name}
                    </Text>
                    {advertiserUrl ? (
                      <AdvertiserLinkButton
                        label={advertiserLinkLabel}
                        url={advertiserUrl}
                        buttonStyle={advertiserButtonStyle}
                        labelStyle={advertiserButtonTextStyle}
                      />
                    ) : null}
                  </View>
                );
                const mapCol = row.mapImageUrl ? (
                  <View className="flex-[1] min-w-[140px] gap-2">
                    <Text
                      className="text-[11px] uppercase tracking-[2px]"
                      style={{ color: theme.textColor, opacity: presentation.subtleTextOpacity, fontFamily: headingFont }}
                    >
                      Market view
                    </Text>
                    <Image
                      source={{ uri: row.mapImageUrl }}
                      className="w-full h-44 bg-gray-100"
                      style={{ borderRadius: presentation.radii.media }}
                      resizeMode={fluxImageResizeMode(props.mapImageFit, 'cover')}
                    />
                  </View>
                ) : null;

                return (
                  <View
                    key={`${row.name}-${i}`}
                    className="py-8"
                    style={i > 0 ? { borderTopWidth: 1, borderColor: withFluxAlpha(accentColor, '20') } : undefined}
                  >
                    <Text
                      className="text-[10px] uppercase tracking-[3px] mb-4"
                      style={{ color: accentColor, opacity: 0.7, fontFamily: headingFont }}
                    >
                      Competitor {i + 1}
                    </Text>
                    <View className="flex-row flex-wrap gap-6">
                      {isReversed ? mapCol : textCol}
                      {isReversed ? textCol : mapCol}
                    </View>
                    {examples}
                  </View>
                );
              }

              return (
                <View key={`${row.name}-${i}`} className="p-5 md:p-6 gap-5" style={presentation.strongCard}>
                  <View className="flex-row flex-wrap gap-5 items-start">
                    <View className="flex-1 min-w-[280px] gap-4">
                      <View className="gap-3">
                        <View className="flex-row flex-wrap items-center gap-3">
                          <View
                            className="px-2.5 py-1"
                            style={{ ...presentation.chip, backgroundColor: withFluxAlpha(accentColor, '16') }}
                          >
                            <Text className="text-xs" style={{ color: accentColor, fontFamily: headingFont }}>
                              Competitor {i + 1}
                            </Text>
                          </View>
                          <Text className="text-xl md:text-2xl flex-1" style={{ color: headingColor, fontFamily: headingFont }}>
                            {row.name}
                          </Text>
                        </View>
                      </View>

                      {advertiserUrl ? (
                        <AdvertiserLinkButton
                          label={advertiserLinkLabel}
                          url={advertiserUrl}
                          buttonStyle={advertiserButtonStyle}
                          labelStyle={advertiserButtonTextStyle}
                        />
                      ) : null}
                    </View>

                    {row.mapImageUrl ? (
                      <View className="w-full lg:w-64 gap-2 shrink-0">
                        <Text
                          className="text-[11px] uppercase tracking-[2px]"
                          style={{ color: theme.textColor, opacity: presentation.subtleTextOpacity, fontFamily: headingFont }}
                        >
                          Market view
                        </Text>
                        <View className="overflow-hidden rounded-xl" style={presentation.card}>
                          <Image
                            source={{ uri: row.mapImageUrl }}
                            className="w-full h-44 bg-gray-100"
                            resizeMode={fluxImageResizeMode(props.mapImageFit, 'cover')}
                          />
                        </View>
                      </View>
                    ) : null}
                  </View>
                  {examples}
                </View>
              );
            })}
          </View>
        ) : null}
      </View>
    </View>
  );
}
