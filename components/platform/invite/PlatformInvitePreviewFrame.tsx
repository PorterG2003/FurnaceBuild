import React, { useMemo, useState } from 'react';
import { Platform, Pressable, Text, useWindowDimensions, View } from 'react-native';

export type PlatformInvitePreviewViewport = 'mobile' | 'desktop';
const DEFAULT_PREVIEW_SCALE = 0.82;

export const PREVIEW_VIEWPORT_OPTIONS: Array<{
  id: PlatformInvitePreviewViewport;
  label: string;
}> = [
  { id: 'mobile', label: 'Mobile' },
  { id: 'desktop', label: 'Desktop' },
];

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
  /** When false, hides the inner "Preview" title while keeping viewport toggles. */
  showTitle?: boolean;
  initialViewport?: PlatformInvitePreviewViewport;
  viewport?: PlatformInvitePreviewViewport;
  onViewportChange?: (viewport: PlatformInvitePreviewViewport) => void;
  /** When false, viewport toggles are hidden (use an external dropdown instead). */
  showViewportControls?: boolean;
  /** Optional local width constraint when embedding inside a narrower pane. */
  availableWidth?: number;
  /** Optional local height constraint when embedding inside a shorter pane. */
  availableHeight?: number;
};

export function PlatformInvitePreviewFrame({
  variant,
  iframeSrc,
  children,
  label,
  headerRight,
  showControls = true,
  showTitle = true,
  initialViewport = 'mobile',
  viewport: controlledViewport,
  onViewportChange,
  showViewportControls = true,
  availableWidth,
  availableHeight,
}: Props) {
  const { width: windowWidth } = useWindowDimensions();
  const [uncontrolledViewport, setUncontrolledViewport] =
    useState<PlatformInvitePreviewViewport>(initialViewport);
  const viewport = controlledViewport ?? uncontrolledViewport;

  const setViewport = (nextViewport: PlatformInvitePreviewViewport) => {
    if (controlledViewport == null) {
      setUncontrolledViewport(nextViewport);
    }
    onViewportChange?.(nextViewport);
  };

  const viewportConfig = PREVIEW_VIEWPORTS[viewport];
  const computedAvailableWidth = Math.max(320, availableWidth ?? windowWidth - 120);
  const computedAvailableHeight = Math.max(320, availableHeight ?? viewportConfig.height);
  const effectiveZoom = Math.min(
    DEFAULT_PREVIEW_SCALE,
    computedAvailableWidth / viewportConfig.width,
    computedAvailableHeight / viewportConfig.height
  );
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
          <View className="rounded-2xl border border-dashed border-[#2A2A2A] bg-[#121212] p-6">
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
          sandbox: 'allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox',
          title: label ?? 'Embedded preview',
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

  const showHeaderControls = showControls && (showTitle || headerRight || showViewportControls);

  return (
    <View className="gap-4">
      {showHeaderControls ? (
        <View
          className={`flex-row items-center gap-4 ${
            showTitle ? 'justify-between' : 'justify-end'
          }`}
        >
          {showTitle ? (
            <Text className="text-white text-lg font-instrument-semibold">Preview</Text>
          ) : null}
          <View className="flex-row items-center gap-3">
            {headerRight}
            {showViewportControls ? (
              <View className="flex-row gap-2">
                {renderViewportToggle('mobile')}
                {renderViewportToggle('desktop')}
              </View>
            ) : null}
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
