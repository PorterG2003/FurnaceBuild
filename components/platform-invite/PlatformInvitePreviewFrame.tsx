import React, { useMemo, useState } from 'react';
import { Platform, Pressable, Text, useWindowDimensions, View } from 'react-native';

export type PlatformInvitePreviewViewport = 'mobile' | 'desktop';
const DEFAULT_PREVIEW_SCALE = 0.82;

const PREVIEW_VIEWPORTS: Record<
  PlatformInvitePreviewViewport,
  { width: number; height: number; label: string }
> = {
  mobile: { width: 390, height: 844, label: 'Mobile' },
  desktop: { width: 1024, height: 900, label: 'Desktop' },
};

type Props = {
  variant: 'iframe' | 'inline';
  iframeSrc?: string | null;
  children?: React.ReactNode;
  label?: string;
  headerRight?: React.ReactNode;
  showControls?: boolean;
  initialViewport?: PlatformInvitePreviewViewport;
};

export function PlatformInvitePreviewFrame({
  variant,
  iframeSrc,
  children,
  label,
  headerRight,
  showControls = true,
  initialViewport = 'mobile',
}: Props) {
  const { width: windowWidth } = useWindowDimensions();
  const [viewport, setViewport] = useState<PlatformInvitePreviewViewport>(initialViewport);

  const viewportConfig = PREVIEW_VIEWPORTS[viewport];
  const availableWidth = Math.max(320, windowWidth - 120);
  const effectiveZoom = Math.min(DEFAULT_PREVIEW_SCALE, availableWidth / viewportConfig.width);
  const shellWidth = viewportConfig.width * effectiveZoom;
  const shellHeight = viewportConfig.height * effectiveZoom;

  const scaledStyle = useMemo(() => {
    if (Platform.OS === 'web') {
      return {
        width: viewportConfig.width,
        height: viewportConfig.height,
        transform: `scale(${effectiveZoom})`,
        transformOrigin: 'top left',
      } as React.CSSProperties;
    }

    return {
      width: viewportConfig.width,
      height: viewportConfig.height,
      transform: [{ scale: effectiveZoom }],
    } as const;
  }, [effectiveZoom, viewportConfig.height, viewportConfig.width]);

  const renderViewportToggle = (option: PlatformInvitePreviewViewport) => {
    const selected = viewport === option;
    return (
      <Pressable
        key={option}
        onPress={() => setViewport(option)}
        className={`rounded-lg border px-3 py-2 ${
          selected ? 'border-brand-orange bg-brand-orange/10' : 'border-[#2A2A2A] bg-[#121212]'
        }`}
      >
        <Text
          className={
            selected
              ? 'text-brand-orange font-instrument-medium'
              : 'text-gray-300 font-instrument'
          }
        >
          {PREVIEW_VIEWPORTS[option].label}
        </Text>
      </Pressable>
    );
  };

  const renderFrameBody = () => {
    if (variant === 'iframe') {
      if (!iframeSrc) {
        return (
          <View className="rounded-2xl border border-dashed border-[#2A2A2A] bg-[#121212] p-6">
            <Text className="text-sm text-gray-400 font-instrument">
              Complete the required invite fields to load the embedded preview.
            </Text>
          </View>
        );
      }

      if (Platform.OS !== 'web') {
        return (
          <View className="rounded-2xl border border-[#2A2A2A] bg-[#121212] p-6">
            <Text className="text-sm text-gray-400 font-instrument">
              Embedded preview is only available in a browser.
            </Text>
          </View>
        );
      }

      return React.createElement(
        'div',
        {
          style: {
            width: shellWidth,
            height: shellHeight,
            overflow: 'hidden',
            borderRadius: 24,
            border: '1px solid #2A2A2A',
            backgroundColor: '#121212',
          },
        },
        React.createElement('iframe', {
          src: iframeSrc,
          style: {
            ...scaledStyle,
            border: '0',
            backgroundColor: '#121212',
          },
        }),
      );
    }

    return (
      <View
        style={{
          width: shellWidth,
          height: shellHeight,
          overflow: 'hidden',
          borderRadius: 24,
          borderWidth: 1,
          borderColor: '#2A2A2A',
          backgroundColor: '#121212',
        }}
      >
        <View style={scaledStyle}>{children}</View>
      </View>
    );
  };

  return (
    <View className="gap-4">
      {showControls ? (
        <View className="flex-row items-center justify-between gap-4">
          <Text className="text-white text-lg font-instrument-semibold">Preview</Text>
          <View className="flex-row items-center gap-3">
            {headerRight}
            <View className="flex-row gap-2">
              {renderViewportToggle('mobile')}
              {renderViewportToggle('desktop')}
            </View>
          </View>
        </View>
      ) : null}

      {label ? (
        <Text className="text-sm text-gray-400 font-instrument">{label}</Text>
      ) : null}

      <View className="items-center justify-center overflow-hidden">
        {renderFrameBody()}
      </View>
    </View>
  );
}
