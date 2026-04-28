import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, Text, TextInput, View } from 'react-native';
import ColorPicker, { HueSlider, Panel1, Preview } from 'reanimated-color-picker';
import { BaseModal, ModalFooter } from '@/components/ui/modals';
import { Button } from '@/components/ui/button';
import { normalizeFluxHexColor } from '@/lib/flux/normalizeFluxHexColor';

export interface FluxHexColorFieldProps {
  value: string;
  onChange: (hex: string) => void;
  /** When false (default), blur with invalid hex restores `fallbackHex`. */
  allowEmpty?: boolean;
  placeholder?: string;
  /** Used for swatch preview when `value` is empty/invalid, picker seed, and required-field blur fallback. */
  fallbackHex?: string;
  inputClassName?: string;
  containerClassName?: string;
  swatchSize?: 'sm' | 'md';
}

const SWATCH = { sm: 'w-7 h-7 rounded-md', md: 'w-8 h-8 rounded-lg' };

function swatchBackground(
  value: string,
  allowEmpty: boolean,
  fallbackHex: string,
): string {
  const n = normalizeFluxHexColor(value);
  if (n) return n;
  if (allowEmpty && !value.trim()) return 'transparent';
  return normalizeFluxHexColor(fallbackHex) ?? '#444444';
}

export function FluxHexColorField({
  value,
  onChange,
  allowEmpty = false,
  placeholder = '#000000',
  fallbackHex = '#4f46e5',
  inputClassName = 'flex-1 text-white text-sm font-instrument bg-[#222] border border-[#333] rounded-lg px-3 py-2',
  containerClassName = 'flex-row items-center gap-2 mb-2',
  swatchSize = 'sm',
}: FluxHexColorFieldProps) {
  const [text, setText] = useState(value);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draftHex, setDraftHex] = useState(fallbackHex);
  const webInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setText(value);
  }, [value]);

  const resolvedFallback = useMemo(
    () => normalizeFluxHexColor(fallbackHex) ?? '#4f46e5',
    [fallbackHex],
  );

  const openPickerSeed = useCallback(() => {
    return normalizeFluxHexColor(text) ?? resolvedFallback;
  }, [text, resolvedFallback]);

  const commitText = useCallback(() => {
    const trimmed = text.trim();
    if (allowEmpty && trimmed === '') {
      onChange('');
      return;
    }
    const n = normalizeFluxHexColor(trimmed);
    if (n) {
      onChange(n);
      setText(n);
      return;
    }
    if (allowEmpty) {
      const revert = normalizeFluxHexColor(value) ?? '';
      if (revert) {
        onChange(revert);
        setText(revert);
      } else {
        onChange('');
        setText('');
      }
      return;
    }
    const revert = normalizeFluxHexColor(value) ?? resolvedFallback;
    onChange(revert);
    setText(revert);
  }, [allowEmpty, onChange, resolvedFallback, text, value]);

  const handleWebColorInput = useCallback(
    (e: { currentTarget: HTMLInputElement }) => {
      const raw = e.currentTarget?.value ?? '';
      const n = normalizeFluxHexColor(raw);
      if (n) {
        onChange(n);
        setText(n);
      }
    },
    [onChange],
  );

  const handleSwatchPress = useCallback(() => {
    if (Platform.OS === 'web') {
      const seed = openPickerSeed();
      const el = webInputRef.current;
      if (el) {
        el.value = seed;
        el.click();
      }
      return;
    }
    setDraftHex(openPickerSeed());
    setPickerOpen(true);
  }, [openPickerSeed]);

  const pickerValue = draftHex;
  const handlePickerChangeJS = useCallback(
    (colors: { hex: string }) => {
      const n = normalizeFluxHexColor(colors.hex);
      if (n) setDraftHex(n);
    },
    [],
  );

  const applyPicker = useCallback(() => {
    const n = normalizeFluxHexColor(draftHex) ?? resolvedFallback;
    onChange(n);
    setText(n);
    setPickerOpen(false);
  }, [draftHex, onChange, resolvedFallback]);

  const swatchClass = SWATCH[swatchSize];
  const borderClass = swatchSize === 'md' ? 'border-[#3A3A3A]' : 'border-[#444]';

  const webColorDefault = normalizeFluxHexColor(text) ?? resolvedFallback;
  const webHiddenColorInput =
    Platform.OS === 'web'
      ? React.createElement('input', {
          ref: (node: HTMLInputElement | null) => {
            webInputRef.current = node;
          },
          type: 'color',
          defaultValue: webColorDefault,
          'aria-hidden': true,
          style: { position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' },
          onInput: handleWebColorInput,
        } as React.InputHTMLAttributes<HTMLInputElement>)
      : null;

  return (
    <View className={containerClassName}>
      {Platform.OS === 'web' ? (
        <View style={{ position: 'absolute', width: 1, height: 1, opacity: 0, overflow: 'hidden' }}>
          {webHiddenColorInput}
        </View>
      ) : null}

      <Pressable
        onPress={handleSwatchPress}
        accessibilityRole="button"
        accessibilityLabel="Open color picker"
        className={`${swatchClass} border ${borderClass}`}
        style={{ backgroundColor: swatchBackground(value, allowEmpty, fallbackHex) }}
      />

      <TextInput
        className={inputClassName}
        value={text}
        onChangeText={setText}
        onBlur={commitText}
        placeholder={placeholder}
        placeholderTextColor="#555"
        autoCapitalize="none"
        autoCorrect={false}
      />

      {Platform.OS !== 'web' ? (
        <BaseModal
          visible={pickerOpen}
          onClose={() => setPickerOpen(false)}
          title="Pick a color"
          maxWidth="sm"
          footer={
            <ModalFooter>
              <Pressable
                onPress={() => setPickerOpen(false)}
                className="px-4 py-3 rounded-xl border border-white/20 bg-white/5 items-center justify-center"
              >
                <Text className="text-white font-instrument-medium">Cancel</Text>
              </Pressable>
              <Button variant="default" onPress={applyPicker}>
                Done
              </Button>
            </ModalFooter>
          }
          footerMobile={
            <ModalFooter>
              <Button variant="default" onPress={applyPicker}>
                Done
              </Button>
            </ModalFooter>
          }
        >
          <View className="gap-4">
            <ColorPicker
              value={pickerValue}
              onChangeJS={handlePickerChangeJS}
              sliderThickness={22}
              thumbSize={28}
              boundedThumb
              style={{ width: '100%' }}
            >
              <Preview style={{ height: 44, marginBottom: 8 }} />
              <Panel1 style={{ height: 176, marginBottom: 12 }} />
              <HueSlider style={{ marginBottom: 4 }} />
            </ColorPicker>
          </View>
        </BaseModal>
      ) : null}
    </View>
  );
}
