import React from 'react';
import { StyleSheet, View } from 'react-native';

const GAP = 12;
/** Min width per slot so the row wraps on narrow modals (e.g. mobile); each button then gets full width and label doesn't wrap. */
const MIN_SLOT_WIDTH = 180;

export interface ModalFooterProps {
  children: React.ReactNode;
}

/**
 * Lays out modal footer actions in a row that grows to fill width, wraps when narrow,
 * and makes each button full width when alone on a line.
 */
export function ModalFooter({ children }: ModalFooterProps) {
  const childArray = React.Children.toArray(children);
  return (
    <View style={styles.row}>
      {childArray.map((child, index) => (
        <View key={index} style={styles.slot}>
          {child}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GAP,
  },
  slot: {
    flex: 1,
    minWidth: MIN_SLOT_WIDTH,
  },
});
