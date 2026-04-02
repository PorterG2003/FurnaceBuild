import React, { useCallback, useState } from 'react';
import { View, Text, Platform, Alert } from 'react-native';
import { Button } from '@/components/ui/button';

const UTF8_BOM = '\ufeff';

interface CsvUploadDropzoneProps {
  onParsed: (fileName: string, text: string) => void;
  disabled?: boolean;
}

export function CsvUploadDropzone({ onParsed, disabled }: CsvUploadDropzoneProps) {
  const [dragActive, setDragActive] = useState(false);

  const processFile = useCallback(
    async (file: File) => {
      let text = await file.text();
      if (text.startsWith(UTF8_BOM)) {
        text = text.slice(UTF8_BOM.length);
      }
      onParsed(file.name, text);
    },
    [onParsed],
  );

  const pickFile = useCallback(() => {
    if (Platform.OS !== 'web') {
      Alert.alert('Web only', 'CSV upload is available in the browser for now.');
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,text/csv';
    input.value = '';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        await processFile(file);
      } catch (err) {
        Alert.alert('Read failed', err instanceof Error ? err.message : 'Could not read file.');
      }
    };
    input.click();
  }, [processFile]);

  const dropZoneClass = `border-2 border-dashed rounded-xl p-8 items-center justify-center ${
    dragActive ? 'border-brand-orange bg-[rgba(243,68,13,0.08)]' : 'border-[#3A3A3A] bg-[#1A1A1A]'
  }`;

  return (
    <View className="gap-3">
      {Platform.OS === 'web' ? (
        <View
          className={dropZoneClass}
          // react-native-web forwards drag events on View
          {...({
            onDragOver: (e: { preventDefault: () => void }) => {
              e.preventDefault();
              setDragActive(true);
            },
            onDragLeave: () => setDragActive(false),
            onDrop: async (e: { preventDefault: () => void; dataTransfer?: DataTransfer | null }) => {
              e.preventDefault();
              setDragActive(false);
              const file = e.dataTransfer?.files?.[0];
              if (!file) return;
              if (!file.name.toLowerCase().endsWith('.csv') && file.type !== 'text/csv') {
                Alert.alert('CSV only', 'Drop a .csv file.');
                return;
              }
              try {
                await processFile(file);
              } catch (err) {
                Alert.alert('Read failed', err instanceof Error ? err.message : 'Could not read file.');
              }
            },
          } as object)}
        >
          <Text className="text-gray-400 font-instrument text-sm text-center mb-3">
            Drag and drop a CSV here, or use the file picker.
          </Text>
          <Button variant="secondary" size="sm" onPress={pickFile} disabled={disabled}>
            Choose CSV file
          </Button>
        </View>
      ) : (
        <View className="border border-[#3A3A3A] rounded-xl p-6 bg-[#1A1A1A]">
          <Text className="text-gray-400 font-instrument text-sm mb-3">
            CSV import is available on web. On mobile, open Foundry in the browser.
          </Text>
          <Button variant="secondary" size="sm" onPress={pickFile} disabled={disabled}>
            Choose CSV file
          </Button>
        </View>
      )}
    </View>
  );
}
