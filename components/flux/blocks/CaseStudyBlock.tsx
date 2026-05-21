import React from 'react';
import { View, Text, Image } from 'react-native';
import type { ContentAsset, FluxImageFit } from '@/lib/flux/types';
import { fluxImageResizeMode } from '@/lib/flux/fluxImageFit';
import { fluxPreviewFontFamily } from '@/lib/flux/fluxPreviewFontFamily';
import { withFluxAlpha } from '@/lib/flux/fluxPresentationTokens';
import { useFluxPresentation, useFluxTheme } from '../FluxThemeProvider';

interface CaseStudyBlockDisplayProps {
  asset: ContentAsset | undefined;
  overrideTitle?: string;
  overrideMetric?: string;
  overrideImageUrl?: string;
  imageFit?: FluxImageFit;
}

export function CaseStudyBlock({
  asset,
  overrideTitle,
  overrideMetric,
  overrideImageUrl,
  imageFit,
}: CaseStudyBlockDisplayProps) {
  const theme = useFluxTheme();
  const presentation = useFluxPresentation();
  if (!asset) return null;

  const title = overrideTitle || asset.title;
  const metric = overrideMetric || asset.metric;
  const imageUrl = overrideImageUrl?.trim() || asset.imageUrl?.trim() || undefined;
  const headingFont = fluxPreviewFontFamily(theme.fontFamily, '600');
  const bodyFont = fluxPreviewFontFamily(theme.fontFamily, '400');
  const bodyStyle = {
    color: theme.textColor,
    opacity: presentation.mutedTextOpacity,
    fontFamily: bodyFont,
  };

  if (presentation.layouts.caseStudy === 'report') {
    return (
      <View className="w-full py-12 px-5 md:px-10" style={{ backgroundColor: theme.backgroundColor }}>
        <View className="w-full max-w-3xl self-center border-l pl-5 md:pl-8" style={{ borderColor: theme.primaryColor, borderLeftWidth: 3 }}>
          <Text className="text-xs uppercase tracking-[3px] mb-3" style={{ color: theme.primaryColor, fontFamily: headingFont }}>
            Case note
          </Text>
          <Text className="text-2xl md:text-4xl leading-tight mb-3" style={{ color: theme.textColor, fontFamily: headingFont }}>
            {title}
          </Text>
          {metric ? (
            <Text className="text-lg md:text-xl mb-4" style={{ color: theme.primaryColor, fontFamily: headingFont }}>{metric}</Text>
          ) : null}
          <Text className="text-sm md:text-base leading-7" style={bodyStyle}>{asset.body}</Text>
          {asset.attribution ? <Text className="text-xs mt-5" style={bodyStyle}>Source: {asset.attribution}</Text> : null}
        </View>
      </View>
    );
  }

  if (presentation.layouts.caseStudy === 'splitMetric') {
    return (
      <View className="w-full py-14 px-4 md:px-8" style={{ backgroundColor: theme.backgroundColor }}>
        <View className="w-full max-w-5xl self-center flex-row flex-wrap overflow-hidden" style={presentation.strongCard}>
          {imageUrl ? (
            <Image
              source={{ uri: imageUrl }}
              className="w-full md:flex-1 h-56 md:h-auto"
              resizeMode={fluxImageResizeMode(imageFit, 'cover')}
            />
          ) : (
            <View
              className="w-full md:flex-1 min-h-[220px]"
              style={{ backgroundColor: withFluxAlpha(theme.primaryColor, '18') }}
            />
          )}
          <View className="w-full md:flex-1 p-6 md:p-8">
            <Text className="text-xs uppercase tracking-[2px] mb-3" style={{ color: theme.primaryColor, fontFamily: headingFont }}>Case Study</Text>
            {metric ? <Text className="text-4xl md:text-5xl mb-4" style={{ color: theme.primaryColor, fontFamily: headingFont }}>{metric}</Text> : null}
            <Text className="text-2xl mb-4" style={{ color: theme.textColor, fontFamily: headingFont }}>{title}</Text>
            <Text className="text-sm leading-6" style={bodyStyle}>{asset.body}</Text>
            {asset.attribution ? <Text className="text-xs mt-5 italic" style={bodyStyle}>— {asset.attribution}</Text> : null}
          </View>
        </View>
      </View>
    );
  }

  if (presentation.layouts.caseStudy === 'storyPanel') {
    return (
      <View className="w-full py-14 px-4 md:px-6" style={{ backgroundColor: theme.backgroundColor }}>
        <View className="w-full max-w-3xl self-center p-5 md:p-8" style={presentation.tintedCard}>
          <Text className="text-xs uppercase tracking-[2px] mb-3" style={{ color: theme.textColor, opacity: 0.62, fontFamily: headingFont }}>Customer story</Text>
          <Text className="text-2xl md:text-4xl leading-tight mb-4" style={{ color: theme.textColor, fontFamily: headingFont }}>{title}</Text>
          {metric ? <Text className="text-3xl mb-4" style={{ color: theme.primaryColor, fontFamily: headingFont }}>{metric}</Text> : null}
          <Text className="text-sm md:text-base leading-7" style={bodyStyle}>{asset.body}</Text>
          {asset.attribution ? <Text className="text-sm mt-5" style={{ color: theme.textColor, fontFamily: headingFont }}>— {asset.attribution}</Text> : null}
        </View>
      </View>
    );
  }

  return (
    <View className="w-full py-12 px-6 items-center" style={{ backgroundColor: theme.backgroundColor }}>
      <View className="w-full max-w-2xl p-6" style={presentation.strongCard}>
        {imageUrl && (
          <Image
            source={{ uri: imageUrl }}
            className="w-full h-40 mb-4"
            style={{ borderRadius: presentation.radii.media }}
            resizeMode={fluxImageResizeMode(imageFit, 'cover')}
          />
        )}
        <Text
          className="text-xs uppercase tracking-wider mb-2"
          style={{ color: theme.primaryColor, fontFamily: bodyFont }}
        >
          Case Study
        </Text>
        <Text className="text-xl mb-2" style={{ color: theme.textColor, fontFamily: headingFont }}>
          {title}
        </Text>
        {metric && (
          <Text className="text-2xl mb-3" style={{ color: theme.primaryColor, fontFamily: headingFont }}>
            {metric}
          </Text>
        )}
        <Text
          className="text-sm leading-6"
          style={{
            color: theme.textColor,
            opacity: presentation.mutedTextOpacity,
            fontFamily: bodyFont,
          }}
        >
          {asset.body}
        </Text>
        {asset.attribution && (
          <Text
            className="text-xs mt-4 italic"
            style={{
              color: theme.textColor,
              opacity: presentation.subtleTextOpacity,
              fontFamily: bodyFont,
            }}
          >
            — {asset.attribution}
          </Text>
        )}
      </View>
    </View>
  );
}
