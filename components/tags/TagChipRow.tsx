import { View, Text } from 'react-native';
import type { TagLike } from '@/lib/tags/types';
import { TagChip, type TagChipVariant } from './TagChip';

export interface TagChipRowProps {
  tags: TagLike[];
  maxVisible?: number;
  /** `pill` — short, no dot (thread list / campaign cards). `default` — panel chips with dot. */
  variant?: TagChipVariant;
}

export function TagChipRow({ tags, maxVisible = 3, variant = 'pill' }: TagChipRowProps) {
  if (tags.length === 0) return null;

  const visibleTags = tags.slice(0, maxVisible);
  const extraCount = tags.length > maxVisible ? tags.length - maxVisible : 0;

  return (
    <View className={`flex-row items-center flex-wrap ${variant === 'pill' ? 'gap-1.5' : 'gap-2'}`}>
      {visibleTags.map((tag) => (
        <TagChip key={tag.id} tag={tag} variant={variant} />
      ))}
      {extraCount > 0 ? (
        <View
          style={{
            backgroundColor: '#2A2A2A',
            borderWidth: 1,
            borderColor: '#3A3A3A',
            borderRadius: 8,
            paddingHorizontal: 8,
            paddingVertical: variant === 'pill' ? 2 : 8,
          }}
        >
          <Text className="text-xs font-instrument text-gray-400">+{extraCount}</Text>
        </View>
      ) : null}
    </View>
  );
}
