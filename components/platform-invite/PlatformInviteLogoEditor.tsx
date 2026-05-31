import React from 'react';
import { Text, TextInput, View } from 'react-native';
import {
  authInputClassName,
  authInputStyle,
  authPlaceholderColor,
} from '@/components/auth/authFormStyles';
import { AdminField } from '@/components/admin/account-management/shared';
import { PreviewRangeControl } from '@/components/platform-invite/PreviewRangeControl';

export const CLIENT_LOGO_SCALE_MIN = 0.5;
export const CLIENT_LOGO_SCALE_MAX = 1.5;
export const CLIENT_LOGO_SCALE_STEP = 0.05;
export const CLIENT_LOGO_OFFSET_MIN = -80;
export const CLIENT_LOGO_OFFSET_MAX = 80;
export const CLIENT_LOGO_OFFSET_STEP = 4;

export function PlatformInviteLogoEditor({
  logoUrl,
  logoScale,
  logoOffsetX,
  onLogoUrlChange,
  onLogoScaleChange,
  onLogoOffsetChange,
}: {
  logoUrl: string;
  logoScale: number;
  logoOffsetX: number;
  onLogoUrlChange: (value: string) => void;
  onLogoScaleChange: (value: number) => void;
  onLogoOffsetChange: (value: number) => void;
}) {
  const hasLogoUrl = logoUrl.trim().length > 0;

  return (
    <View className="gap-4 rounded-2xl border border-[#2A2A2A] bg-[#181818] p-5">
      <View className="gap-1">
        <Text className="text-white font-instrument-semibold">Logo layout</Text>
        <Text className="text-gray-400 font-instrument text-sm">
          Add the client logo, then fine-tune its scale and horizontal position while watching the
          live preview update.
        </Text>
      </View>

      <AdminField label="Client logo URL">
        <TextInput
          value={logoUrl}
          onChangeText={onLogoUrlChange}
          placeholder="https://example.com/logo.png"
          placeholderTextColor={authPlaceholderColor}
          className={authInputClassName}
          style={authInputStyle}
          autoCapitalize="none"
        />
      </AdminField>

      {hasLogoUrl ? (
        <View className="gap-4">
          <AdminField label="Client logo scale">
            <PreviewRangeControl
              value={logoScale}
              min={CLIENT_LOGO_SCALE_MIN}
              max={CLIENT_LOGO_SCALE_MAX}
              step={CLIENT_LOGO_SCALE_STEP}
              onChange={onLogoScaleChange}
              formatValue={(value) => `${Math.round(value * 100)}%`}
            />
          </AdminField>
          <AdminField label="Client logo horizontal position">
            <PreviewRangeControl
              value={logoOffsetX}
              min={CLIENT_LOGO_OFFSET_MIN}
              max={CLIENT_LOGO_OFFSET_MAX}
              step={CLIENT_LOGO_OFFSET_STEP}
              onChange={onLogoOffsetChange}
              formatValue={(value) => `${value > 0 ? '+' : ''}${Math.round(value)}px`}
            />
          </AdminField>
        </View>
      ) : (
        <Text className="text-gray-500 font-instrument text-sm">
          Add a client logo URL to unlock sizing and position controls.
        </Text>
      )}
    </View>
  );
}
