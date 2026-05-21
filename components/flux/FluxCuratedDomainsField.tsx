import React, { useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import type { FluxCuratedDomainSeed } from '@/lib/flux/types';
import fluxCompetitorAuditDiscovery from '@/lib/flux/fluxCompetitorAuditDiscovery';

interface FluxCuratedDomainsFieldProps {
  value: FluxCuratedDomainSeed[] | null | undefined;
  onChange: (next: FluxCuratedDomainSeed[] | null) => void;
  labelClassName?: string;
  inputClassName?: string;
  title?: string;
  helperText?: string;
}

export function FluxCuratedDomainsField({
  value,
  onChange,
  labelClassName = 'text-gray-400 text-xs font-instrument mb-1',
  inputClassName = 'text-white bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl px-4 py-3 text-sm mb-2',
  title = 'Competitor domains',
  helperText,
}: FluxCuratedDomainsFieldProps) {
  const rows = useMemo(() => value ?? [], [value]);
  const [errors, setErrors] = useState<Record<number, string>>({});

  const setRows = (next: FluxCuratedDomainSeed[]) => {
    onChange(next.length > 0 ? next : null);
    setErrors((current) => {
      const filtered = Object.fromEntries(Object.entries(current).filter(([key]) => Number(key) < next.length));
      return filtered;
    });
  };

  const updateRow = (index: number, patch: Partial<FluxCuratedDomainSeed>) => {
    const next = rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row));
    setRows(next);
  };

  const normalizeDomain = (index: number) => {
    const row = rows[index];
    if (!row) return;
    const raw = row.domain.trim();
    if (!raw) {
      setErrors((current) => {
        const next = { ...current };
        delete next[index];
        return next;
      });
      updateRow(index, { domain: '' });
      return;
    }
    const normalized = fluxCompetitorAuditDiscovery.domainFromCuratedSeed(row);
    if (!normalized) {
      setErrors((current) => ({ ...current, [index]: 'Enter a valid domain like visitdenver.com.' }));
      return;
    }
    setErrors((current) => {
      const next = { ...current };
      delete next[index];
      return next;
    });
    updateRow(index, { domain: normalized, name: row.name?.trim() || undefined });
  };

  return (
    <View className="gap-2">
      <Text className={`${labelClassName} mb-0`}>{title}</Text>
      {helperText ? <Text className="text-gray-500 text-xs font-instrument leading-5">{helperText}</Text> : null}
      {rows.length === 0 ? (
        <Text className="text-gray-500 text-xs font-instrument">No override domains yet.</Text>
      ) : null}
      {rows.map((row, index) => (
        <View key={index} className="rounded-xl border border-[#2A2A2A] bg-[#111111] p-3">
          <View className="flex-row items-center justify-between gap-3 mb-2">
            <Text className="text-white text-sm font-instrument-semibold">Competitor {index + 1}</Text>
            <Pressable
              className="min-h-[44px] justify-center px-3"
              onPress={() => setRows(rows.filter((_, rowIndex) => rowIndex !== index))}
            >
              <Text className="text-red-300 text-xs font-instrument-semibold">Remove</Text>
            </Pressable>
          </View>
          <Text className={labelClassName}>Domain</Text>
          <TextInput
            className={inputClassName}
            value={row.domain}
            onChangeText={(domain) => updateRow(index, { domain })}
            onBlur={() => normalizeDomain(index)}
            autoCapitalize="none"
            placeholder="visitdenver.com"
            placeholderTextColor="#555"
          />
          {errors[index] ? <Text className="text-red-400 text-xs font-instrument -mt-1 mb-2">{errors[index]}</Text> : null}
          <Text className={labelClassName}>Display name (optional)</Text>
          <TextInput
            className={inputClassName}
            value={row.name ?? ''}
            onChangeText={(name) => updateRow(index, { name })}
            onBlur={() => updateRow(index, { name: row.name?.trim() || undefined })}
            placeholder="Visit Denver"
            placeholderTextColor="#555"
          />
        </View>
      ))}
      <Pressable
        className="min-h-[44px] self-start rounded-lg border border-[#2A2A2A] bg-[#1A1A1A] px-3 py-2"
        onPress={() => setRows([...rows, { domain: '', name: '' }])}
      >
        <Text className="text-white text-sm font-instrument-semibold">+ Add domain</Text>
      </Pressable>
    </View>
  );
}

export default FluxCuratedDomainsField;
