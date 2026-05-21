import React, { useEffect, useRef } from 'react';
import { Animated, Easing, View, Text, Image } from 'react-native';
import type { ContentAsset, FluxImageFit } from '@/lib/flux/types';
import { fluxImageResizeMode } from '@/lib/flux/fluxImageFit';
import { fluxPreviewFontFamily } from '@/lib/flux/fluxPreviewFontFamily';
import { useFluxPresentation, useFluxTheme } from '../FluxThemeProvider';

export type CaseStudyCarouselItem = {
  asset: ContentAsset | undefined;
  overrideTitle?: string;
  overrideMetric?: string;
  overrideImageUrl?: string;
  imageFit?: FluxImageFit;
};

interface CaseStudyCarouselBlockProps {
  items: CaseStudyCarouselItem[];
}

type ValidCarouselItem = CaseStudyCarouselItem & { asset: ContentAsset };

const CARD_WIDTH = 300;
const CARD_GAP = 16;
const MS_PER_CARD = 3500;

export function CaseStudyCarouselBlock({ items }: CaseStudyCarouselBlockProps) {
  const theme = useFluxTheme();
  const presentation = useFluxPresentation();
  const translateX = useRef(new Animated.Value(0)).current;

  const validItems = items.filter(
    (item): item is ValidCarouselItem => item.asset != null,
  );

  const headingFont = fluxPreviewFontFamily(theme.fontFamily, '600');
  const totalWidth = (CARD_WIDTH + CARD_GAP) * validItems.length;

  useEffect(() => {
    if (validItems.length === 0 || totalWidth === 0) return;

    translateX.setValue(0);
    const animation = Animated.loop(
      Animated.timing(translateX, {
        toValue: -totalWidth,
        duration: MS_PER_CARD * validItems.length,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    animation.start();
    return () => animation.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalWidth, validItems.length]);

  if (validItems.length === 0) return null;

  const doubled = [...validItems, ...validItems];

  return (
    <View
      className="w-full py-12 overflow-hidden"
      style={{ backgroundColor: theme.backgroundColor }}
    >
      <Text
        className="text-xs uppercase tracking-[3px] mb-8 px-6"
        style={{ color: theme.primaryColor, fontFamily: headingFont }}
      >
        Case Studies
      </Text>

      <Animated.View style={{ flexDirection: 'row', transform: [{ translateX }] }}>
        {doubled.map((item, i) => (
          <View key={i} style={{ width: CARD_WIDTH, marginRight: CARD_GAP }}>
            <MarqueeCard item={item} />
          </View>
        ))}
      </Animated.View>
    </View>
  );
}

function MarqueeCard({ item }: { item: ValidCarouselItem }) {
  const theme = useFluxTheme();
  const presentation = useFluxPresentation();
  const headingFont = fluxPreviewFontFamily(theme.fontFamily, '600');
  const bodyFont = fluxPreviewFontFamily(theme.fontFamily, '400');

  const title = item.overrideTitle ?? item.asset.title;
  const imageUrl = item.overrideImageUrl?.trim() || item.asset.imageUrl?.trim() || undefined;

  const resolvedMetrics: Array<{ label: string; value: string }> = (() => {
    if (item.asset.metrics && item.asset.metrics.length > 0) return item.asset.metrics;
    const singleMetric = item.overrideMetric ?? item.asset.metric;
    if (singleMetric) return [{ label: '', value: singleMetric }];
    return [];
  })();

  return (
    <View className="p-5" style={presentation.strongCard}>
      {imageUrl ? (
        <Image
          source={{ uri: imageUrl }}
          style={{ width: '100%', height: 32, marginBottom: 16 }}
          resizeMode={fluxImageResizeMode(item.imageFit, 'contain')}
        />
      ) : null}

      {resolvedMetrics.length > 0 ? (
        <View className="flex-row flex-wrap gap-x-5 gap-y-2 mb-4">
          {resolvedMetrics.map((stat, i) => (
            <View key={i}>
              <Text className="text-2xl" style={{ color: theme.primaryColor, fontFamily: headingFont }}>
                {stat.value}
              </Text>
              {stat.label ? (
                <Text
                  className="text-[10px] uppercase tracking-[2px] mt-0.5"
                  style={{
                    color: theme.textColor,
                    opacity: presentation.mutedTextOpacity,
                    fontFamily: headingFont,
                  }}
                >
                  {stat.label}
                </Text>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}

      <Text
        className="text-[10px] uppercase tracking-[2px]"
        style={{
          color: theme.textColor,
          opacity: presentation.mutedTextOpacity,
          fontFamily: headingFont,
        }}
      >
        {title}
      </Text>

      {item.asset.attribution ? (
        <Text
          className="text-[10px] mt-1 italic"
          style={{
            color: theme.textColor,
            opacity: presentation.subtleTextOpacity,
            fontFamily: bodyFont,
          }}
        >
          {item.asset.attribution}
        </Text>
      ) : null}
    </View>
  );
}
