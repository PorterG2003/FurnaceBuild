import React from 'react';
import { View, KeyboardAvoidingView, Platform, Animated } from 'react-native';
import { BottomSheet } from '@/components/ui/modals';
import { InboxComposerForm } from './InboxComposerForm';
import type { InboxComposerFormProps } from './InboxComposerForm';

export type InboxComposerPanelProps = Omit<InboxComposerFormProps, 'onCancel'> & {
  variant: 'panel' | 'sheet';
  onClose: () => void;
  /** Desktop panel only */
  slideAnim?: Animated.Value;
  panelWidth?: number;
  /** Mobile sheet only */
  sheetMaxHeight?: number;
};

export function InboxComposerPanel({
  variant,
  onClose,
  slideAnim,
  panelWidth = 600,
  sheetMaxHeight = 600,
  ...formProps
}: InboxComposerPanelProps) {
  const form = (
    <InboxComposerForm
      {...formProps}
      onCancel={onClose}
      editorKeySuffix={variant === 'sheet' ? '-sheet' : undefined}
    />
  );

  if (variant === 'panel' && slideAnim != null) {
    return (
      <Animated.View
        style={{
          width: slideAnim.interpolate({
            inputRange: [0, 1],
            outputRange: [panelWidth, 0],
          }),
          overflow: 'hidden',
          backgroundColor: '#1A1A1A',
          borderLeftWidth: 1,
          borderLeftColor: '#2A2A2A',
        }}
      >
        <View style={{ width: panelWidth, flex: 1 }}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={{ flex: 1 }}
          >
            <View className="flex-1 p-5">{form}</View>
          </KeyboardAvoidingView>
        </View>
      </Animated.View>
    );
  }

  if (variant === 'sheet') {
    return (
      <BottomSheet visible onClose={onClose}>
        <View style={{ maxHeight: sheetMaxHeight }}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={{ flex: 1 }}
          >
            {form}
          </KeyboardAvoidingView>
        </View>
      </BottomSheet>
    );
  }

  return null;
}
