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

type StrategySignal = {
  id: string;
  patterns: RegExp[];
  label: string;
};

const STRATEGY_SIGNALS: StrategySignal[] = [
  {
    id: 'offers',
    patterns: [/\bfree\b/i, /\bdiscount\b/i, /\bsave\b/i, /\bspecial\b/i, /\bcoupon\b/i, /\bquote\b/i],
    label: 'offers',
  },
  {
    id: 'speed',
    patterns: [/\bsame day\b/i, /\b24\/7\b/i, /\bemergency\b/i, /\bfast\b/i, /\bquick\b/i, /\btoday\b/i],
    label: 'speed and urgency',
  },
  {
    id: 'trust',
    patterns: [/\breview/i, /\btrusted\b/i, /\blicensed\b/i, /\binsured\b/i, /\bexpert/i, /\byears?\b/i],
    label: 'trust signals',
  },
  {
    id: 'local',
    patterns: [/\blocal\b/i, /\bnear you\b/i, /\bserving\b/i, /\bnearby\b/i, /\bcommunity\b/i],
    label: 'local relevance',
  },
  {
    id: 'quality',
    patterns: [/\bquality\b/i, /\bpremium\b/i, /\bcustom\b/i, /\bluxury\b/i, /\bcraftsmanship\b/i],
    label: 'quality positioning',
  },
  {
    id: 'cta',
    patterns: [/\bcall now\b/i, /\bbook\b/i, /\bschedule\b/i, /\bcontact us\b/i, /\bget started\b/i],
    label: 'direct calls to action',
  },
];

