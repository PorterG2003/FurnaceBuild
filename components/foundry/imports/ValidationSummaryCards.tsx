import React from 'react';
import { View, Text } from 'react-native';
import { Card } from '@/components/ui/Card';

interface ValidationSummaryCardsProps {
  totalRows: number;
  validRows: number;
  warningRows: number;
  errorRows: number;
}

function Cell({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: 'default' | 'warn' | 'error';
}) {
  const color =
    accent === 'error' ? 'text-red-400' : accent === 'warn' ? 'text-amber-400' : 'text-white';
  return (
    <Card variant="card" className="flex-1 min-w-[140px]">
      <Text className="text-xs text-gray-500 uppercase tracking-wider font-instrument-semibold">{label}</Text>
      <Text className={`text-2xl font-instrument-semibold mt-1 ${color}`}>{value}</Text>
    </Card>
  );
}

export function ValidationSummaryCards({
  totalRows,
  validRows,
  warningRows,
  errorRows,
}: ValidationSummaryCardsProps) {
  return (
    <View className="flex-row flex-wrap gap-3">
      <Cell label="Total rows" value={totalRows} />
      <Cell label="Valid" value={validRows} />
      <Cell label="Warnings" value={warningRows} accent="warn" />
      <Cell label="Errors" value={errorRows} accent="error" />
    </View>
  );
}
