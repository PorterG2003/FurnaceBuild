import { View, Text, Pressable } from 'react-native';
import type { TagLike } from '@/lib/tags/types';
import { hexToPillBackground, isPresetColor, resolveTagColor } from '@/lib/tags/tag-colors';

const CHIP_BORDER_RADIUS = 8;
const CHIP_PADDING_H = 8;
const CHIP_PADDING_V = 8;
const CHIP_GAP = 8;
const DOT_SIZE = 10;

/** Interactive chips in the tags panel (dot, taller). */
export function tagChipContainerStyle(tag: TagLike) {
  return {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: isPresetColor(tag.color)
      ? hexToPillBackground(tag.color!)
      : 'rgba(243, 68, 13, 0.2)',
    borderWidth: 1,
    borderColor: resolveTagColor(tag.color),
    borderRadius: CHIP_BORDER_RADIUS,
    paddingHorizontal: CHIP_PADDING_H,
    paddingVertical: CHIP_PADDING_V,
    gap: CHIP_GAP,
  };
}

/** List / thread row chips — matches category pill sizing in ThreadItem. */
export function tagPillContainerStyle(tag: TagLike) {
  const color = resolveTagColor(tag.color);
  return {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: isPresetColor(tag.color)
      ? hexToPillBackground(tag.color!, 0.15)
      : 'rgba(243, 68, 13, 0.15)',
    borderWidth: 1,
    borderColor: isPresetColor(tag.color) ? `${tag.color}50` : '#3A3A3A',
    borderRadius: CHIP_BORDER_RADIUS,
    paddingHorizontal: 8,
    paddingVertical: 2,
  };
}

function dotStyle(tag: TagLike) {
  return {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
    backgroundColor: resolveTagColor(tag.color),
  };
}

const defaultLabelStyle = { color: '#FFFFFF' as const, fontSize: 12 };

export type TagChipVariant = 'default' | 'pill';

export interface TagChipProps {
  tag: TagLike;
  variant?: TagChipVariant;
  onPress?: () => void;
  onRemove?: () => void;
  showDot?: boolean;
}

export function TagChip({
  tag,
  variant = 'default',
  onPress,
  onRemove,
  showDot,
}: TagChipProps) {
  if (variant === 'pill') {
    const label = (
      <Text
        className="text-xs font-instrument"
        style={{ color: resolveTagColor(tag.color) }}
        numberOfLines={1}
      >
        {tag.name}
      </Text>
    );

    return (
      <View style={tagPillContainerStyle(tag)}>
        {onPress ? <Pressable onPress={onPress}>{label}</Pressable> : label}
      </View>
    );
  }

  const displayDot = showDot ?? true;
  const content = (
    <>
      {displayDot ? <View style={dotStyle(tag)} /> : null}
      <Text style={defaultLabelStyle} numberOfLines={1}>
        {tag.name}
      </Text>
    </>
  );

  return (
    <View style={tagChipContainerStyle(tag)}>
      {onPress ? (
        <Pressable
          onPress={onPress}
          style={{ flexDirection: 'row', alignItems: 'center', gap: CHIP_GAP }}
        >
          {content}
        </Pressable>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: CHIP_GAP }}>{content}</View>
      )}
      {onRemove ? (
        <Pressable onPress={onRemove} hitSlop={8} style={{ padding: 4 }}>
          <Text style={{ color: '#9CA3AF', fontSize: 14 }}>×</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
