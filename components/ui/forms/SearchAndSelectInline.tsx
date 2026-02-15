import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
} from 'react-native';
import { MagnifyingGlassIcon } from 'react-native-heroicons/outline';

export interface SearchAndSelectInlineProps<T> {
  items: T[];
  getItemId: (item: T) => string;
  getItemLabel: (item: T) => { primary: string; secondary?: string };
  value: string | null;
  onChange: (id: string, item: T | null) => void;
  label?: string;
  searchPlaceholder?: string;
  placeholder?: string;
  emptyMessage?: (hasSearch: boolean) => string;
  listMaxHeight?: number;
}

const defaultEmptyMessage = (hasSearch: boolean) =>
  hasSearch ? 'No results.' : 'No items.';

export function SearchAndSelectInline<T>({
  items,
  getItemId,
  getItemLabel,
  value,
  onChange,
  label,
  searchPlaceholder = 'Search…',
  placeholder = 'Select…',
  emptyMessage = defaultEmptyMessage,
  listMaxHeight = 140,
}: SearchAndSelectInlineProps<T>) {
  const [search, setSearch] = useState('');

  const filteredItems = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.trim().toLowerCase();
    return items.filter((item) => {
      const { primary } = getItemLabel(item);
      return primary.toLowerCase().includes(q);
    });
  }, [items, search, getItemLabel]);

  const rowStyle = (isSelected: boolean) => ({
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    marginBottom: 6,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    borderWidth: 1,
    ...(isSelected
      ? { backgroundColor: 'rgba(243, 68, 13, 0.14)', borderColor: 'rgba(243, 68, 13, 0.4)' }
      : { backgroundColor: '#121212', borderColor: '#2A2A2A' }),
  });

  return (
    <View style={{ marginBottom: 12 }}>
      {label != null && (
        <Text className="text-xs font-instrument-medium mb-2 text-gray-400">
          {label}
        </Text>
      )}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: '#FFFFFF0D',
          borderRadius: 10,
          borderWidth: 1,
          borderColor: '#FFFFFF4D',
          paddingHorizontal: 10,
          paddingVertical: 8,
          marginBottom: 8,
        }}
      >
        <MagnifyingGlassIcon size={16} color="#9CA3AF" style={{ marginRight: 8 }} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder={searchPlaceholder}
          placeholderTextColor="#666"
          style={{
            flex: 1,
            color: '#FFFFFF',
            fontSize: 14,
            fontFamily: 'Instrument Sans, system-ui, sans-serif',
            paddingVertical: 0,
          }}
          selectionColor="#FF4D00"
          underlineColorAndroid="transparent"
        />
      </View>
      {filteredItems.length === 0 ? (
        <Text className="text-gray-500 text-sm font-instrument py-4">
          {emptyMessage(search.trim().length > 0)}
        </Text>
      ) : (
        <ScrollView
          style={{ maxHeight: listMaxHeight }}
          showsVerticalScrollIndicator
          nestedScrollEnabled
          keyboardShouldPersistTaps="handled"
        >
          {filteredItems.map((item) => {
            const id = getItemId(item);
            const { primary, secondary } = getItemLabel(item);
            const isSelected = value === id;
            return (
              <Pressable
                key={id}
                onPress={() => onChange(id, item)}
                style={rowStyle(isSelected)}
              >
                <View style={{ flex: 1 }}>
                  <Text className="text-white font-instrument-medium text-sm" numberOfLines={1}>
                    {primary}
                  </Text>
                  {secondary != null && secondary !== '' && (
                    <Text className="text-gray-400 text-xs mt-0.5" numberOfLines={1}>
                      {secondary}
                    </Text>
                  )}
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}