function joinLabels(values: string[]): string {
  if (values.length === 0) return '';
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(', ')}, and ${values[values.length - 1]}`;
}

function quotedExamples(values: string[]): string {
  return joinLabels(values.map((value) => `"${value}"`));
}

function formatAuditDate(value: string): string {
  const parsed = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function summarizeAdPresence(adsSummary: string): string {
  const countMatch = adsSummary.match(/~?(\d+)\s+ads?/i);
  const recentMatch = adsSummary.match(/(?:most recent creative shown|last shown)\s+([^.;]+)/i);
  const count = countMatch ? Number.parseInt(countMatch[1] ?? '', 10) : null;
  const recent = recentMatch?.[1]?.trim();

  let activity = 'They seem to have an active Google Ads presence.';
  if (typeof count === 'number' && Number.isFinite(count)) {
    if (count <= 2) activity = 'They only show a small ad footprint right now.';
    else if (count < 10) activity = 'They seem to be advertising pretty consistently.';
    else if (count < 25) activity = 'They look fairly active in Google Ads right now.';
    else activity = 'They look very active in Google Ads right now.';
  }

  if (recent) {
    return `${activity} The creative we found was showing as recently as ${formatAuditDate(recent)}.`;
  }
  return activity;
}

function advertiserUrlFromSourceUrl(sourceUrl: string): string {
  const match = sourceUrl.match(/^(https:\/\/adstransparency\.google\.com\/advertiser\/[^/]+)/i);
  return match?.[1] ?? sourceUrl;
}

function textCorpus(row: CompetitorAdAuditBlockProps['competitors'][number]): string {
  return [row.adsSummary, ...row.examples.flatMap((example) => [example.headline, example.body])]
    .filter(Boolean)
    .join(' ');
}

function matchedSignals(row: CompetitorAdAuditBlockProps['competitors'][number]): StrategySignal[] {
  const corpus = textCorpus(row);
  return STRATEGY_SIGNALS.filter((signal) => signal.patterns.some((pattern) => pattern.test(corpus))).slice(0, 3);
}

function buildAuditSummary(row: CompetitorAdAuditBlockProps['competitors'][number]): string {
  const signals = matchedSignals(row);
  const presence = summarizeAdPresence(row.adsSummary);
  if (signals.length > 0) {
    return `${presence} Their messaging leans on ${joinLabels(signals.map((signal) => signal.label))}.`;
  }
  const repeatedHooks = row.examples
    .map((example) => example.headline?.trim())
    .filter((headline): headline is string => Boolean(headline))
    .slice(0, 2);
  if (repeatedHooks.length > 0) {
    return `${presence} You can see the same hooks repeating in lines like ${quotedExamples(repeatedHooks)}.`;
  }
  return `${presence} Overall, the creative feels short, direct, and built to get a quick click.`;
}

export function CompetitorAdAuditBlock({ props }: { props: CompetitorAdAuditBlockProps }) {
  const theme = useFluxTheme();
  const presentation = useFluxPresentation();
  const complexLayout = presentation.layouts.complex;
  const headingFont = fluxPreviewFontFamily(theme.fontFamily, '600');
  const bodyFont = fluxPreviewFontFamily(theme.fontFamily, '400');
  const outerBackground = theme.backgroundColor;
  const frameClassName = complexLayout === 'dashboard' ? 'w-full max-w-5xl self-center' : 'w-full max-w-4xl self-center';
  const introCardStyle =
    complexLayout === 'soft'
      ? presentation.tintedCard
      : complexLayout === 'dashboard'
        ? presentation.strongCard
        : presentation.card;

  return (
    <View className="w-full py-10 px-4 md:px-6" style={{ backgroundColor: outerBackground }}>
      <View className={frameClassName}>
        <View className="flex-row flex-wrap items-start justify-between gap-3 mb-5">
          <View className="flex-1 min-w-[260px]">
            <Text
              className="text-[10px] md:text-xs uppercase tracking-[3px] mb-2"
              style={{ color: theme.primaryColor, fontFamily: headingFont }}
            >
              Competitive ad snapshot
            </Text>
            <Text
              className="text-2xl md:text-3xl"
              style={{ color: theme.textColor, fontFamily: headingFont }}
            >
              {props.heading?.trim() || 'Competitor ad audit'}
            </Text>
          </View>
          <View
            className="px-3 py-1 rounded-full border"
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
          <View className="p-4 mb-4" style={presentation.card}>
            <Text className="text-sm leading-6" style={{ color: '#b91c1c', fontFamily: bodyFont }}>
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
                ? 'We are scanning Google Ads Transparency and assembling a cleaner read on who is active nearby, what they emphasize, and where you can out-position them. Refresh in a minute.'
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
              const examplesWithImage = row.examples.filter((ex) => ex.imageUrl?.trim());
              const examples = examplesWithImage.length > 0 ? (
                <View className="gap-3 mt-5">
                  <Text
                    className="text-[11px] uppercase tracking-[2px]"
                    style={{ color: theme.textColor, opacity: presentation.subtleTextOpacity, fontFamily: headingFont }}
                  >
                    Example creatives
                  </Text>
                  <View className="flex-row flex-wrap gap-3">
                    {examplesWithImage.map((ex, j) => (
                      <Pressable
                        key={`${ex.sourceUrl}-${j}`}
                        className="w-full md:flex-1 md:min-w-[220px] overflow-hidden"
                        style={{ borderRadius: presentation.radii.media }}
                        onPress={() => Linking.openURL(ex.sourceUrl)}
                      >
                        <Image
                          source={{ uri: ex.imageUrl!.trim() }}
                          className="w-full h-56"
                          resizeMode="contain"
                        />
                      </Pressable>
                    ))}
                  </View>
                </View>
              ) : null;

              if (complexLayout === 'editorial') {
                const isReversed = i % 2 === 1;
                const textCol = (
                  <View className="flex-[2] min-w-[220px] gap-3">
                    <Text className="text-xl md:text-2xl" style={{ color: theme.textColor, fontFamily: headingFont }}>
                      {row.name}
                    </Text>
                    <Text className="text-sm leading-6 md:text-[15px]" style={{ color: theme.textColor, opacity: presentation.mutedTextOpacity, fontFamily: bodyFont }}>
                      {buildAuditSummary(row)}
                    </Text>
                    {advertiserUrl ? (
                      <Pressable className="self-start" onPress={() => Linking.openURL(advertiserUrl)}>
                        <Text className="text-sm" style={{ color: theme.primaryColor, fontFamily: headingFont }}>
                          {`View ${row.name}'s Google Ads →`}
                        </Text>
                      </Pressable>
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
                      resizeMode="cover"
                    />
                  </View>
                ) : null;

                return (
                  <View
                    key={`${row.name}-${i}`}
                    className="py-8"
                    style={i > 0 ? { borderTopWidth: 1, borderColor: `${theme.primaryColor}20` } : undefined}
                  >
                    <Text
                      className="text-[10px] uppercase tracking-[3px] mb-4"
                      style={{ color: theme.primaryColor, opacity: 0.7, fontFamily: headingFont }}
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
                          <View className="px-2.5 py-1" style={{ ...presentation.chip, backgroundColor: `${theme.primaryColor}16` }}>
                            <Text className="text-xs" style={{ color: theme.primaryColor, fontFamily: headingFont }}>
                              Competitor {i + 1}
                            </Text>
                          </View>
                          <Text className="text-xl md:text-2xl flex-1" style={{ color: theme.textColor, fontFamily: headingFont }}>
                            {row.name}
                          </Text>
                        </View>
                        <Text className="text-sm leading-6 md:text-[15px]" style={{ color: theme.textColor, fontFamily: bodyFont }}>
                          {buildAuditSummary(row)}
                        </Text>
                      </View>

                      {advertiserUrl ? (
                        <Pressable
                          className="self-start px-3 py-2 rounded-lg min-h-[44px] justify-center"
                          style={{ backgroundColor: `${theme.primaryColor}08` }}
                          onPress={() => Linking.openURL(advertiserUrl)}
                        >
                          <Text className="text-sm" style={{ color: theme.primaryColor, fontFamily: headingFont }}>
                            {`See all of ${row.name}'s Google Ads`}
                          </Text>
                        </Pressable>
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
                            resizeMode="cover"
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
