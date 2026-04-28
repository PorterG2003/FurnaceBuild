import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { callGooglePlaces } from '@/lib/google/callGooglePlaces';
import {
  parsePlacesAutocompleteSuggestions,
  placeDetailsJsonToFluxServiceArea,
} from '@/lib/google/parsePlacesServiceArea';
import type { FluxServiceArea } from '@/lib/flux/types';

interface FluxServiceAreaFieldProps {
  value: FluxServiceArea | null;
  onChange: (next: FluxServiceArea | null) => void;
  labelClassName?: string;
  inputClassName?: string;
}

export function FluxServiceAreaField({
  value,
  onChange,
  labelClassName = 'text-gray-400 text-xs font-instrument mb-1',
  inputClassName = 'text-white bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl px-4 py-3 text-sm mb-2',
}: FluxServiceAreaFieldProps) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<{ placeId: string; text: string }[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingPick, setLoadingPick] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) {
      setSuggestions([]);
      setLoadingList(false);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoadingList(true);
      setError(null);
      const res = await callGooglePlaces({ action: 'autocomplete', input: q, includedRegionCodes: ['US'] });
      if (cancelled) return;
      setLoadingList(false);
      if (!res.ok) {
        setSuggestions([]);
        setError(res.message);
        return;
      }
      if (res.action !== 'autocomplete') {
        setSuggestions([]);
        return;
      }
      setSuggestions(parsePlacesAutocompleteSuggestions(res.data));
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  const summary = useMemo(() => {
    if (!value) return '';
    return value.displayName?.trim() || value.formattedAddress;
  }, [value]);

  const pick = useCallback(
    async (placeId: string) => {
      setLoadingPick(true);
      setError(null);
      setSuggestions([]);
      const res = await callGooglePlaces({ action: 'placeDetails', placeId });
      setLoadingPick(false);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      if (res.action !== 'placeDetails') {
        setError('Unexpected Places response');
        return;
      }
      const area = placeDetailsJsonToFluxServiceArea(res.data);
      if (!area) {
        setError('Could not read coordinates for that place.');
        return;
      }
      onChange(area);
      setQuery('');
    },
    [onChange],
  );

  return (
    <View className="mb-2">
      <Text className={labelClassName}>Service area (competitor ad audit)</Text>
      <Text className="text-gray-500 text-xs font-instrument mb-2 leading-5">
        Pick the city or region you sell into. We use it to find nearby competitors and center the map.
      </Text>
      {value ? (
        <View className="border border-[#2A2A2A] rounded-xl px-3 py-2 mb-2 bg-[#151515]">
          <Text className="text-white text-sm font-instrument">{summary}</Text>
          <Text className="text-gray-500 text-xs font-instrument mt-0.5">{value.formattedAddress}</Text>
          <Pressable className="mt-2 self-start" onPress={() => onChange(null)} accessibilityRole="button">
            <Text className="text-indigo-300 text-xs font-instrument-semibold">Clear</Text>
          </Pressable>
        </View>
      ) : null}
      <View className="relative">
        <TextInput
          className={inputClassName}
          value={query}
          onChangeText={setQuery}
          placeholder="Start typing an address or city…"
          placeholderTextColor="#555"
          autoCorrect={false}
        />
        {loadingList || loadingPick ? (
          <View className="absolute right-3 top-3">
            <ActivityIndicator size="small" color="#6b7280" />
          </View>
        ) : null}
      </View>
      {suggestions.length > 0 ? (
        <View className="border border-[#333] rounded-xl overflow-hidden mb-2 bg-[#1A1A1A]">
          {suggestions.map((s) => (
            <Pressable
              key={s.placeId}
              className="px-3 py-2.5 border-b border-[#2A2A2A] active:bg-[#252525]"
              onPress={() => void pick(s.placeId)}
            >
              <Text className="text-white text-sm font-instrument">{s.text}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {error ? <Text className="text-red-400 text-xs font-instrument mb-1">{error}</Text> : null}
    </View>
  );
}
